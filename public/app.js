const state = {
  index: null,
  pages: [],
  view: "home",
  currentPage: null,
  currentModel: null,
  currentResult: null,
  gtText: "",
  ocrText: "",
  zoom: 100,
  gridLeft: 50,
  gridTop: 50,
  sidebarWidth: 300,
  summaryModelWidth: 360,
  syncingScroll: false,
  scrollSource: "gt",
  homeSort: { type: "aggregate", metric: "cerMedian", pageId: null, direction: "asc" },
  homePageSort: { type: "alpha", modelId: null, metric: "cer", direction: "asc" },
  diffCriterion: "cer",
  appliedRouteHash: "",
};

const horizontalBounceTimers = new WeakMap();

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
  summaryTable: document.getElementById("summaryTable"),
  docSearch: document.getElementById("docSearch"),
  docSelect: document.getElementById("docSelect"),
  modelSearch: document.getElementById("modelSearch"),
  modelSelect: document.getElementById("modelSelect"),
  pageTitle: document.getElementById("pageTitle"),
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
  const getter = metric === "wer" ? resultWer : resultCer;
  return state.pages
    .map((page) => getter(page.models[modelId]))
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
  if (metric === "cerMean") return model.displayCerMean;
  if (metric === "cerMedian") return model.displayCerMedian;
  if (metric === "werMean") return model.displayWerMean;
  if (metric === "werMedian") return model.displayWerMedian;
  return null;
}

function selectedDocSortMetric() {
  return "cer";
}

function resultMetric(result, metric) {
  return metric === "wer" ? resultWer(result) : resultCer(result);
}

function nextDocumentSort(pageId) {
  const samePage = state.homeSort.type === "page" && state.homeSort.pageId === pageId;
  if (!samePage) return { type: "page", metric: "cer", pageId, direction: "asc" };
  if (state.homeSort.metric === "cer" && state.homeSort.direction === "asc") {
    return { type: "page", metric: "cer", pageId, direction: "desc" };
  }
  if (state.homeSort.metric === "cer" && state.homeSort.direction === "desc") {
    return { type: "page", metric: "wer", pageId, direction: "asc" };
  }
  if (state.homeSort.metric === "wer" && state.homeSort.direction === "asc") {
    return { type: "page", metric: "wer", pageId, direction: "desc" };
  }
  return { type: "page", metric: "cer", pageId, direction: "asc" };
}

function nextModelPageSort(modelId) {
  const sameModel = state.homePageSort.type === "model" && state.homePageSort.modelId === modelId;
  if (!sameModel) return { type: "model", modelId, metric: "cer", direction: "asc" };
  if (state.homePageSort.metric === "cer" && state.homePageSort.direction === "asc") {
    return { type: "model", modelId, metric: "cer", direction: "desc" };
  }
  if (state.homePageSort.metric === "cer" && state.homePageSort.direction === "desc") {
    return { type: "model", modelId, metric: "wer", direction: "asc" };
  }
  if (state.homePageSort.metric === "wer" && state.homePageSort.direction === "asc") {
    return { type: "model", modelId, metric: "wer", direction: "desc" };
  }
  return { type: "model", modelId, metric: "cer", direction: "asc" };
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
  const models = homeModels();
  const pages = homePages();
  const aggregateColumns = [
    { metric: "cerMean", group: "CER", label: "Mean" },
    { metric: "cerMedian", group: "CER", label: "Median" },
    { metric: "werMean", group: "WER", label: "Mean" },
    { metric: "werMedian", group: "WER", label: "Median" },
  ];
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
    return `${state.homePageSort.metric.toUpperCase()} ${state.homePageSort.direction === "asc" ? "→" : "←"}`;
  };
  const docGroupIndicator = (pageId) => {
    if (state.homeSort.type !== "page" || state.homeSort.pageId !== pageId) return "";
    return ` ${state.homeSort.metric.toUpperCase()} ${state.homeSort.direction === "asc" ? "↑" : "↓"}`;
  };
  const header = [
    `<tr>`,
    `<th class="sticky-col model-col" rowspan="2">` +
    `<button class="model-alpha-sort" type="button">Model${state.homeSort.type === "alpha" ? (state.homeSort.direction === "asc" ? " A-Z" : " Z-A") : ""}</button>` +
    `<span class="model-col-resizer" title="Resize model column" role="separator" aria-orientation="vertical"></span>` +
    `</th>`,
    `<th class="metric-group" colspan="2">CER</th>`,
    `<th class="metric-group" colspan="2">WER</th>`,
    ...pages.map((page) => {
      const active = state.homeSort.type === "page" && state.homeSort.pageId === page.id;
      return (
        `<th class="doc-group ${active ? "sorted" : ""}" colspan="2" title="${escapeHtml(`${page.id}: cycle CER/WER sort`)}">` +
        `<button class="doc-group-sort" type="button" data-page="${escapeHtml(page.id)}">` +
        `${escapeHtml(page.id)}${docGroupIndicator(page.id)}` +
        `</button>` +
        `</th>`
      );
    }),
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
      return ["cer", "wer"].map((metric) => {
        const active = state.homeSort.type === "page" && state.homeSort.pageId === page.id && state.homeSort.metric === metric;
        return (
          `<th class="doc-col ${active ? "sorted" : ""}" title="${escapeHtml(`${page.id} ${metric.toUpperCase()}`)}">` +
          `<button class="doc-sort" type="button" data-page="${escapeHtml(page.id)}" data-metric="${metric}">` +
          `${metric.toUpperCase()}${sortIndicator("page", metric, page.id)}` +
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
      if (!result) return [`<td class="metric-cell missing">-</td>`, `<td class="metric-cell missing">-</td>`];
      const cer = resultCer(result);
      const wer = resultWer(result);
      const title = `${model.id} / ${page.id}\nCER ${formatPercent(cer)}\nWER ${formatPercent(wer)}`;
      return [
        `<td><button class="metric-link ${cerClass(cer)}" type="button" data-page="${escapeHtml(page.id)}" data-model="${escapeHtml(model.id)}" title="${escapeHtml(title)}">${formatCompactPercent(cer)}</button></td>`,
        `<td><button class="metric-link ${cerClass(wer)}" type="button" data-page="${escapeHtml(page.id)}" data-model="${escapeHtml(model.id)}" title="${escapeHtml(title)}">${formatCompactPercent(wer)}</button></td>`,
      ];
    }).join("");
    return (
      `<tr>` +
      `<th class="sticky-col model-col" title="${escapeHtml(`Cycle document sort by ${model.id}: CER/WER`)}">` +
      `<button class="model-doc-sort" type="button" data-model="${escapeHtml(model.id)}">` +
      `${escapeHtml(model.id)}${state.homePageSort.type === "model" && state.homePageSort.modelId === model.id ? ` · ${pageSortIndicator()}` : ""}` +
      `</button>` +
      `</th>` +
      `<td class="metric-col strong">${formatPercent(model.displayCerMean)}</td>` +
      `<td class="metric-col">${formatPercent(model.displayCerMedian)}</td>` +
      `<td class="metric-col strong">${formatPercent(model.displayWerMean)}</td>` +
      `<td class="metric-col">${formatPercent(model.displayWerMedian)}</td>` +
      cells +
      `</tr>`
    );
  }).join("");

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
    els.groundTruthText.textContent = gtText;
    els.ocrText.textContent = ocrText;
    renderDiff();
    applySyncedScroll(scrollPosition || { topRatio: 0, leftRatio: 0 });
  } catch (error) {
    state.gtText = "";
    state.ocrText = "";
    els.groundTruthText.textContent = "";
    els.ocrText.textContent = "";
    els.diffText.textContent = "";
    showToast(`Could not load text: ${error.message}`);
  }
}

function renderDiff() {
  const reference = prepareScoringText(state.gtText);
  const hypothesis = prepareScoringText(state.ocrText);
  if (state.diffCriterion === "wer") {
    const referenceWords = reference.split(/\s+/).filter(Boolean);
    const hypothesisWords = hypothesis.split(/\s+/).filter(Boolean);
    const operations = state.currentResult?.wordOpcodes
      ? wordOpcodesToOperations(referenceWords, hypothesisWords, state.currentResult.wordOpcodes)
      : buildLevenshteinSequenceDiff(referenceWords, hypothesisWords);
    const counts = countSequenceOperations(operations);
    renderDiffSummary(state.currentResult?.wordOps || counts, counts, "word", true);
    els.diffText.innerHTML = renderWordDiffOperations(operations);
    return;
  }

  const operations = buildLevenshteinDiff(reference, hypothesis);
  const counts = countOperations(operations);
  renderDiffSummary(state.currentResult?.ops || counts, counts, "character", true);
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
document.getElementById("zoomOut").addEventListener("click", () => setZoom(state.zoom - 10));
document.getElementById("zoomIn").addEventListener("click", () => setZoom(state.zoom + 10));
document.getElementById("copyGt").addEventListener("click", () => copyText(state.gtText));
document.getElementById("copyOcr").addEventListener("click", () => copyText(state.ocrText));

setZoom(100);
restoreGridSize();
restoreSidebarWidth();
restoreSummaryModelWidth();
init();
