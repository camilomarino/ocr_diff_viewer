const state = {
  index: null,
  pages: [],
  view: "home",
  currentPage: null,
  currentModel: null,
  currentResult: null,
  gtText: "",
  ocrText: "",
  gtScoringText: "",
  ocrScoringText: "",
  textView: "normalized",
  zoom: 100,
  gridLeft: 50,
  gridTop: 50,
  sidebarWidth: 300,
  sidebarPanelSplit: 50,
  summaryModelWidth: 360,
  syncingScroll: false,
  scrollSource: "gt",
  homeSort: { type: "aggregate", metric: "cerMedian", pageId: null, direction: "asc" },
  homePageSort: { type: "alpha", modelId: null, metric: "cer", direction: "asc" },
  summaryColumns: ["cer", "wer"],
  summaryLegendOpen: false,
  diffCriterion: "cer",
  appliedRouteHash: "",
};

const horizontalBounceTimers = new WeakMap();
const SUMMARY_DOCUMENT_METRICS = [
  { id: "cer", label: "CER", title: "Character error rate", colorFamily: "error" },
  { id: "wer", label: "WER", title: "Word error rate", colorFamily: "error" },
  { id: "insertions", label: "Ins", title: "Inserted characters", colorFamily: "error" },
  { id: "deletions", label: "Del", title: "Deleted characters", colorFamily: "error" },
  { id: "substitutions", label: "Sub", title: "Substituted characters", colorFamily: "error" },
];
const SUMMARY_COLOR_RANGES = [
  { className: "error-excellent", label: "p0-p10", title: "Excellent: lowest 10%" },
  { className: "error-good", label: "p10-p25", title: "Good: 10th to 25th percentile" },
  { className: "error-neutral", label: "p25-p75", title: "Typical: 25th to 75th percentile" },
  { className: "error-weak", label: "p75-p90", title: "Weak: 75th to 90th percentile" },
  { className: "error-bad", label: "p90-p97", title: "Bad: 90th to 97th percentile" },
  { className: "error-worst", label: "p97-p100", title: "Worst: top 3%" },
];

const els = {
  appTitle: document.getElementById("appTitle"),
  datasetSummary: document.getElementById("datasetSummary"),
  homeButton: document.getElementById("homeButton"),
  homeView: document.getElementById("homeView"),
  detailView: document.getElementById("detailView"),
  homeDocSearch: document.getElementById("homeDocSearch"),
  homeModelSearch: document.getElementById("homeModelSearch"),
  sortModelsAlpha: document.getElementById("sortModelsAlpha"),
  sortDocsAlpha: document.getElementById("sortDocsAlpha"),
  summaryColumnToggles: document.querySelectorAll(".column-toggle"),
  summaryTable: document.getElementById("summaryTable"),
  summaryLegendToggle: document.getElementById("summaryLegendToggle"),
  summaryLegendPanel: document.getElementById("summaryLegendPanel"),
  docSearch: document.getElementById("docSearch"),
  docSelect: document.getElementById("docSelect"),
  modelSearch: document.getElementById("modelSearch"),
  modelSelect: document.getElementById("modelSelect"),
  pageTitle: document.getElementById("pageTitle"),
  textViewToggles: document.querySelectorAll(".text-view-toggle"),
  selectedMetrics: document.getElementById("selectedMetrics"),
  pageImage: document.getElementById("pageImage"),
  groundTruthText: document.getElementById("groundTruthText"),
  ocrText: document.getElementById("ocrText"),
  ocrTitle: document.getElementById("ocrTitle"),
  diffText: document.getElementById("diffText"),
  diffSummary: document.getElementById("diffSummary"),
  diffCriterionSelect: document.getElementById("diffCriterionSelect"),
  zoomRange: document.getElementById("zoomRange"),
  toast: document.getElementById("toast"),
  layout: document.querySelector(".layout"),
  comparisonGrid: document.querySelector(".comparison-grid"),
  imageFrame: document.getElementById("imageFrame"),
  verticalSplitter: document.getElementById("verticalSplitter"),
  horizontalSplitter: document.getElementById("horizontalSplitter"),
  sidebarToggle: document.getElementById("sidebarToggle"),
  sidebarResizer: document.getElementById("sidebarResizer"),
  sidebarContent: document.getElementById("sidebarContent"),
  sidebarPanelSplitter: document.getElementById("sidebarPanelSplitter"),
};

function formatPercent(value) {
  return typeof value === "number" ? `${(value * 100).toFixed(2)}%` : "-";
}

function formatSeconds(value) {
  return typeof value === "number" ? `${value.toFixed(1)}s` : "-";
}

function formatCompactPercent(value) {
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "-";
}

function formatCount(value) {
  if (typeof value !== "number") return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function resultCer(result) {
  if (typeof result?.cer === "number") return result.cer;
  if (typeof result?.ops?.editDistance === "number" && result.ops.scoringGtChars > 0) {
    return result.ops.editDistance / result.ops.scoringGtChars;
  }
  return null;
}

function resultWer(result) {
  return typeof result?.wer === "number" ? result.wer : null;
}

function resultOperation(result, metric) {
  const value = result?.ops?.[metric];
  return typeof value === "number" ? value : null;
}

function resultScoringGtChars(result) {
  const value = result?.ops?.scoringGtChars ?? result?.gtChars;
  return typeof value === "number" && value > 0 ? value : null;
}

function resultGtChars(result) {
  return result?.gtChars ?? result?.ops?.scoringGtChars ?? "-";
}

function resultPredChars(result) {
  return result?.predChars ?? result?.ops?.scoringPredChars ?? "-";
}

function modelAvgCer(modelId, fallbackValue) {
  if (typeof fallbackValue === "number") return fallbackValue;
  return mean(modelMetricValues(modelId, "cer"));
}

function modelAvgWer(modelId, fallbackValue) {
  if (typeof fallbackValue === "number") return fallbackValue;
  return mean(modelMetricValues(modelId, "wer"));
}

function modelMetricValues(modelId, metric) {
  return state.pages
    .map((page) => resultMetric(page.models[modelId], metric))
    .filter((value) => typeof value === "number");
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[midpoint];
  return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function modelSummaryMetric(model, metric) {
  const aggregate = parseAggregateMetric(metric);
  if (!aggregate) return null;
  if (aggregate.sourceMetric === "cer" && aggregate.statistic === "mean" && typeof model.avgCer === "number") {
    return model.avgCer;
  }
  if (aggregate.sourceMetric === "wer" && aggregate.statistic === "mean" && typeof model.avgWer === "number") {
    return model.avgWer;
  }
  const values = modelMetricValues(model.id, aggregate.sourceMetric);
  return aggregate.statistic === "mean" ? mean(values) : median(values);
}

function selectedDocSortMetric() {
  return selectedSummaryMetricIds()[0] || "cer";
}

function resultMetric(result, metric) {
  if (metric === "cer") return resultCer(result);
  if (metric === "wer") return resultWer(result);
  return resultOperation(result, metric);
}

function summaryMetricDefinition(metric) {
  return SUMMARY_DOCUMENT_METRICS.find((column) => column.id === metric);
}

function metricColorFamily(metric) {
  return summaryMetricDefinition(metric)?.colorFamily || "error";
}

function selectedSummaryMetricIds() {
  return SUMMARY_DOCUMENT_METRICS
    .map((column) => column.id)
    .filter((metric) => state.summaryColumns.includes(metric));
}

function selectedSummaryMetrics() {
  return SUMMARY_DOCUMENT_METRICS.filter((column) => state.summaryColumns.includes(column.id));
}

function selectedAggregateColumns() {
  return selectedSummaryMetrics().flatMap((column) => [
    {
      metric: `${column.id}Mean`,
      sourceMetric: column.id,
      group: column.label,
      label: "Mean",
      statistic: "mean",
    },
    {
      metric: `${column.id}Median`,
      sourceMetric: column.id,
      group: column.label,
      label: "Median",
      statistic: "median",
    },
  ]);
}

function parseAggregateMetric(metric) {
  const statistic = metric.endsWith("Mean") ? "mean" : metric.endsWith("Median") ? "median" : null;
  if (!statistic) return null;
  const suffixLength = statistic === "mean" ? "Mean".length : "Median".length;
  const sourceMetric = metric.slice(0, -suffixLength);
  if (!summaryMetricDefinition(sourceMetric)) return null;
  return { sourceMetric, statistic };
}

function summaryMetricLabel(metric) {
  return summaryMetricDefinition(metric)?.label || metric.toUpperCase();
}

function formatSummaryMetric(metric, value, compact = true) {
  if (metric === "cer" || metric === "wer") {
    return compact ? formatCompactPercent(value) : formatPercent(value);
  }
  return formatCount(value);
}

function documentColorValue(result, metric) {
  const value = resultMetric(result, metric);
  if (typeof value !== "number") return null;
  if (metricColorFamily(metric) !== "operation") return value;
  const denominator = resultScoringGtChars(result);
  return denominator ? value / denominator : null;
}

function sortedMetricValues(values) {
  return values.filter((value) => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
}

function percentileRank(sortedValues, value) {
  if (typeof value !== "number" || !Number.isFinite(value) || !sortedValues.length) return null;
  if (sortedValues.length === 1) return 0.5;
  let lower = 0;
  while (lower < sortedValues.length && sortedValues[lower] < value) lower += 1;
  let upper = lower;
  while (upper < sortedValues.length && sortedValues[upper] === value) upper += 1;
  if (upper === lower) return lower / (sortedValues.length - 1);
  const averageRank = (lower + upper - 1) / 2;
  return averageRank / (sortedValues.length - 1);
}

function percentileValue(sortedValues, percentile) {
  if (!sortedValues.length) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (percentile / 100) * (sortedValues.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex];
  const weight = position - lowerIndex;
  return sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight;
}

function percentileTone(percentile) {
  if (percentile === null) return "missing";
  if (percentile <= 0.10) return "excellent";
  if (percentile <= 0.25) return "good";
  if (percentile < 0.75) return "neutral";
  if (percentile < 0.90) return "weak";
  if (percentile < 0.97) return "bad";
  return "worst";
}

function percentileMetricClass(metric, value, scale) {
  if (typeof value !== "number" || !scale?.length) return "missing";
  const family = metricColorFamily(metric);
  return `percentile-cell ${family}-percentile ${family}-${percentileTone(percentileRank(scale, value))}`;
}

function formatLegendValue(metric, value) {
  if (typeof value !== "number") return "-";
  if (metric === "cer" || metric === "wer") return `${(value * 100).toFixed(1)}%`;
  return value.toFixed(1);
}

function colorRangeThresholds(metric, scale) {
  const p10 = percentileValue(scale, 10);
  const p25 = percentileValue(scale, 25);
  const p75 = percentileValue(scale, 75);
  const p90 = percentileValue(scale, 90);
  const p97 = percentileValue(scale, 97);
  return [
    `<= ${formatLegendValue(metric, p10)}`,
    `${formatLegendValue(metric, p10)}-${formatLegendValue(metric, p25)}`,
    `${formatLegendValue(metric, p25)}-${formatLegendValue(metric, p75)}`,
    `${formatLegendValue(metric, p75)}-${formatLegendValue(metric, p90)}`,
    `${formatLegendValue(metric, p90)}-${formatLegendValue(metric, p97)}`,
    `>= ${formatLegendValue(metric, p97)}`,
  ];
}

function renderThresholdLine(label, metric, scale) {
  if (!scale?.length) return "";
  const thresholds = colorRangeThresholds(metric, scale)
    .map(
      (value, index) =>
        `<span class="summary-threshold-value percentile-cell ${SUMMARY_COLOR_RANGES[index].className}" role="cell">${escapeHtml(value)}</span>`
    )
    .join("");
  return (
    `<div class="summary-threshold-line" role="row">` +
    `<span class="summary-threshold-label">${escapeHtml(label)}</span>` +
    thresholds +
    `</div>`
  );
}

function buildDocumentColorScales(columns) {
  const scales = {};
  columns.forEach((column) => {
    scales[column.id] = sortedMetricValues(
      state.pages.flatMap((page) =>
        Object.values(page.models).map((result) => documentColorValue(result, column.id))
      )
    );
  });
  return scales;
}

function buildAggregateColorScales(models, columns) {
  const scales = {};
  columns.forEach((column) => {
    scales[column.metric] = sortedMetricValues(models.map((model) => modelSummaryMetric(model, column.metric)));
  });
  return scales;
}

function summaryMetricTitle(modelId, pageId, result) {
  const lines = [`${modelId} / ${pageId}`];
  SUMMARY_DOCUMENT_METRICS.forEach((column) => {
    const value = resultMetric(result, column.id);
    const rate = documentColorValue(result, column.id);
    const rateText = column.colorFamily === "operation" && typeof rate === "number" ? ` · rate ${formatPercent(rate)}` : "";
    lines.push(`${column.label} ${formatSummaryMetric(column.id, value, false)}${rateText}`);
  });
  return lines.join("\n");
}

function updateSummaryColumnToggles() {
  els.summaryColumnToggles.forEach((toggle) => {
    toggle.setAttribute("aria-pressed", String(state.summaryColumns.includes(toggle.dataset.summaryColumn)));
  });
}

function renderSummaryColorLegend(documentColumns, aggregateColumns, documentColorScales, aggregateColorScales) {
  const documentThresholds = documentColumns
    .map((column) => renderThresholdLine(`${column.label} docs`, column.id, documentColorScales[column.id]))
    .join("");
  const aggregateThresholds = aggregateColumns
    .map((column) => renderThresholdLine(`${column.group} ${column.label}`, column.sourceMetric, aggregateColorScales[column.metric]))
    .join("");
  const header = (
    `<div class="summary-threshold-line summary-threshold-header" role="row">` +
    `<span class="summary-threshold-label"></span>` +
    SUMMARY_COLOR_RANGES.map((range) => `<span class="summary-threshold-heading">${range.label}</span>`).join("") +
    `</div>`
  );
  return (
    `<div class="summary-thresholds" role="table">${header}${documentThresholds}${aggregateThresholds}</div>`
  );
}

function ensureVisibleSummarySorts() {
  const selected = selectedSummaryMetricIds();
  const aggregateMetrics = selectedAggregateColumns().map((column) => column.metric);
  if (state.homeSort.type === "aggregate" && !aggregateMetrics.includes(state.homeSort.metric)) {
    state.homeSort = aggregateMetrics.length
      ? { type: "aggregate", metric: aggregateMetrics[0], pageId: null, direction: "asc" }
      : { type: "alpha", metric: null, pageId: null, direction: "asc" };
  }
  if (state.homeSort.type === "page" && (!selected.length || !selected.includes(state.homeSort.metric))) {
    state.homeSort = aggregateMetrics.length
      ? { type: "aggregate", metric: aggregateMetrics[0], pageId: null, direction: "asc" }
      : { type: "alpha", metric: null, pageId: null, direction: "asc" };
  }
  if (state.homePageSort.type === "model" && (!selected.length || !selected.includes(state.homePageSort.metric))) {
    state.homePageSort = { type: "alpha", modelId: null, metric: selectedDocSortMetric(), direction: "asc" };
  }
}

function toggleSummaryColumn(metric) {
  const next = new Set(state.summaryColumns);
  if (next.has(metric)) {
    next.delete(metric);
  } else {
    next.add(metric);
  }
  state.summaryColumns = SUMMARY_DOCUMENT_METRICS.map((column) => column.id).filter((columnId) => next.has(columnId));
  renderHomeTable();
}

function updateSummaryLegendToggle() {
  els.summaryLegendToggle.setAttribute("aria-expanded", String(state.summaryLegendOpen));
  els.summaryLegendToggle.classList.toggle("active", state.summaryLegendOpen);
}

function toggleSummaryLegend() {
  state.summaryLegendOpen = !state.summaryLegendOpen;
  els.summaryLegendPanel.classList.toggle("hidden", !state.summaryLegendOpen);
  updateSummaryLegendToggle();
}

function nextDocumentSort(pageId) {
  const metrics = selectedSummaryMetricIds();
  if (!metrics.length) return { type: "aggregate", metric: "cerMedian", pageId: null, direction: "asc" };
  const samePage = state.homeSort.type === "page" && state.homeSort.pageId === pageId;
  const currentIndex = metrics.indexOf(state.homeSort.metric);
  if (!samePage || currentIndex === -1) return { type: "page", metric: metrics[0], pageId, direction: "asc" };
  if (state.homeSort.direction === "asc") {
    return { type: "page", metric: state.homeSort.metric, pageId, direction: "desc" };
  }
  return { type: "page", metric: metrics[(currentIndex + 1) % metrics.length], pageId, direction: "asc" };
}

function nextModelPageSort(modelId) {
  const metrics = selectedSummaryMetricIds();
  if (!metrics.length) return { type: "alpha", modelId: null, metric: "cer", direction: "asc" };
  const sameModel = state.homePageSort.type === "model" && state.homePageSort.modelId === modelId;
  const currentIndex = metrics.indexOf(state.homePageSort.metric);
  if (!sameModel || currentIndex === -1) return { type: "model", modelId, metric: metrics[0], direction: "asc" };
  if (state.homePageSort.direction === "asc") {
    return { type: "model", modelId, metric: state.homePageSort.metric, direction: "desc" };
  }
  return { type: "model", modelId, metric: metrics[(currentIndex + 1) % metrics.length], direction: "asc" };
}

function modelAvailablePages(model) {
  if (typeof model.availablePages === "number") return model.availablePages;
  if (typeof model.pages === "number") return model.pages;
  return state.pages.filter((page) => page.models[model.id]).length;
}

function modelHasFullCoverage(model) {
  return modelAvailablePages(model) >= state.pages.length;
}

function compareMetricValues(aValue, bValue, direction) {
  const aMissing = typeof aValue !== "number";
  const bMissing = typeof bValue !== "number";
  if (aMissing || bMissing) {
    if (aMissing && bMissing) return 0;
    return aMissing ? 1 : -1;
  }
  return (aValue - bValue) * direction;
}

function compareCoverage(a, b) {
  const aComplete = modelHasFullCoverage(a);
  const bComplete = modelHasFullCoverage(b);
  if (aComplete === bComplete) return 0;
  return aComplete ? -1 : 1;
}

function parseRoute() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (!raw || raw === "home") return { view: "home" };
  if (!raw.includes("=")) return { view: "detail", pageId: raw };
  const params = new URLSearchParams(raw);
  return {
    view: "detail",
    pageId: params.get("doc") || params.get("page") || "",
    modelId: params.get("model") || "",
  };
}

function detailHash(pageId, modelId = "") {
  const params = new URLSearchParams();
  params.set("doc", pageId);
  if (modelId) params.set("model", modelId);
  return `#${params.toString()}`;
}

function currentRouteHash() {
  return location.hash || "#home";
}

function markRouteApplied() {
  state.appliedRouteHash = currentRouteHash();
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("visible"), 2600);
}

function searchMatcher(rawQuery) {
  const query = rawQuery.trim();
  if (!query) return () => true;
  try {
    const regex = new RegExp(query, "i");
    return (value) => regex.test(value);
  } catch {
    const normalized = query.toLowerCase();
    return (value) => value.toLowerCase().includes(normalized);
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function unescapeHtml(value) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function stripMarkdownTableSeparators(value) {
  return value
    .split(/\r?\n/)
    .filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line))
    .join("\n");
}

function stripStructuralLines(value) {
  return value
    .split(/\r?\n/)
    .filter((line) => !/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line))
    .join("\n");
}

function stripMarkdownEmphasis(value) {
  return value
    .replace(/(?<!\*)\*\*([^*\n]+)\*\*(?!\*)/g, "$1")
    .replace(/(?<!_)__([^_\n]+)__(?!_)/g, "$1")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, "$1");
}

function replaceLayoutSeparators(value) {
  return value
    .split(/\r?\n/)
    .map((line) => (line.includes("|") ? line.replace(/\s*\|\s*/g, " ") : line))
    .join("\n");
}

function normalizeBlankLines(value) {
  const normalized = [];
  let previousBlank = false;
  value.split(/\r?\n/).forEach((line) => {
    const trimmedRight = line.replace(/\s+$/g, "");
    const blank = !trimmedRight.trim();
    if (blank && previousBlank) return;
    normalized.push(trimmedRight);
    previousBlank = blank;
  });
  return normalized.join("\n");
}

function cleanupReadingText(value) {
  return normalizeBlankLines(
    replaceLayoutSeparators(
      stripStructuralLines(
        stripMarkdownEmphasis(
          stripMarkdownTableSeparators(
            unescapeHtml(value)
              .replace(/!\[[^\]]*]\([^)]*\)/g, "")
              .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
              .replace(/^\s*`{3,}.*$/gm, "")
              .replace(/^\s{0,3}#{1,6}\s*/gm, "")
              .replace(/^\s{0,3}>\s?/gm, "")
              .replace(/^[ \t]*(?:[-*+•·][ \t]+)+/gm, "")
              .replace(/<img\b[^>]*>/gi, "")
              .replace(/<[^>\n]+>/g, "")
              .replaceAll("#", "")
          )
        )
      )
    )
  ).trim();
}

function normalizeForScoring(value) {
  if (!value) return "";
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .trim();
}

function prepareScoringText(value) {
  return normalizeForScoring(cleanupReadingText(value));
}

function indexedScoringTextAvailable() {
  return (
    typeof state.currentPage?.groundTruthScoringText === "string" &&
    typeof state.currentResult?.scoringTextContent === "string"
  );
}

function displayedGtText() {
  return state.textView === "raw" ? state.gtText : state.gtScoringText;
}

function displayedOcrText() {
  return state.textView === "raw" ? state.ocrText : state.ocrScoringText;
}

function updateTextViewToggle() {
  const rawActive = state.textView === "raw";
  els.textViewToggles.forEach((toggle) => {
    toggle.textContent = rawActive ? "Raw" : "Norm";
    toggle.title = rawActive ? "Show normalized text panes" : "Show raw text panes";
    toggle.setAttribute("aria-pressed", String(rawActive));
  });
}

function renderTextPanes() {
  els.groundTruthText.textContent = displayedGtText();
  els.ocrText.textContent = displayedOcrText();
  updateTextViewToggle();
}

function toggleTextView() {
  const scrollPosition = getCurrentScrollPosition();
  state.textView = state.textView === "raw" ? "normalized" : "raw";
  renderTextPanes();
  applySyncedScroll(scrollPosition);
}

function buildLevenshteinDiff(reference, hypothesis) {
  let prefix = 0;
  const minLength = Math.min(reference.length, hypothesis.length);
  while (prefix < minLength && reference[prefix] === hypothesis[prefix]) prefix += 1;

  let refEnd = reference.length;
  let predEnd = hypothesis.length;
  while (refEnd > prefix && predEnd > prefix && reference[refEnd - 1] === hypothesis[predEnd - 1]) {
    refEnd -= 1;
    predEnd -= 1;
  }

  const refMiddle = reference.slice(prefix, refEnd);
  const predMiddle = hypothesis.slice(prefix, predEnd);
  const operations = [];
  if (prefix > 0) {
    operations.push({ type: "equal", ref: reference.slice(0, prefix), pred: hypothesis.slice(0, prefix) });
  }

  if (refMiddle.length || predMiddle.length) {
    operations.push(...levenshteinMiddleOperations(refMiddle, predMiddle));
  }

  if (refEnd < reference.length) {
    operations.push({ type: "equal", ref: reference.slice(refEnd), pred: hypothesis.slice(predEnd) });
  }
  return mergeOperations(operations);
}

function levenshteinMiddleOperations(reference, hypothesis) {
  if (!reference.length) return [{ type: "insert", ref: "", pred: hypothesis }];
  if (!hypothesis.length) return [{ type: "delete", ref: reference, pred: "" }];

  const rows = reference.length + 1;
  const cols = hypothesis.length + 1;
  const table = new Uint16Array(rows * cols);

  for (let i = 0; i < rows; i += 1) table[i * cols] = i;
  for (let j = 0; j < cols; j += 1) table[j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const substitutionCost = reference[i - 1] === hypothesis[j - 1] ? 0 : 1;
      const deletion = table[(i - 1) * cols + j] + 1;
      const insertion = table[i * cols + j - 1] + 1;
      const substitution = table[(i - 1) * cols + j - 1] + substitutionCost;
      table[i * cols + j] = Math.min(substitution, deletion, insertion);
    }
  }

  const reversed = [];
  let i = reference.length;
  let j = hypothesis.length;
  while (i > 0 || j > 0) {
    const current = table[i * cols + j];
    if (
      i > 0 &&
      j > 0 &&
      reference[i - 1] === hypothesis[j - 1] &&
      current === table[(i - 1) * cols + j - 1]
    ) {
      reversed.push({ type: "equal", ref: reference[i - 1], pred: hypothesis[j - 1] });
      i -= 1;
      j -= 1;
      continue;
    }
    if (i > 0 && current === table[(i - 1) * cols + j] + 1) {
      reversed.push({ type: "delete", ref: reference[i - 1], pred: "" });
      i -= 1;
    } else if (j > 0 && current === table[i * cols + j - 1] + 1) {
      reversed.push({ type: "insert", ref: "", pred: hypothesis[j - 1] });
      j -= 1;
    } else {
      reversed.push({ type: "replace", ref: reference[i - 1], pred: hypothesis[j - 1] });
      i -= 1;
      j -= 1;
    }
  }

  return mergeOperations(reversed.reverse());
}

function mergeOperations(operations) {
  const merged = [];
  operations.forEach((operation) => {
    if (!operation.ref && !operation.pred) return;
    const previous = merged[merged.length - 1];
    if (previous && previous.type === operation.type) {
      previous.ref += operation.ref;
      previous.pred += operation.pred;
    } else {
      merged.push({ ...operation });
    }
  });
  return merged;
}

function pageModels(page) {
  return Object.entries(page.models)
    .map(([id, result]) => ({ id, ...result }))
    .sort((a, b) => {
      const ac = typeof a.cer === "number" ? a.cer : Number.POSITIVE_INFINITY;
      const bc = typeof b.cer === "number" ? b.cer : Number.POSITIVE_INFINITY;
      return ac - bc || a.id.localeCompare(b.id);
    });
}

function renderDocuments() {
  const matches = searchMatcher(els.docSearch.value);
  const selected = state.currentPage?.id;
  els.docSelect.innerHTML = "";
  state.pages
    .filter((page) => matches(page.id))
    .forEach((page) => {
      const option = document.createElement("option");
      option.value = page.id;
      option.textContent = `${page.id} (${Object.keys(page.models).length})`;
      option.selected = page.id === selected;
      els.docSelect.append(option);
    });
}

function renderModels() {
  const matches = searchMatcher(els.modelSearch.value);
  const selected = state.currentModel;
  els.modelSelect.innerHTML = "";
  if (!state.currentPage) return;
  pageModels(state.currentPage)
    .filter((model) => matches(model.id))
    .forEach((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = `${formatPercent(resultCer(model))}  ${model.id}`;
      option.selected = model.id === selected;
      els.modelSelect.append(option);
    });
}

function renderMetrics(result) {
  const metrics = [
    ["CER", formatPercent(resultCer(result))],
    ["WER", formatPercent(resultWer(result))],
    ["GT chars", resultGtChars(result)],
    ["OCR chars", resultPredChars(result)],
  ];
  els.selectedMetrics.innerHTML = metrics
    .map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function showHome() {
  state.view = "home";
  els.appTitle.textContent = "OCR Diff Summary";
  document.title = "OCR Diff Summary";
  els.homeView.classList.remove("hidden");
  els.detailView.classList.add("hidden");
  els.homeButton.textContent = "Viewer";
  els.homeButton.title = "Open viewer";
  els.homeButton.classList.remove("active");
  renderHomeTable();
}

function showDetail() {
  state.view = "detail";
  els.appTitle.textContent = "OCR Diff Viewer";
  document.title = "OCR Diff Viewer";
  els.homeView.classList.add("hidden");
  els.detailView.classList.remove("hidden");
  els.homeButton.textContent = "Summary";
  els.homeButton.title = "Open summary";
  els.homeButton.classList.remove("active");
}

function homeModels() {
  const matches = searchMatcher(els.homeModelSearch.value);
  const models = [...state.index.models]
    .map((model) => ({
      ...model,
      displayCerMean: modelAvgCer(model.id, model.avgCer),
      displayCerMedian: median(modelMetricValues(model.id, "cer")),
      displayWerMean: modelAvgWer(model.id, model.avgWer),
      displayWerMedian: median(modelMetricValues(model.id, "wer")),
    }))
    .filter((model) => matches(model.id));

  if (state.homeSort.type === "page" && state.homeSort.pageId) {
    const page = state.pages.find((item) => item.id === state.homeSort.pageId);
    const direction = state.homeSort.direction === "desc" ? -1 : 1;
    return models.sort((a, b) => {
      const av = resultMetric(page?.models[a.id], state.homeSort.metric);
      const bv = resultMetric(page?.models[b.id], state.homeSort.metric);
      return compareMetricValues(av, bv, direction) || a.id.localeCompare(b.id);
    });
  }

  if (state.homeSort.type === "alpha") {
    const direction = state.homeSort.direction === "desc" ? -1 : 1;
    return models.sort((a, b) => a.id.localeCompare(b.id) * direction);
  }

  const direction = state.homeSort.direction === "desc" ? -1 : 1;
  return models.sort((a, b) => {
      return (
        compareCoverage(a, b) ||
        compareMetricValues(modelSummaryMetric(a, state.homeSort.metric), modelSummaryMetric(b, state.homeSort.metric), direction) ||
        a.id.localeCompare(b.id)
      );
  });
}

function homePages() {
  const matches = searchMatcher(els.homeDocSearch.value);
  const pages = state.pages.filter((page) => matches(page.id));
  const direction = state.homePageSort.direction === "desc" ? -1 : 1;

  if (state.homePageSort.type === "model" && state.homePageSort.modelId) {
    const metric = state.homePageSort.metric;
    return pages.sort((a, b) => {
      const av = resultMetric(a.models[state.homePageSort.modelId], metric);
      const bv = resultMetric(b.models[state.homePageSort.modelId], metric);
      return compareMetricValues(av, bv, direction) || a.id.localeCompare(b.id);
    });
  }

  return pages.sort((a, b) => a.id.localeCompare(b.id) * direction);
}

function cerClass(value) {
  if (typeof value !== "number") return "missing";
  if (value <= 0.02) return "excellent";
  if (value <= 0.05) return "good";
  if (value <= 0.10) return "ok";
  if (value <= 0.20) return "poor";
  return "bad";
}

function renderHomeTable() {
  if (!state.index) return;
  ensureVisibleSummarySorts();
  updateSummaryColumnToggles();
  updateSummaryLegendToggle();
  const models = homeModels();
  const pages = homePages();
  const documentColumns = selectedSummaryMetrics();
  const aggregateColumns = selectedAggregateColumns();
  const documentColorScales = buildDocumentColorScales(documentColumns);
  const aggregateColorScales = buildAggregateColorScales(models, aggregateColumns);
  const docGroupWidth = Math.max(58, documentColumns.length * 58);
  const sortIndicator = (type, metric, pageId = null) => {
    const active =
      state.homeSort.type === type &&
      state.homeSort.metric === metric &&
      (type !== "page" || state.homeSort.pageId === pageId);
    if (!active) return "";
    return state.homeSort.direction === "asc" ? " ↑" : " ↓";
  };
  const pageSortIndicator = () => {
    if (state.homePageSort.type === "alpha") {
      return state.homePageSort.direction === "asc" ? " A-Z" : " Z-A";
    }
    return `${summaryMetricLabel(state.homePageSort.metric)} ${state.homePageSort.direction === "asc" ? "→" : "←"}`;
  };
  const docGroupIndicator = (pageId) => {
    if (state.homeSort.type !== "page" || state.homeSort.pageId !== pageId) return "";
    return ` ${summaryMetricLabel(state.homeSort.metric)} ${state.homeSort.direction === "asc" ? "↑" : "↓"}`;
  };
  const header = [
    `<tr>`,
    `<th class="sticky-col model-col" rowspan="2">` +
    `<button class="model-alpha-sort" type="button">Model${state.homeSort.type === "alpha" ? (state.homeSort.direction === "asc" ? " A-Z" : " Z-A") : ""}</button>` +
    `<span class="model-col-resizer" title="Resize model column" role="separator" aria-orientation="vertical"></span>` +
    `</th>`,
    ...documentColumns.map((column) => `<th class="metric-group" colspan="2">${column.label}</th>`),
    ...pages.map((page) => {
      const active = state.homeSort.type === "page" && state.homeSort.pageId === page.id;
      const style = `width:${docGroupWidth}px;min-width:${docGroupWidth}px;max-width:${docGroupWidth}px`;
      return (
        `<th class="doc-group ${active ? "sorted" : ""}" colspan="${documentColumns.length}" style="${style}" title="${escapeHtml(`${page.id}: cycle selected metric sort`)}">` +
        `<button class="doc-group-sort" type="button" data-page="${escapeHtml(page.id)}">` +
        `${escapeHtml(page.id)}${docGroupIndicator(page.id)}` +
        `</button>` +
        `</th>`
      );
    }).filter(() => documentColumns.length > 0),
    `</tr>`,
    `<tr>`,
    ...aggregateColumns.map((column) => {
      const active = state.homeSort.type === "aggregate" && state.homeSort.metric === column.metric;
      return (
        `<th class="metric-col aggregate-col ${active ? "sorted" : ""}">` +
        `<button class="avg-sort" type="button" data-sort="${column.metric}">${column.label}${sortIndicator("aggregate", column.metric)}</button>` +
        `</th>`
      );
    }),
    ...pages.flatMap((page) => {
      return documentColumns.map((column) => {
        const active = state.homeSort.type === "page" && state.homeSort.pageId === page.id && state.homeSort.metric === column.id;
        return (
          `<th class="doc-col ${active ? "sorted" : ""}" title="${escapeHtml(`${page.id} ${column.title}`)}">` +
          `<button class="doc-sort" type="button" data-page="${escapeHtml(page.id)}" data-metric="${column.id}">` +
          `${column.label}${sortIndicator("page", column.id, page.id)}` +
          `</button>` +
          `</th>`
        );
      });
    }),
    `</tr>`,
  ].join("");

  const body = models.map((model) => {
    const cells = pages.flatMap((page) => {
      const result = page.models[model.id];
      if (!result) return documentColumns.map(() => `<td class="metric-cell missing">-</td>`);
      const title = summaryMetricTitle(model.id, page.id, result);
      return documentColumns.map((column) => {
        const value = resultMetric(result, column.id);
        const colorValue = documentColorValue(result, column.id);
        return (
          `<td><button class="metric-link ${percentileMetricClass(column.id, colorValue, documentColorScales[column.id])}" type="button" data-page="${escapeHtml(page.id)}" data-model="${escapeHtml(model.id)}" title="${escapeHtml(title)}">` +
          `${formatSummaryMetric(column.id, value)}` +
          `</button></td>`
        );
      });
    }).join("");
    return (
      `<tr>` +
      `<th class="sticky-col model-col" title="${escapeHtml(`Cycle document sort by ${model.id}: selected metrics`)}">` +
      `<button class="model-doc-sort" type="button" data-model="${escapeHtml(model.id)}">` +
      `${escapeHtml(model.id)}${state.homePageSort.type === "model" && state.homePageSort.modelId === model.id ? ` · ${pageSortIndicator()}` : ""}` +
      `</button>` +
      `</th>` +
      aggregateColumns.map((column) => {
        const value = modelSummaryMetric(model, column.metric);
        const className = percentileMetricClass(column.sourceMetric, value, aggregateColorScales[column.metric]);
        return `<td class="metric-col ${column.statistic === "mean" ? "strong" : ""} ${className}">${formatSummaryMetric(column.sourceMetric, value, false)}</td>`;
      }).join("") +
      cells +
      `</tr>`
    );
  }).join("");

  els.summaryLegendPanel.innerHTML = renderSummaryColorLegend(documentColumns, aggregateColumns, documentColorScales, aggregateColorScales);
  els.summaryLegendPanel.classList.toggle("hidden", !state.summaryLegendOpen);
  els.summaryTable.innerHTML = `<thead>${header}</thead><tbody>${body}</tbody>`;
}

async function loadText(path) {
  if (typeof path !== "string") return "";
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${response.status} ${path}`);
  }
  return response.text();
}

async function selectPage(pageId, preferredModel = null) {
  const page = state.pages.find((item) => item.id === pageId);
  if (!page) return;
  showDetail();
  state.currentPage = page;
  const availableModels = pageModels(page);
  state.currentModel = preferredModel && page.models[preferredModel] ? preferredModel : availableModels[0]?.id;
  renderDocuments();
  renderModels();
  await renderSelection({ preserveScroll: false });
}

async function selectModel(modelId) {
  if (!state.currentPage?.models[modelId]) return;
  state.currentModel = modelId;
  renderModels();
  await renderSelection({ preserveScroll: true });
}

async function renderSelection(options = {}) {
  const page = state.currentPage;
  const result = page?.models[state.currentModel];
  if (!page || !result) return;
  const scrollPosition = options.preserveScroll ? getCurrentScrollPosition() : null;
  state.currentResult = result;

  els.pageTitle.textContent = page.id;
  els.pageImage.src = page.image;
  els.pageImage.alt = page.id;
  els.ocrTitle.textContent = state.currentModel;
  renderMetrics(result);

  try {
    const [gtText, ocrText] =
      typeof page.groundTruthText === "string" || typeof result.textContent === "string"
        ? [page.groundTruthText || "", result.textContent || ""]
        : await Promise.all([loadText(page.groundTruth), loadText(result.text)]);
    state.gtText = gtText;
    state.ocrText = ocrText;
    state.gtScoringText =
      typeof page.groundTruthScoringText === "string" ? page.groundTruthScoringText : prepareScoringText(gtText);
    state.ocrScoringText =
      typeof result.scoringTextContent === "string" ? result.scoringTextContent : prepareScoringText(ocrText);
    renderTextPanes();
    renderDiff();
    applySyncedScroll(scrollPosition || { topRatio: 0, leftRatio: 0 });
  } catch (error) {
    state.gtText = "";
    state.ocrText = "";
    state.gtScoringText = "";
    state.ocrScoringText = "";
    renderTextPanes();
    els.diffText.textContent = "";
    showToast(`Could not load text: ${error.message}`);
  }
}

function renderDiff() {
  const hasIndexedScoringText = indexedScoringTextAvailable();
  const reference = hasIndexedScoringText ? state.gtScoringText : prepareScoringText(state.gtText);
  const hypothesis = hasIndexedScoringText ? state.ocrScoringText : prepareScoringText(state.ocrText);
  if (state.diffCriterion === "wer") {
    const referenceWords = reference.split(/\s+/).filter(Boolean);
    const hypothesisWords = hypothesis.split(/\s+/).filter(Boolean);
    const operations = hasIndexedScoringText && state.currentResult?.wordOpcodes
      ? wordOpcodesToOperations(referenceWords, hypothesisWords, state.currentResult.wordOpcodes)
      : buildLevenshteinSequenceDiff(referenceWords, hypothesisWords);
    const counts = countSequenceOperations(operations);
    renderDiffSummary(hasIndexedScoringText ? state.currentResult?.wordOps || counts : counts, counts, "word", true);
    els.diffText.innerHTML = renderWordDiffOperations(operations);
    return;
  }

  const operations = buildLevenshteinDiff(reference, hypothesis);
  const counts = countOperations(operations);
  renderDiffSummary(hasIndexedScoringText ? state.currentResult?.ops || counts : counts, counts, "character", true);
  els.diffText.innerHTML = renderDiffOperations(operations);
}

function buildLevenshteinSequenceDiff(reference, hypothesis) {
  let prefix = 0;
  const minLength = Math.min(reference.length, hypothesis.length);
  while (prefix < minLength && reference[prefix] === hypothesis[prefix]) prefix += 1;

  let refEnd = reference.length;
  let predEnd = hypothesis.length;
  while (refEnd > prefix && predEnd > prefix && reference[refEnd - 1] === hypothesis[predEnd - 1]) {
    refEnd -= 1;
    predEnd -= 1;
  }

  const operations = [];
  if (prefix > 0) {
    operations.push({ type: "equal", ref: reference.slice(0, prefix), pred: hypothesis.slice(0, prefix) });
  }
  if (refEnd > prefix || predEnd > prefix) {
    operations.push(...levenshteinMiddleSequenceOperations(reference.slice(prefix, refEnd), hypothesis.slice(prefix, predEnd)));
  }
  if (refEnd < reference.length) {
    operations.push({ type: "equal", ref: reference.slice(refEnd), pred: hypothesis.slice(predEnd) });
  }
  return mergeSequenceOperations(operations);
}

function wordOpcodesToOperations(reference, hypothesis, opcodes) {
  return mergeSequenceOperations(opcodes.map(([tag, refStart, refEnd, predStart, predEnd]) => {
    const type = tag === "replace" ? "replace" : tag;
    return {
      type,
      ref: reference.slice(refStart, refEnd),
      pred: hypothesis.slice(predStart, predEnd),
    };
  }));
}

function levenshteinMiddleSequenceOperations(reference, hypothesis) {
  if (!reference.length) return [{ type: "insert", ref: [], pred: hypothesis }];
  if (!hypothesis.length) return [{ type: "delete", ref: reference, pred: [] }];

  const rows = reference.length + 1;
  const cols = hypothesis.length + 1;
  const table = new Uint32Array(rows * cols);

  for (let i = 0; i < rows; i += 1) table[i * cols] = i;
  for (let j = 0; j < cols; j += 1) table[j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const substitutionCost = reference[i - 1] === hypothesis[j - 1] ? 0 : 1;
      const deletion = table[(i - 1) * cols + j] + 1;
      const insertion = table[i * cols + j - 1] + 1;
      const substitution = table[(i - 1) * cols + j - 1] + substitutionCost;
      table[i * cols + j] = Math.min(substitution, deletion, insertion);
    }
  }

  const reversed = [];
  let i = reference.length;
  let j = hypothesis.length;
  while (i > 0 || j > 0) {
    const current = table[i * cols + j];
    if (
      i > 0 &&
      j > 0 &&
      reference[i - 1] === hypothesis[j - 1] &&
      current === table[(i - 1) * cols + j - 1]
    ) {
      reversed.push({ type: "equal", ref: [reference[i - 1]], pred: [hypothesis[j - 1]] });
      i -= 1;
      j -= 1;
      continue;
    }
    if (i > 0 && current === table[(i - 1) * cols + j] + 1) {
      reversed.push({ type: "delete", ref: [reference[i - 1]], pred: [] });
      i -= 1;
    } else if (j > 0 && current === table[i * cols + j - 1] + 1) {
      reversed.push({ type: "insert", ref: [], pred: [hypothesis[j - 1]] });
      j -= 1;
    } else {
      reversed.push({ type: "replace", ref: [reference[i - 1]], pred: [hypothesis[j - 1]] });
      i -= 1;
      j -= 1;
    }
  }

  return mergeSequenceOperations(reversed.reverse());
}

function mergeSequenceOperations(operations) {
  const merged = [];
  operations.forEach((operation) => {
    if (!operation.ref.length && !operation.pred.length) return;
    const previous = merged[merged.length - 1];
    if (previous && previous.type === operation.type) {
      previous.ref.push(...operation.ref);
      previous.pred.push(...operation.pred);
    } else {
      merged.push({ type: operation.type, ref: [...operation.ref], pred: [...operation.pred] });
    }
  });
  return merged;
}

function countOperations(operations) {
  const counts = { substitutions: 0, deletions: 0, insertions: 0, editDistance: 0 };
  operations.forEach((operation) => {
    if (operation.type === "replace") {
      const sharedLength = Math.min(operation.ref.length, operation.pred.length);
      counts.substitutions += sharedLength;
      counts.deletions += operation.ref.length - sharedLength;
      counts.insertions += operation.pred.length - sharedLength;
    }
    if (operation.type === "delete") counts.deletions += operation.ref.length;
    if (operation.type === "insert") counts.insertions += operation.pred.length;
  });
  counts.editDistance = counts.substitutions + counts.deletions + counts.insertions;
  return counts;
}

function countSequenceOperations(operations) {
  const counts = { substitutions: 0, deletions: 0, insertions: 0, editDistance: 0 };
  operations.forEach((operation) => {
    if (operation.type === "replace") {
      const sharedLength = Math.min(operation.ref.length, operation.pred.length);
      counts.substitutions += sharedLength;
      counts.deletions += operation.ref.length - sharedLength;
      counts.insertions += operation.pred.length - sharedLength;
    }
    if (operation.type === "delete") counts.deletions += operation.ref.length;
    if (operation.type === "insert") counts.insertions += operation.pred.length;
  });
  counts.editDistance = counts.substitutions + counts.deletions + counts.insertions;
  return counts;
}

function renderDiffSummary(indexOps, renderedOps, unit, checkMismatch) {
  const unitLabel = unit === "word" ? "words" : "characters";
  const metrics = [
    ["Substitutions", indexOps.substitutions ?? "-", "substitution", `GT ${unitLabel} replaced by prediction ${unitLabel}`],
    ["Deletions", indexOps.deletions ?? "-", "deletion", `GT ${unitLabel} missing from the prediction`],
    ["Insertions", indexOps.insertions ?? "-", "insertion", `Extra ${unitLabel} added by the prediction`],
  ];
  const criterion = unit === "word" ? "WER" : "CER";
  const mismatch = checkMismatch && typeof indexOps.editDistance === "number" && indexOps.editDistance !== renderedOps.editDistance;
  els.diffSummary.innerHTML = metrics
    .map(
      ([label, value, className, title]) =>
        `<div class="op-metric ${className}" title="${escapeHtml(title)}"><span>${label}</span><strong>${value}</strong></div>`
    )
    .join("");
  els.diffSummary.title = mismatch
    ? `Warning: rendered diff=${renderedOps.editDistance}, index=${indexOps.editDistance}`
    : `Levenshtein operations used for ${criterion}`;
}

function renderDiffOperations(operations) {
  return operations.map((operation) => {
    if (operation.type === "equal") {
      return `<span class="diff-segment diff-eq">${escapeHtml(operation.ref)}</span>`;
    }
    if (operation.type === "delete") {
      return `<del class="diff-segment diff-del">${renderChangedText(operation.ref)}</del>`;
    }
    if (operation.type === "insert") {
      return `<ins class="diff-segment diff-ins">${renderChangedText(operation.pred)}</ins>`;
    }
    return renderReplacementOperation(operation.ref, operation.pred);
  }).join("");
}

function renderWordDiffOperations(operations) {
  return operations.map((operation) => {
    if (operation.type === "equal") {
      return `<span class="diff-segment diff-eq">${renderWordText(operation.ref)}</span>`;
    }
    if (operation.type === "delete") {
      return `<del class="diff-segment diff-del">${renderWordText(operation.ref)}</del>`;
    }
    if (operation.type === "insert") {
      return `<ins class="diff-segment diff-ins">${renderWordText(operation.pred)}</ins>`;
    }
    return renderWordReplacementOperation(operation.ref, operation.pred);
  }).filter(Boolean).join(" ");
}

function renderWordReplacementOperation(reference, hypothesis) {
  const sharedLength = Math.min(reference.length, hypothesis.length);
  const substitutionRef = reference.slice(0, sharedLength);
  const substitutionPred = hypothesis.slice(0, sharedLength);
  const deletedExtra = reference.slice(sharedLength);
  const insertedExtra = hypothesis.slice(sharedLength);
  const parts = [];

  if (sharedLength > 0) {
    parts.push(
      `<span class="diff-segment diff-mod">` +
      `<del class="diff-mod-ref">${renderWordText(substitutionRef)}</del>` +
      `<ins class="diff-mod-pred">${renderWordText(substitutionPred)}</ins>` +
      `</span>`
    );
  }
  if (deletedExtra.length) {
    parts.push(`<del class="diff-segment diff-del">${renderWordText(deletedExtra)}</del>`);
  }
  if (insertedExtra.length) {
    parts.push(`<ins class="diff-segment diff-ins">${renderWordText(insertedExtra)}</ins>`);
  }
  return parts.join(" ");
}

function renderWordText(words) {
  return words.map((word) => escapeHtml(word)).join(" ");
}

function renderReplacementOperation(reference, hypothesis) {
  const sharedLength = Math.min(reference.length, hypothesis.length);
  const substitutionRef = reference.slice(0, sharedLength);
  const substitutionPred = hypothesis.slice(0, sharedLength);
  const deletedExtra = reference.slice(sharedLength);
  const insertedExtra = hypothesis.slice(sharedLength);
  const parts = [];

  if (sharedLength > 0) {
    parts.push(
      `<span class="diff-segment diff-mod">` +
      `<del class="diff-mod-ref">${renderChangedText(substitutionRef)}</del>` +
      `<ins class="diff-mod-pred">${renderChangedText(substitutionPred)}</ins>` +
      `</span>`
    );
  }
  if (deletedExtra) {
    parts.push(`<del class="diff-segment diff-del">${renderChangedText(deletedExtra)}</del>`);
  }
  if (insertedExtra) {
    parts.push(`<ins class="diff-segment diff-ins">${renderChangedText(insertedExtra)}</ins>`);
  }
  return parts.join("");
}

function renderChangedText(value) {
  return Array.from(value).map((char) => {
    if (char === " ") return `<span class="diff-space" title="space">·</span>`;
    if (char === "\n") return `<span class="diff-newline" title="line break">↵</span>\n`;
    if (char === "\t") return `<span class="diff-space" title="tab">→</span>`;
    return escapeHtml(char);
  }).join("");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setSummaryModelWidth(value) {
  const clamped = clamp(value, 240, 720);
  state.summaryModelWidth = clamped;
  document.documentElement.style.setProperty("--summary-model-width", `${clamped}px`);
  localStorage.setItem("ocrDiffSummaryModelWidth", String(clamped));
}

function startSummaryModelResize(event) {
  event.preventDefault();
  document.body.classList.add("resizing-summary-model");
  event.currentTarget.setPointerCapture(event.pointerId);
  const startX = event.clientX;
  const startWidth = state.summaryModelWidth;

  const move = (moveEvent) => {
    setSummaryModelWidth(startWidth + moveEvent.clientX - startX);
  };

  const stop = () => {
    document.body.classList.remove("resizing-summary-model");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
}

function restoreSummaryModelWidth() {
  const rawWidth = localStorage.getItem("ocrDiffSummaryModelWidth");
  const storedWidth = rawWidth === null ? NaN : Number(rawWidth);
  setSummaryModelWidth(Number.isFinite(storedWidth) ? storedWidth : state.summaryModelWidth);
}

function scrollPanes() {
  return {
    gt: els.groundTruthText,
    ocr: els.ocrText,
    diff: els.diffText,
  };
}

function maxScrollTop(element) {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function maxScrollLeft(element) {
  return Math.max(0, element.scrollWidth - element.clientWidth);
}

function getScrollPosition(element) {
  const topMax = maxScrollTop(element);
  const leftMax = maxScrollLeft(element);
  return {
    topRatio: topMax > 0 ? element.scrollTop / topMax : 0,
    leftRatio: leftMax > 0 ? element.scrollLeft / leftMax : 0,
  };
}

function getCurrentScrollPosition() {
  return getScrollPosition(scrollPanes()[state.scrollSource] || els.groundTruthText);
}

function applySyncedScroll(position, sourceElement = null) {
  state.syncingScroll = true;
  Object.values(scrollPanes()).forEach((element) => {
    if (element === sourceElement) return;
    element.scrollTop = position.topRatio * maxScrollTop(element);
    element.scrollLeft = position.leftRatio * maxScrollLeft(element);
  });
  window.requestAnimationFrame(() => {
    state.syncingScroll = false;
  });
}

function syncTextScroll(sourceName) {
  if (state.syncingScroll) return;
  const sourceElement = scrollPanes()[sourceName];
  if (!sourceElement) return;
  state.scrollSource = sourceName;
  applySyncedScroll(getScrollPosition(sourceElement), sourceElement);
}

function nearestHorizontalScroller(target) {
  let element = target instanceof Element ? target : target?.parentElement;
  while (element && element !== document.body) {
    const style = window.getComputedStyle(element);
    const canScroll = /(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
    if (canScroll) return element;
    element = element.parentElement;
  }
  return document.scrollingElement;
}

function triggerHorizontalEdgeBounce(direction, scroller) {
  const target = scroller === document.scrollingElement ? document.body : scroller;
  const className = direction < 0 ? "horizontal-edge-left" : "horizontal-edge-right";
  target.classList.remove("horizontal-edge-left", "horizontal-edge-right");
  void target.offsetWidth;
  target.classList.add(className);
  window.clearTimeout(horizontalBounceTimers.get(target));
  horizontalBounceTimers.set(
    target,
    window.setTimeout(() => {
      target.classList.remove(className);
      horizontalBounceTimers.delete(target);
    }, 220)
  );
}

function handleHorizontalWheelEdge(event) {
  if (Math.abs(event.deltaX) < 2 || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
  const scroller = nearestHorizontalScroller(event.target);
  const maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  const atLeft = scroller.scrollLeft <= 0;
  const atRight = scroller.scrollLeft >= maxLeft - 1;
  if ((event.deltaX < 0 && atLeft) || (event.deltaX > 0 && atRight) || maxLeft === 0) {
    event.preventDefault();
    triggerHorizontalEdgeBounce(event.deltaX, scroller);
  }
}

function setZoom(value) {
  state.zoom = clamp(value, 25, 500);
  els.zoomRange.value = String(Math.round(state.zoom));
  document.documentElement.style.setProperty("--image-width", `${state.zoom}%`);
}

function zoomImageFromWheel(event) {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const oldZoom = state.zoom;
  const rect = els.imageFrame.getBoundingClientRect();
  const offsetX = event.clientX - rect.left;
  const offsetY = event.clientY - rect.top;
  const contentX = els.imageFrame.scrollLeft + offsetX;
  const contentY = els.imageFrame.scrollTop + offsetY;
  const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 18 : event.deltaY;
  const nextZoom = oldZoom * Math.exp(-delta * 0.0015);

  setZoom(nextZoom);

  const ratio = state.zoom / oldZoom;
  els.imageFrame.scrollLeft = contentX * ratio - offsetX;
  els.imageFrame.scrollTop = contentY * ratio - offsetY;
}

function setGridSize(axis, value) {
  const clamped = clamp(value, 25, 75);
  if (axis === "x") {
    state.gridLeft = clamped;
    els.comparisonGrid.style.setProperty("--grid-left", `${clamped}%`);
    localStorage.setItem("ocrDiffGridLeft", String(clamped));
  } else {
    state.gridTop = clamped;
    els.comparisonGrid.style.setProperty("--grid-top", `${clamped}%`);
    localStorage.setItem("ocrDiffGridTop", String(clamped));
  }
}

function startGridResize(axis, event) {
  event.preventDefault();
  document.body.classList.add("resizing-grid");
  event.currentTarget.setPointerCapture(event.pointerId);

  const move = (moveEvent) => {
    const rect = els.comparisonGrid.getBoundingClientRect();
    const pct = axis === "x"
      ? ((moveEvent.clientX - rect.left) / rect.width) * 100
      : ((moveEvent.clientY - rect.top) / rect.height) * 100;
    setGridSize(axis, pct);
  };

  const stop = () => {
    document.body.classList.remove("resizing-grid");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
}

function setSidebarWidth(value) {
  const clamped = clamp(value, 220, 520);
  state.sidebarWidth = clamped;
  els.layout.style.setProperty("--sidebar-width", `${clamped}px`);
  localStorage.setItem("ocrDiffSidebarWidth", String(clamped));
}

function startSidebarResize(event) {
  event.preventDefault();
  if (els.layout.classList.contains("sidebar-collapsed")) return;
  document.body.classList.add("resizing-sidebar");
  event.currentTarget.setPointerCapture(event.pointerId);

  const move = (moveEvent) => {
    const rect = els.layout.getBoundingClientRect();
    setSidebarWidth(moveEvent.clientX - rect.left);
  };

  const stop = () => {
    document.body.classList.remove("resizing-sidebar");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
}

function setSidebarPanelSplit(value) {
  const clamped = clamp(value, 20, 80);
  state.sidebarPanelSplit = clamped;
  els.sidebarContent.style.setProperty("--sidebar-panel-split", `calc(${clamped}% - 4px)`);
  els.sidebarPanelSplitter.setAttribute("aria-valuenow", String(Math.round(clamped)));
  localStorage.setItem("ocrDiffSidebarPanelSplit", String(clamped));
}

function startSidebarPanelResize(event) {
  event.preventDefault();
  if (els.layout.classList.contains("sidebar-collapsed")) return;
  document.body.classList.add("resizing-sidebar-panel");
  event.currentTarget.setPointerCapture(event.pointerId);

  const move = (moveEvent) => {
    const rect = els.sidebarContent.getBoundingClientRect();
    if (!rect.height) return;
    const pct = ((moveEvent.clientY - rect.top) / rect.height) * 100;
    setSidebarPanelSplit(pct);
  };

  const stop = () => {
    document.body.classList.remove("resizing-sidebar-panel");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
}

function restoreGridSize() {
  const rawLeft = localStorage.getItem("ocrDiffGridLeft");
  const rawTop = localStorage.getItem("ocrDiffGridTop");
  if (rawLeft !== null) {
    const storedLeft = Number(rawLeft);
    if (Number.isFinite(storedLeft)) {
      setGridSize("x", storedLeft);
    }
  } else {
    setGridSize("x", 50);
  }
  if (rawTop !== null) {
    const storedTop = Number(rawTop);
    if (Number.isFinite(storedTop)) {
      setGridSize("y", storedTop);
    }
  } else {
    setGridSize("y", 50);
  }
}

function restoreSidebarWidth() {
  const rawWidth = localStorage.getItem("ocrDiffSidebarWidth");
  const storedWidth = rawWidth === null ? NaN : Number(rawWidth);
  setSidebarWidth(Number.isFinite(storedWidth) ? storedWidth : state.sidebarWidth);
}

function restoreSidebarPanelSplit() {
  const rawSplit = localStorage.getItem("ocrDiffSidebarPanelSplit");
  const storedSplit = rawSplit === null ? NaN : Number(rawSplit);
  setSidebarPanelSplit(Number.isFinite(storedSplit) ? storedSplit : state.sidebarPanelSplit);
}

function toggleSidebar() {
  const collapsed = els.layout.classList.toggle("sidebar-collapsed");
  els.sidebarToggle.textContent = collapsed ? "›" : "‹";
  els.sidebarToggle.title = collapsed ? "Expand panel" : "Collapse panel";
  els.sidebarToggle.setAttribute("aria-label", collapsed ? "Expand panel" : "Collapse panel");
  els.sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    showToast("Copied");
  } catch {
    showToast("Could not copy");
  }
}

async function init() {
  try {
    if (window.OCR_DIFF_VIEWER_INDEX) {
      state.index = window.OCR_DIFF_VIEWER_INDEX;
    } else {
      const response = await fetch("data/index.json");
      state.index = await response.json();
    }
    state.pages = state.index.pages.filter((page) => Object.keys(page.models).length > 0);
    els.datasetSummary.textContent = `${state.index.counts.pages} documents · ${state.index.counts.models} models · ${state.index.counts.pageModelResults} results`;
    renderDocuments();
    await applyRoute();
  } catch (error) {
    els.datasetSummary.textContent = "Index unavailable";
    showToast(error.message);
  }
}

async function applyRoute() {
  const routeHash = currentRouteHash();
  if (state.appliedRouteHash === routeHash) return;
  state.appliedRouteHash = routeHash;
  const route = parseRoute();
  if (route.view === "home") {
    showHome();
    return;
  }
  await selectPage(route.pageId || state.pages[0]?.id, route.modelId);
}

els.docSearch.addEventListener("input", renderDocuments);
els.modelSearch.addEventListener("input", renderModels);
els.docSelect.addEventListener("change", () => {
  history.pushState(null, "", detailHash(els.docSelect.value, state.currentModel));
  markRouteApplied();
  selectPage(els.docSelect.value, state.currentModel);
});
els.modelSelect.addEventListener("change", () => {
  history.pushState(null, "", detailHash(state.currentPage.id, els.modelSelect.value));
  markRouteApplied();
  selectModel(els.modelSelect.value);
});
els.homeButton.addEventListener("click", () => {
  if (state.view === "home") {
    const pageId = state.currentPage?.id || state.pages[0]?.id;
    const modelId = state.currentModel || "";
    if (!pageId) return;
    history.pushState(null, "", detailHash(pageId, modelId));
    markRouteApplied();
    selectPage(pageId, modelId);
    return;
  }
  history.pushState(null, "", "#home");
  markRouteApplied();
  showHome();
});
els.homeDocSearch.addEventListener("input", renderHomeTable);
els.homeModelSearch.addEventListener("input", renderHomeTable);
els.summaryColumnToggles.forEach((toggle) => {
  toggle.addEventListener("click", () => toggleSummaryColumn(toggle.dataset.summaryColumn));
});
els.summaryLegendToggle.addEventListener("click", toggleSummaryLegend);
els.sortModelsAlpha.addEventListener("click", () => {
  const sameSort = state.homeSort.type === "alpha";
  state.homeSort = {
    type: "alpha",
    metric: null,
    pageId: null,
    direction: sameSort && state.homeSort.direction === "asc" ? "desc" : "asc",
  };
  renderHomeTable();
});
els.sortDocsAlpha.addEventListener("click", () => {
  const sameSort = state.homePageSort.type === "alpha";
  state.homePageSort = {
    type: "alpha",
    modelId: null,
    metric: selectedDocSortMetric(),
    direction: sameSort && state.homePageSort.direction === "asc" ? "desc" : "asc",
  };
  renderHomeTable();
});
els.summaryTable.addEventListener("click", (event) => {
  const modelAlphaTarget = event.target.closest(".model-alpha-sort");
  if (modelAlphaTarget) {
    const sameSort = state.homeSort.type === "alpha";
    state.homeSort = {
      type: "alpha",
      metric: null,
      pageId: null,
      direction: sameSort && state.homeSort.direction === "asc" ? "desc" : "asc",
    };
    renderHomeTable();
    return;
  }

  const modelDocTarget = event.target.closest(".model-doc-sort");
  if (modelDocTarget) {
    state.homePageSort = nextModelPageSort(modelDocTarget.dataset.model);
    renderHomeTable();
    return;
  }

  const avgTarget = event.target.closest(".avg-sort");
  if (avgTarget) {
    const metric = avgTarget.dataset.sort;
    const sameColumn = state.homeSort.type === "aggregate" && state.homeSort.metric === metric;
    state.homeSort = {
      type: "aggregate",
      metric,
      pageId: null,
      direction: sameColumn && state.homeSort.direction === "asc" ? "desc" : "asc",
    };
    renderHomeTable();
    return;
  }

  const docGroupTarget = event.target.closest(".doc-group-sort");
  if (docGroupTarget) {
    state.homeSort = nextDocumentSort(docGroupTarget.dataset.page);
    renderHomeTable();
    return;
  }

  const sortTarget = event.target.closest(".doc-sort");
  if (sortTarget) {
    const pageId = sortTarget.dataset.page;
    const metric = sortTarget.dataset.metric;
    const sameColumn = state.homeSort.type === "page" && state.homeSort.pageId === pageId && state.homeSort.metric === metric;
    state.homeSort = {
      type: "page",
      metric,
      pageId,
      direction: sameColumn && state.homeSort.direction === "asc" ? "desc" : "asc",
    };
    renderHomeTable();
    return;
  }

  const target = event.target.closest(".metric-link");
  if (!target) return;
  const pageId = target.dataset.page;
  const modelId = target.dataset.model;
  history.pushState(null, "", detailHash(pageId, modelId));
  markRouteApplied();
  selectPage(pageId, modelId);
});
els.summaryTable.addEventListener("pointerdown", (event) => {
  const target = event.target.closest(".model-col-resizer");
  if (!target) return;
  startSummaryModelResize(event);
});
window.addEventListener("popstate", applyRoute);
window.addEventListener("hashchange", applyRoute);
window.addEventListener("wheel", handleHorizontalWheelEdge, { passive: false, capture: true });
els.groundTruthText.addEventListener("scroll", () => syncTextScroll("gt"));
els.ocrText.addEventListener("scroll", () => syncTextScroll("ocr"));
els.diffText.addEventListener("scroll", () => syncTextScroll("diff"));
els.textViewToggles.forEach((toggle) => toggle.addEventListener("click", toggleTextView));
els.diffCriterionSelect.addEventListener("change", () => {
  state.diffCriterion = els.diffCriterionSelect.value;
  renderDiff();
});
els.zoomRange.addEventListener("input", () => setZoom(Number(els.zoomRange.value)));
els.imageFrame.addEventListener("wheel", zoomImageFromWheel, { passive: false });
els.verticalSplitter.addEventListener("pointerdown", (event) => startGridResize("x", event));
els.horizontalSplitter.addEventListener("pointerdown", (event) => startGridResize("y", event));
els.sidebarToggle.addEventListener("click", toggleSidebar);
els.sidebarResizer.addEventListener("pointerdown", startSidebarResize);
els.sidebarPanelSplitter.addEventListener("pointerdown", startSidebarPanelResize);
document.getElementById("zoomOut").addEventListener("click", () => setZoom(state.zoom - 10));
document.getElementById("zoomIn").addEventListener("click", () => setZoom(state.zoom + 10));
document.getElementById("copyGt").addEventListener("click", () => copyText(displayedGtText()));
document.getElementById("copyOcr").addEventListener("click", () => copyText(displayedOcrText()));

setZoom(100);
restoreGridSize();
restoreSidebarWidth();
restoreSidebarPanelSplit();
restoreSummaryModelWidth();
init();
