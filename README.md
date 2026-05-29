# OCR Diff Viewer

Static viewer for comparing scanned pages, ground truth text, OCR outputs, and CER/WER differences.

This app is the canonical home for the code migrated from `ocr_diff_viewer`.
Reusable UI behavior belongs here; benchmark-specific inputs and generated
outputs belong in `projects/berrutti_benchmark`. For the Berrutti data/model
setup that feeds those bundles, see `../../docs/setup_data_and_models.md`.

## Local Output Links

Generated bundles should be written to an explicit output directory. The
preserved generated bundle from the benchmark migration is available at
`builds/source_output`; it is a local data link, not a supported command path.

## Put Files Here

The builder matches files by filename stem. For example, `page_001.png`, `page_001.txt`, and every model output named `page_001.txt` become one comparable page.

```text
my_dataset/
  images/
    page_001.png
    page_002.png
  ground_truth/
    page_001.txt
    page_002.txt
  transcriptions/
    model_a/
      page_001.txt
      page_002.txt
    model_b/
      page_001.txt
      page_002.txt
```

Images can be `.png`, `.jpg`, `.jpeg`, `.tif`, `.tiff`, `.webp`, `.bmp`, `.gif`, `.svg`, `.avif`, or `.apng`. Text files must be UTF-8 `.txt`.

If you only have one OCR output folder, this also works:

```text
transcriptions/
  page_001.txt
  page_002.txt
```

Set `default_model_name` in the config for that flat layout.

## Configure

Copy `config.example.yaml` and point it at your folders:

```yaml
dataset_name: my_dataset
images_dir: /abs/path/my_dataset/images
ground_truth_dir: /abs/path/my_dataset/ground_truth
transcriptions_dir: /abs/path/my_dataset/transcriptions
output_dir: ./output
default_model_name: ocr_prediction
```

Optional: pass existing benchmark metrics instead of using only metrics computed by the viewer:

```yaml
metrics_csv:
  - /abs/path/metrics.csv
```

Expected metric columns:

```text
page_id,model,cer,wer,gt_chars,pred_chars,gt_words,pred_words
```

If model folder names differ from CSV model IDs:

```yaml
model_aliases:
  folder_name: report_model_id
```

The viewer always computes CER, WER, character counts, word counts, and edit
operations from its normalized evaluation text. `metrics_csv` can add external
metadata such as latency and cost, but it does not override the viewer's text
metrics.

## Evaluation Text

Metrics computed by this viewer use a reading-order normalization before CER,
WER, and edit-operation counts are calculated. The builder removes common
Markdown/HTML/layout artifacts such as headings, table separators, emphasis,
links, bullets, tags, and pipe separators, then normalizes whitespace. The
side-by-side text panes show this normalized text by default, with a small
toggle to inspect the raw ground-truth and OCR text when needed.

If you provide `metrics_csv`, those external values do not override the
computed CER/WER values.

## Build

```bash
python build_static_viewer.py --config my_config.yaml
```

Open:

```text
output/index.html
```

If your browser blocks local files:

```bash
cd output
python -m http.server 8765
```

Then open `http://127.0.0.1:8765/`.

## Share

Share the whole generated `output/` folder, or zip that folder.

```bash
zip -qr ocr_diff_viewer_output.zip output
```

Do not share only `index.html`; it needs sibling files:

```text
output/
  index.html
  app.js
  styles.css
  favicon.svg
  data/
    data.js
    index.json
  assets/
    images/
```

## Fast UI Changes

After editing files in `public/`, refresh only the front end:

```bash
python build_static_viewer.py --config my_config.yaml --front-only
```

This keeps existing data, metrics, and images untouched.

If `data/data.js` is missing but `data/index.json` exists:

```bash
python build_static_viewer.py --config my_config.yaml --reuse-index
```

## Troubleshooting

`Index unavailable` usually means `data/data.js` is missing, only `index.html` was moved, or you opened a generated bundle without its `data/` directory.

Missing pages usually mean filename stems do not match across `images/`, `ground_truth/`, and model output folders.
