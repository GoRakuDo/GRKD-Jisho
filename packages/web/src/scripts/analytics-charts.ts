/**
 * analytics-charts.ts — uPlot グラフレンダリング、データフェッチ、DOM更新
 *
 * DESIGN.md 準拠の色・フォント・スペーシング。
 * Astro の <script> タグから import して使う。
 */
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

/* ── Types ──────────────────────────────────────────── */

export interface HourlyPoint {
  hour: string; // ISO
  lookups: number;
  cacheHits: number;
  cacheMisses: number;
  llmGemini: number;
  llmOpenrouter: number;
}

export interface BucketData {
  totalLookups: number;
  cacheHitRate: number; // 0–1
  llmUsage: { gemini: number; openrouter: number };
  hourly: HourlyPoint[];
}

export interface AnalyticsData {
  period: string;
  buckets: Record<string, BucketData>;
  popularQueries: Array<{ query: string; count: number }>;
  dictionaryHits: Array<{ dictionaryName: string; hitCount: number }>;
}

/* ─── PERIOD CONFIG ─────────────────────────────────── */

export const PERIODS = ["1d", "3d", "7d", "2w", "3w", "1m", "3m"] as const;
export type Period = (typeof PERIODS)[number];

/* ─── DESIGN TOKENS ─────────────────────────────────── */

const COLORS = {
  /** Primary chart series — from task spec */
  series1: "oklch(0.623 0.214 259.815)",
  /** Secondary chart series — from task spec */
  series2: "oklch(0.546 0.245 262.881)",
  /** Grid lines */
  grid: "oklch(0.9 0.01 260)",
  /** Axis labels */
  axis: "oklch(0.57 0.014 255)",
  /** Tooltip background (graphite-900, not pure black) */
  tooltipBg: "oklch(0.2 0.018 255)",
  /** Tooltip text (porcelain-50, not pure white) */
  tooltipText: "oklch(0.97 0.012 95)",
  /** Graphite-500 for muted elements */
  muted: "oklch(0.57 0.014 255)",
  /** Graphite-800 for headings */
  heading: "oklch(0.27 0.018 255)",
  /** Porcelain-50 for page bg */
  pageBg: "oklch(0.97 0.012 95)",
} as const;

const FONT_MONO = '"JetBrains Mono", "IBM Plex Mono", SFMono-Regular, ui-monospace, monospace';

/* ─── UPlot INSTANCES ───────────────────────────────── */

let requestRateChart: uPlot | null = null;
let cacheRateChart: uPlot | null = null;

/* ─── DATA HELPERS ──────────────────────────────────── */

/** Flatten hourly data from all buckets, sorted chronologically */
function flattenHourly(buckets: Record<string, BucketData>): HourlyPoint[] {
  const all: HourlyPoint[] = [];
  const keys = Object.keys(buckets).sort();
  for (const key of keys) {
    const b = buckets[key];
    if (!b) continue;
    for (const pt of b.hourly) {
      all.push(pt);
    }
  }
  all.sort((a, b) => new Date(a.hour).getTime() - new Date(b.hour).getTime());
  return all;
}

/** Build uPlot data for request rate chart (2 series: lookups, misses) */
function buildReqRateData(hourly: HourlyPoint[]): uPlot.AlignedData {
  const t: number[] = [];
  const lookups: number[] = [];
  const misses: number[] = [];
  for (const pt of hourly) {
    t.push(new Date(pt.hour).getTime() / 1000);
    lookups.push(pt.lookups);
    misses.push(pt.cacheMisses);
  }
  return [t, lookups, misses];
}

/** Build uPlot data for cache hit rate chart (1 series: percentage) */
function buildCacheRateData(hourly: HourlyPoint[]): uPlot.AlignedData {
  const t: number[] = [];
  const rates: number[] = [];
  for (const pt of hourly) {
    t.push(new Date(pt.hour).getTime() / 1000);
    // Cache Hit Rate は全 lookup を母数にする。
    // cacheMisses は「レスポンスが作れた失敗分」だけなので、母数にするとズレる。
    rates.push(pt.lookups > 0 ? +((pt.cacheHits / pt.lookups) * 100).toFixed(1) : 0);
  }
  return [t, rates];
}

/** Format timestamp (seconds) to Jakarta time label */
function fmtTime(tsSec: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(tsSec * 1000));
}

/* ─── UPLOT OPTIONS ──────────────────────────────────── */

function reqRateOptions(container: HTMLElement): uPlot.Options {
  const W = container.clientWidth || 600;

  return {
    width: W,
    height: 300,
    cursor: {
      show: true,
      drag: { x: false, y: false },
    },
    select: { show: false, left: 0, top: 0, width: 0, height: 0 },
    legend: { show: true },
    axes: [
      {
        stroke: COLORS.axis,
        grid: { stroke: COLORS.grid, width: 1 },
        ticks: { stroke: COLORS.grid, width: 1 },
        font: `11px ${FONT_MONO}`,
        values: (_self: uPlot, ticks: number[]) => ticks.map(fmtTime),
      },
      {
        stroke: COLORS.axis,
        grid: { stroke: COLORS.grid, width: 1 },
        ticks: { stroke: COLORS.grid, width: 1 },
        font: `11px ${FONT_MONO}`,
        size: 50,
        label: "requests / hour",
        labelSize: 14,
        labelFont: `11px ${FONT_MONO}`,
      },
    ],
    series: [
      {},
      {
        label: "Lookups",
        stroke: COLORS.series1,
        width: 2,
        points: { size: 4, stroke: COLORS.series1, width: 1 },
        fill: `${COLORS.series1}15`,
      },
      {
        label: "Cache Misses",
        stroke: COLORS.series2,
        width: 1.5,
        points: { size: 3, stroke: COLORS.series2, width: 1 },
        dash: [6, 3],
      },
    ],
  };
}

function cacheRateOptions(container: HTMLElement): uPlot.Options {
  const W = container.clientWidth || 600;

  return {
    width: W,
    height: 300,
    cursor: {
      show: true,
      drag: { x: false, y: false },
    },
    select: { show: false, left: 0, top: 0, width: 0, height: 0 },
    legend: { show: true },
    scales: {
      x: { time: true },
      y: { range: [0, 100] },
    },
    axes: [
      {
        stroke: COLORS.axis,
        grid: { stroke: COLORS.grid, width: 1 },
        ticks: { stroke: COLORS.grid, width: 1 },
        font: `11px ${FONT_MONO}`,
        values: (_self: uPlot, ticks: number[]) => ticks.map(fmtTime),
      },
      {
        stroke: COLORS.axis,
        grid: { stroke: COLORS.grid, width: 1 },
        ticks: { stroke: COLORS.grid, width: 1 },
        font: `11px ${FONT_MONO}`,
        size: 50,
        label: "hit rate %",
        labelSize: 14,
        labelFont: `11px ${FONT_MONO}`,
      },
    ],
    series: [
      {},
      {
        label: "Cache Hit Rate",
        stroke: COLORS.series1,
        width: 2,
        points: { size: 4, stroke: COLORS.series1, width: 1 },
        fill: `${COLORS.series1}15`,
      },
    ],
  };
}

/* ─── INIT / RENDER ─────────────────────────────────── */

export function initRequestRateChart(
  container: HTMLElement,
  data: AnalyticsData,
): uPlot {
  const hourly = flattenHourly(data.buckets);
  const uData = buildReqRateData(hourly);
  const opts = reqRateOptions(container);

  if (requestRateChart) {
    requestRateChart.setData(uData);
    return requestRateChart;
  }

  requestRateChart = new uPlot(opts, uData, container);
  return requestRateChart;
}

export function initCacheRateChart(
  container: HTMLElement,
  data: AnalyticsData,
): uPlot {
  const hourly = flattenHourly(data.buckets);
  const uData = buildCacheRateData(hourly);
  const opts = cacheRateOptions(container);

  if (cacheRateChart) {
    cacheRateChart.setData(uData);
    return cacheRateChart;
  }

  cacheRateChart = new uPlot(opts, uData, container);
  return cacheRateChart;
}

/* ─── PERIOD BUTTONS ────────────────────────────────── */

export function renderPeriodButtons(
  container: HTMLElement,
  active: Period,
  onChange: (period: Period) => void,
): void {
  container.innerHTML = "";
  for (const p of PERIODS) {
    const btn = document.createElement("button");
    btn.textContent = p;
    btn.className = `analytics-period-btn ${p === active ? "is-active" : ""}`;
    btn.dataset.period = p;
    btn.addEventListener("click", () => onChange(p));
    container.appendChild(btn);
  }
}

/* ─── METRIC CARDS ──────────────────────────────────── */

export function renderMetrics(
  container: HTMLElement,
  data: AnalyticsData,
): void {
  // Sum across all buckets
  const bucketKeys = Object.keys(data.buckets);
  let totalLookups = 0;
  let totalCacheHits = 0;
  let totalLlmCalls = 0;
  let totalGemini = 0;
  let totalOpenrouter = 0;

  for (const key of bucketKeys) {
    const b = data.buckets[key];
    if (!b) continue;
    totalLookups += b.totalLookups;
    totalCacheHits += b.hourly.reduce((s, h) => s + h.cacheHits, 0);
    totalLlmCalls += b.llmUsage.gemini + b.llmUsage.openrouter;
    totalGemini += b.llmUsage.gemini;
    totalOpenrouter += b.llmUsage.openrouter;
  }

  const cacheRate =
    totalLookups > 0
      ? Math.max(0, Math.min(100, (totalCacheHits / totalLookups) * 100)).toFixed(1)
      : "0.0";
  const llmTotal = totalLlmCalls;

  const cards = [
    { label: `Lookups (${data.period})`, value: totalLookups.toLocaleString() },
    { label: "Cache Hit Rate", value: `${cacheRate}%` },
    { label: "LLM Calls", value: llmTotal.toLocaleString() },
    { label: "Gemini / OpenRouter", value: `${totalGemini} / ${totalOpenrouter}` },
  ];

  container.innerHTML = cards
    .map(
      (c) => `
      <div class="analytics-metric-card">
        <span class="analytics-metric-label">${escHtml(c.label)}</span>
        <span class="analytics-metric-value">${escHtml(c.value)}</span>
      </div>`,
    )
    .join("");
}

/* ─── POPULAR QUERIES TABLE ─────────────────────────── */

export function renderPopularQueries(
  container: HTMLElement,
  queries: AnalyticsData["popularQueries"],
): void {
  const top = queries.slice(0, 20);

  let html = `
    <div class="analytics-panel analytics-panel-table">
      <h3 class="analytics-panel-title">Popular Queries</h3>
      <table class="analytics-table">
        <thead>
          <tr>
            <th class="analytics-th rank">#</th>
            <th class="analytics-th">Query</th>
            <th class="analytics-th count">Count</th>
          </tr>
        </thead>
        <tbody>`;

  if (top.length === 0) {
    html += `
          <tr>
            <td colspan="3" class="analytics-empty">No queries recorded</td>
          </tr>`;
  } else {
    for (let i = 0; i < top.length; i++) {
      const q = top[i];
      if (!q) continue;
      html += `
          <tr class="analytics-tr">
            <td class="analytics-td rank">${i + 1}</td>
            <td class="analytics-td mono">${escHtml(q.query)}</td>
            <td class="analytics-td count">${q.count.toLocaleString()}</td>
          </tr>`;
    }
  }

  html += `
        </tbody>
      </table>
    </div>`;

  container.innerHTML = html;
}

/* ─── DICTIONARY HITS BAR RANKING ───────────────────── */

export function renderDictionaryHits(
  container: HTMLElement,
  hits: AnalyticsData["dictionaryHits"],
): void {
  const top = hits.slice(0, 10);
  const maxCount = top.length > 0 && top[0] ? top[0].hitCount : 1;

  let html = `
    <div class="analytics-panel analytics-panel-table">
      <h3 class="analytics-panel-title">Dictionary Hits</h3>
      <div class="analytics-bar-list">`;

  if (top.length === 0) {
    html += `<p class="analytics-empty">No dictionary hit data</p>`;
  } else {
    for (let i = 0; i < top.length; i++) {
      const item = top[i];
      if (!item) continue;
      const pct = maxCount > 0 ? (item.hitCount / maxCount) * 100 : 0;
      html += `
        <div class="analytics-bar-row">
          <span class="analytics-bar-rank">${i + 1}</span>
          <span class="analytics-bar-name">${escHtml(item.dictionaryName)}</span>
          <div class="analytics-bar-track">
            <div class="analytics-bar-fill" style="width:${Math.max(pct, 4)}%"></div>
          </div>
          <span class="analytics-bar-count">${item.hitCount.toLocaleString()}</span>
        </div>`;
    }
  }

  html += `
      </div>
    </div>`;

  container.innerHTML = html;
}

/* ─── FETCH ──────────────────────────────────────────── */

export async function fetchAnalytics(
  period: Period,
): Promise<AnalyticsData> {
  const res = await fetch(`/api/admin/analytics?period=${period}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Analytics API returned ${res.status}`);
  }
  return res.json();
}

/* ─── FULL INIT ─────────────────────────────────────── */

export interface AnalyticsUI {
  period: Period;
  data: AnalyticsData;
}

export async function initAnalyticsPage(
  periodBtnContainer: HTMLElement,
  metricsContainer: HTMLElement,
  reqRateContainer: HTMLElement,
  cacheRateContainer: HTMLElement,
  queriesContainer: HTMLElement,
  dictHitsContainer: HTMLElement,
): Promise<void> {
  // uPlot はリサイズを自動追尾しないので ResizeObserver で監視
  const resizeObserver = new ResizeObserver(() => {
    const rw = reqRateContainer.clientWidth;
    const cw = cacheRateContainer.clientWidth;
    if (requestRateChart && rw > 0) requestRateChart.setSize({ width: rw, height: 300 });
    if (cacheRateChart && cw > 0) cacheRateChart.setSize({ width: cw, height: 300 });
  });
  resizeObserver.observe(reqRateContainer);
  resizeObserver.observe(cacheRateContainer);

  const loadData = async (period: Period) => {
    const data = await fetchAnalytics(period);

    // Update period buttons
    renderPeriodButtons(periodBtnContainer, period, loadData);

    // Update metric cards
    renderMetrics(metricsContainer, data);

    // Update charts
    initRequestRateChart(reqRateContainer, data);
    initCacheRateChart(cacheRateContainer, data);

    // Update tables
    renderPopularQueries(queriesContainer, data.popularQueries);
    renderDictionaryHits(dictHitsContainer, data.dictionaryHits);
  };

  // Start with default period
  await loadData("7d");
}

/* ─── UTILITY ────────────────────────────────────────── */

function escHtml(s: string): string {
  const el = document.createElement("span");
  el.textContent = s;
  return el.innerHTML;
}
