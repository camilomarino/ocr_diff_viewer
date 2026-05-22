#!/usr/bin/env python3
"""Build a self-contained static OCR diff viewer from a YAML config."""

from __future__ import annotations

import argparse
import csv
import json
import mimetypes
import shutil
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from rapidfuzz.distance import Levenshtein


VIEWER_TEMPLATE_DIR = Path(__file__).resolve().parent / "public"
IMAGE_EXTENSIONS = {
    ".apng",
    ".avif",
    ".bmp",
    ".gif",
    ".jpeg",
    ".jpg",
    ".png",
    ".svg",
    ".tif",
    ".tiff",
    ".webp",
}


def read_config(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        raw = yaml.safe_load(handle) or {}
    if not isinstance(raw, dict):
        raise ValueError("Config YAML must contain a mapping.")
    return raw


def cfg_path(config: dict[str, Any], key: str, *, required: bool = True) -> Path | None:
    value = config.get(key)
    if value is None:
        if required:
            raise ValueError(f"Missing required config key: {key}")
        return None
    return Path(str(value)).expanduser().resolve()


def cfg_path_any(config: dict[str, Any], keys: tuple[str, ...], *, required: bool = True) -> Path | None:
    for key in keys:
        value = config.get(key)
        if value is not None:
            return Path(str(value)).expanduser().resolve()
    if required:
        joined = " or ".join(keys)
        raise ValueError(f"Missing required config key: {joined}")
    return None


def cfg_paths(config: dict[str, Any], key: str) -> list[Path]:
    value = config.get(key)
    if value is None:
        return []
    if isinstance(value, (str, Path)):
        return [Path(str(value)).expanduser().resolve()]
    if isinstance(value, list):
        return [Path(str(item)).expanduser().resolve() for item in value]
    raise ValueError(f"{key} must be a string path or a list of paths.")


def normalize_for_eval(text: str) -> str:
    return "\n".join(line.rstrip() for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")).strip()


def text_metrics(reference: str, hypothesis: str) -> dict[str, float | int | None]:
    ref = normalize_for_eval(reference)
    hyp = normalize_for_eval(hypothesis)
    ref_words = ref.split()
    hyp_words = hyp.split()
    char_distance = Levenshtein.distance(ref, hyp)
    word_distance = Levenshtein.distance(ref_words, hyp_words)
    return {
        "cer": char_distance / len(ref) if ref else None,
        "wer": word_distance / len(ref_words) if ref_words else None,
        "gtChars": len(ref),
        "predChars": len(hyp),
        "gtWords": len(ref_words),
        "predWords": len(hyp_words),
    }


def edit_operation_counts(reference: str, hypothesis: str) -> dict[str, int]:
    insertions = deletions = substitutions = 0
    for opcode in Levenshtein.opcodes(reference, hypothesis):
        ref_len = opcode.src_end - opcode.src_start
        pred_len = opcode.dest_end - opcode.dest_start
        if opcode.tag == "insert":
            insertions += pred_len
        elif opcode.tag == "delete":
            deletions += ref_len
        elif opcode.tag == "replace":
            substitutions += min(ref_len, pred_len)
            deletions += max(ref_len - pred_len, 0)
            insertions += max(pred_len - ref_len, 0)
    return {
        "insertions": insertions,
        "deletions": deletions,
        "substitutions": substitutions,
        "editDistance": insertions + deletions + substitutions,
        "scoringGtChars": len(reference),
        "scoringPredChars": len(hypothesis),
    }


def word_operation_counts(reference: str, hypothesis: str) -> dict[str, int]:
    ref_words = reference.split()
    hyp_words = hypothesis.split()
    insertions = deletions = substitutions = 0
    for opcode in Levenshtein.opcodes(ref_words, hyp_words):
        ref_len = opcode.src_end - opcode.src_start
        pred_len = opcode.dest_end - opcode.dest_start
        if opcode.tag == "insert":
            insertions += pred_len
        elif opcode.tag == "delete":
            deletions += ref_len
        elif opcode.tag == "replace":
            substitutions += min(ref_len, pred_len)
            deletions += max(ref_len - pred_len, 0)
            insertions += max(pred_len - ref_len, 0)
    return {
        "insertions": insertions,
        "deletions": deletions,
        "substitutions": substitutions,
        "editDistance": insertions + deletions + substitutions,
        "scoringGtWords": len(ref_words),
        "scoringPredWords": len(hyp_words),
    }


def word_opcodes(reference: str, hypothesis: str) -> list[list[int | str]]:
    ref_words = reference.split()
    hyp_words = hypothesis.split()
    return [
        [opcode.tag, opcode.src_start, opcode.src_end, opcode.dest_start, opcode.dest_end]
        for opcode in Levenshtein.opcodes(ref_words, hyp_words)
    ]


def discover_images(images_dir: Path) -> dict[str, Path]:
    images: dict[str, Path] = {}
    for path in sorted(images_dir.iterdir()):
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS:
            images[path.stem] = path
    return images


def discover_texts(text_dir: Path) -> dict[str, Path]:
    return {path.stem: path for path in sorted(text_dir.iterdir()) if path.is_file() and path.suffix.lower() == ".txt"}


def discover_prediction_dirs(predictions_dir: Path, default_model_name: str) -> dict[str, dict[str, Path]]:
    subdirs = [path for path in sorted(predictions_dir.iterdir()) if path.is_dir()]
    if subdirs:
        return {path.name: discover_texts(path) for path in subdirs}
    return {default_model_name: discover_texts(predictions_dir)}


def load_metrics(paths: list[Path]) -> dict[tuple[str, str], dict[str, float | int | None]]:
    metrics: dict[tuple[str, str], dict[str, float | int | None]] = {}
    for path in paths:
        with path.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                if row.get("included", "true").lower() == "false":
                    continue
                page_id = row.get("page_id")
                model = row.get("model")
                if not page_id or not model:
                    continue
                metrics[(page_id, model)] = {
                    "cer": clean_float(row.get("cer")),
                    "wer": clean_float(row.get("wer")),
                    "gtChars": clean_int(row.get("gt_chars")),
                    "predChars": clean_int(row.get("pred_chars")),
                    "gtWords": clean_int(row.get("gt_words")),
                    "predWords": clean_int(row.get("pred_words")),
                    "latencySeconds": clean_float(row.get("latency_seconds")),
                    "costUsd": clean_float(row.get("cost_usd")),
                }
    return metrics


def clean_float(value: str | None) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def clean_int(value: str | None) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


def copy_viewer_shell(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for filename in ("index.html", "app.js", "styles.css", "favicon.svg"):
        shutil.copy2(VIEWER_TEMPLATE_DIR / filename, output_dir / filename)


def copy_image(image_path: Path, output_dir: Path, page_id: str) -> str:
    target_dir = output_dir / "assets" / "images"
    target_dir.mkdir(parents=True, exist_ok=True)
    suffix = image_path.suffix.lower()
    target = target_dir / f"{page_id}{suffix}"
    shutil.copy2(image_path, target)
    return f"assets/images/{target.name}"


def build_index(config: dict[str, Any], output_dir: Path) -> dict[str, Any]:
    images_dir = cfg_path(config, "images_dir")
    gt_dir = cfg_path(config, "ground_truth_dir")
    predictions_dir = cfg_path_any(config, ("transcriptions_dir", "predictions_dir"))
    dataset_name = str(config.get("dataset_name") or images_dir.name)
    default_model_name = str(config.get("default_model_name") or predictions_dir.name)
    model_aliases = {str(key): str(value) for key, value in (config.get("model_aliases") or {}).items()}
    canonical_metrics = load_metrics(cfg_paths(config, "metrics_csv"))

    images = discover_images(images_dir)
    ground_truth = discover_texts(gt_dir)
    predictions_by_model = discover_prediction_dirs(predictions_dir, default_model_name)
    page_ids = sorted(set(images) & set(ground_truth))
    if not page_ids:
        raise ValueError("No matching pages found between images_dir and ground_truth_dir.")

    pages = []
    model_sums: dict[str, dict[str, float | int]] = defaultdict(
        lambda: {"pages": 0, "cerSum": 0.0, "werSum": 0.0, "cerN": 0, "werN": 0}
    )

    for page_id in page_ids:
        reference_raw = ground_truth[page_id].read_text(encoding="utf-8")
        reference_eval = normalize_for_eval(reference_raw)
        page = {
            "id": page_id,
            "image": copy_image(images[page_id], output_dir, page_id),
            "imageMime": mimetypes.guess_type(images[page_id].name)[0] or "",
            "groundTruth": "",
            "groundTruthText": reference_raw,
            "models": {},
        }
        for model_id, prediction_paths in predictions_by_model.items():
            prediction_path = prediction_paths.get(page_id)
            if prediction_path is None:
                continue
            prediction_raw = prediction_path.read_text(encoding="utf-8")
            hypothesis_eval = normalize_for_eval(prediction_raw)
            metrics = text_metrics(reference_raw, prediction_raw)
            canonical_model = model_aliases.get(model_id, model_id)
            metrics.update({key: value for key, value in canonical_metrics.get((page_id, canonical_model), {}).items() if value is not None})
            page["models"][model_id] = {
                "text": "",
                "textContent": prediction_raw,
                "ops": edit_operation_counts(reference_eval, hypothesis_eval),
                "wordOps": word_operation_counts(reference_eval, hypothesis_eval),
                "wordOpcodes": word_opcodes(reference_eval, hypothesis_eval),
                **metrics,
            }
            sums = model_sums[model_id]
            sums["pages"] += 1
            if isinstance(metrics["cer"], float):
                sums["cerSum"] += metrics["cer"]
                sums["cerN"] += 1
            if isinstance(metrics["wer"], float):
                sums["werSum"] += metrics["wer"]
                sums["werN"] += 1
        pages.append(page)

    models = []
    for model_id, sums in model_sums.items():
        cer_n = int(sums["cerN"])
        wer_n = int(sums["werN"])
        models.append(
            {
                "id": model_id,
                "pages": int(sums["pages"]),
                "availablePages": int(sums["pages"]),
                "avgCer": (float(sums["cerSum"]) / cer_n) if cer_n else None,
                "avgWer": (float(sums["werSum"]) / wer_n) if wer_n else None,
            }
        )

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "dataset": dataset_name,
        "source": {
            "images": "assets/images",
            "groundTruth": "embedded in data/data.js",
            "transcriptions": "embedded in data/data.js",
        },
        "counts": {
            "pages": len(pages),
            "models": len(models),
            "pageModelResults": sum(len(page["models"]) for page in pages),
        },
        "pages": pages,
        "models": sorted(models, key=lambda item: (item["avgCer"] is None, item["avgCer"] or 0, item["id"])),
    }


def write_embedded_data(index: dict[str, Any], output_dir: Path) -> None:
    data_dir = output_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    data = json.dumps(index, ensure_ascii=False, separators=(",", ":"))
    (data_dir / "data.js").write_text(f"window.OCR_DIFF_VIEWER_INDEX={data};\n", encoding="utf-8")
    (data_dir / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_existing_index(output_dir: Path) -> dict[str, Any]:
    index_path = output_dir / "data" / "index.json"
    if not index_path.exists():
        raise FileNotFoundError(f"Existing index not found: {index_path}")
    with index_path.open(encoding="utf-8") as handle:
        index = json.load(handle)
    if not isinstance(index, dict):
        raise ValueError(f"Existing index must contain a JSON object: {index_path}")
    return index


def require_front_only_inputs(output_dir: Path) -> None:
    data_js = output_dir / "data" / "data.js"
    if not data_js.exists():
        raise FileNotFoundError(
            f"Existing embedded data not found: {data_js}. "
            "Run a full build first, or run with --reuse-index if data/index.json exists."
        )


def write_readme(output_dir: Path) -> None:
    (output_dir / "README.md").write_text(
        "\n".join(
            [
                "# OCR Diff Viewer Bundle",
                "",
                "Open `index.html` in a modern browser.",
                "",
                "If the browser blocks any local-file feature, serve this folder:",
                "",
                "```bash",
                "python -m http.server 8765",
                "```",
                "",
                "Then open `http://127.0.0.1:8765/`.",
                "",
            ]
        ),
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, help="YAML config path.")
    parser.add_argument("--output-dir", help="Override output_dir from YAML.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--front-only",
        action="store_true",
        help="Only refresh index.html, app.js, styles.css, and README.md. Keep existing data and assets untouched.",
    )
    mode.add_argument(
        "--reuse-index",
        action="store_true",
        help="Refresh the front end and rebuild data/data.js from an existing data/index.json without recomputing metrics.",
    )
    args = parser.parse_args()

    config = read_config(Path(args.config))
    output_dir = (
        Path(args.output_dir).expanduser().resolve()
        if args.output_dir
        else cfg_path_any(config, ("output_dir", "result_dir"))
    )
    assert output_dir is not None

    copy_viewer_shell(output_dir)
    write_readme(output_dir)

    if args.front_only:
        require_front_only_inputs(output_dir)
        print(f"Updated front-end files only: {output_dir}")
        print("Kept existing data/data.js, data/index.json, and assets/.")
        return 0

    if args.reuse_index:
        index = read_existing_index(output_dir)
        write_embedded_data(index, output_dir)
        print(f"Updated viewer from existing index: {output_dir}")
        print(f"Open: {output_dir / 'index.html'}")
        print(f"Pages: {index['counts']['pages']} | Models: {index['counts']['models']} | Results: {index['counts']['pageModelResults']}")
        return 0

    index = build_index(config, output_dir)
    write_embedded_data(index, output_dir)
    print(f"Wrote viewer bundle: {output_dir}")
    print(f"Open: {output_dir / 'index.html'}")
    print(f"Pages: {index['counts']['pages']} | Models: {index['counts']['models']} | Results: {index['counts']['pageModelResults']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
