/**
 * analytics-charts.ts — テーブルレンダリングとデータ取得
 *
 * DESIGN.md 準拠の色・フォント・スペーシング。
 * Astro の <script> タグから import して使う。
 */

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

/** Format ISO hour string to Jakarta time label */
function fmtJakartaHour(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/* ─── TABLE RENDERERS ────────────────────────────────── */

/**
 * Request Rate テーブル — 3列: Hour, Lookups, Cache Misses
 * 時系列降順（新しいhourが上）
 */
export function renderRequestRateTable(
  container: HTMLElement,
  data: AnalyticsData,
): void {
  const hourly = flattenHourly(data.buckets);
  hourly.reverse();

  // Compute totals for summary footer
  let totalLookups = 0;
  let totalCacheMisses = 0;
  for (const pt of hourly) {
    totalLookups += pt.lookups;
    totalCacheMisses += pt.cacheMisses;
  }

  let html = `<table class="analytics-table">
    <thead>
      <tr>
        <th class="analytics-th hour">Hour</th>
        <th class="analytics-th count">Lookups</th>
        <th class="analytics-th count">Cache Misses</th>
      </tr>
    </thead>
    <tbody>`;

  if (hourly.length === 0) {
    html += `<tr><td colspan="3" class="analytics-empty">No data for this period</td></tr>`;
  } else {
    for (const pt of hourly) {
      html += `<tr class="analytics-tr">
        <td class="analytics-td">${escHtml(fmtJakartaHour(pt.hour))}</td>
        <td class="analytics-td count">${pt.lookups.toLocaleString()}</td>
        <td class="analytics-td count">${pt.cacheMisses.toLocaleString()}</td>
      </tr>`;
    }
  }

  html += `</tbody>`;

  // Summary footer
  if (hourly.length > 0) {
    html += `<tfoot>
      <tr class="analytics-tr-summary">
        <td class="analytics-td-summary">Period Total</td>
        <td class="analytics-td-summary count">${totalLookups.toLocaleString()}</td>
        <td class="analytics-td-summary count">${totalCacheMisses.toLocaleString()}</td>
      </tr>
    </tfoot>`;
  }

  html += `</table>`;
  container.innerHTML = html;
}

/**
 * Cache Hit Rate テーブル — 4列: Hour, Cache Hits, Total, Hit Rate
 * 時系列降順
 */
export function renderCacheRateTable(
  container: HTMLElement,
  data: AnalyticsData,
): void {
  const hourly = flattenHourly(data.buckets);
  hourly.reverse();

  // Compute totals for summary footer
  let totalCacheHits = 0;
  let totalLookups = 0;
  for (const pt of hourly) {
    totalCacheHits += pt.cacheHits;
    totalLookups += pt.lookups;
  }
  const overallHitRate =
    totalLookups > 0
      ? ((totalCacheHits / totalLookups) * 100).toFixed(1)
      : "0.0";

  let html = `<table class="analytics-table">
    <thead>
      <tr>
        <th class="analytics-th hour">Hour</th>
        <th class="analytics-th count">Cache Hits</th>
        <th class="analytics-th count">Lookups</th>
        <th class="analytics-th count">Hit Rate</th>
      </tr>
    </thead>
    <tbody>`;

  if (hourly.length === 0) {
    html += `<tr><td colspan="4" class="analytics-empty">No data for this period</td></tr>`;
  } else {
    for (const pt of hourly) {
      const total = pt.lookups;
      const hitRate = total > 0 ? ((pt.cacheHits / total) * 100).toFixed(1) : "0.0";
      html += `<tr class="analytics-tr">
        <td class="analytics-td">${escHtml(fmtJakartaHour(pt.hour))}</td>
        <td class="analytics-td count">${pt.cacheHits.toLocaleString()}</td>
        <td class="analytics-td count">${total.toLocaleString()}</td>
        <td class="analytics-td count">${hitRate}%</td>
      </tr>`;
    }
  }

  html += `</tbody>`;

  // Summary footer
  if (hourly.length > 0) {
    html += `<tfoot>
      <tr class="analytics-tr-summary">
        <td class="analytics-td-summary">Period Total</td>
        <td class="analytics-td-summary count">${totalCacheHits.toLocaleString()}</td>
        <td class="analytics-td-summary count">${totalLookups.toLocaleString()}</td>
        <td class="analytics-td-summary count">${overallHitRate}%</td>
      </tr>
    </tfoot>`;
  }

  html += `</table>`;
  container.innerHTML = html;
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
      // pct derives from numeric-only fields — safe for style attr interpolation
      const pct = maxCount > 0 ? (item.hitCount / maxCount) * 100 : 0;
      const safePct = Math.max(4, Math.min(100, pct));
      html += `
        <div class="analytics-bar-row">
          <span class="analytics-bar-rank">${i + 1}</span>
          <span class="analytics-bar-name">${escHtml(item.dictionaryName)}</span>
          <div class="analytics-bar-track">
            <div class="analytics-bar-fill" style="width:${safePct}%"></div>
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
  const loadData = async (period: Period) => {
    const data = await fetchAnalytics(period);

    // Update period buttons
    renderPeriodButtons(periodBtnContainer, period, loadData);

    // Update metric cards
    renderMetrics(metricsContainer, data);

    // Update tables
    renderRequestRateTable(reqRateContainer, data);
    renderCacheRateTable(cacheRateContainer, data);

    // Update other tables
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
