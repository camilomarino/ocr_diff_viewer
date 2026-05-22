# Agent Notes

Scope: `apps/ocr_diff_viewer`

Responsibility: Static OCR diff viewer app used to inspect OCR benchmark outputs.

## Start Here

- Use this app for reusable viewer behavior, layout, asset handling and build logic.
- Keep Berrutti-specific benchmark inputs and generated viewers in `projects/berrutti_benchmark`.

## Owns

- `build_static_viewer.py`: app builder.
- `public/`: static HTML, CSS, JS and favicon assets.
- `src/`: app source if/when the viewer grows beyond static assets.
- `examples/`: small app examples only.
- `reports/`: curated app/demo notes.
- `builds/`: ignored generated builds.
- `tests/`: app tests.

## Routing Rules

- Benchmark outputs and metrics -> `projects/berrutti_benchmark/runs`.
- Benchmark reports -> `projects/berrutti_benchmark/reports`.
- Public app mirror/export -> add an explicit app export script before publishing.
- Showcase demo summary -> `showcase/benchmarks.md` or `showcase/index.md`.

## Cross-Repo Flow

- The public `ocr_diff_viewer` repo maps to this app.
- Frontend changes should stay benchmark-agnostic.
- If a benchmark needs a new data format, update the project writer and app reader together.
- Preserved generated benchmark output is exposed only as `builds/source_output` for local inspection.

## Local Map

- `public/`: browser assets.
- `public/`: source browser assets used by the builder.
- `builds/`: ignored generated app output.
- `builds/source_output`: local link to the preserved generated viewer bundle.
- `examples/`: small sample inputs.
- `tests/`: viewer tests.

## Boundaries

- Do not commit generated `output/` folders, copied datasets, private pages or OCR dumps.
- Do not implement OCR scoring here; benchmark metrics belong in `projects/berrutti_benchmark`.
- Do not add command-compatibility symlinks; generated bundles belong in explicit output directories or `builds/`.

## Verification

- Python builder: `python -m py_compile apps/ocr_diff_viewer/build_static_viewer.py`.
- Frontend syntax: `node --check apps/ocr_diff_viewer/public/app.js`.
- Repo policy: `python scripts/verify_monorepo.py`.
- Heavy local links: `python scripts/check_heavy_links.py`.
