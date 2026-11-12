"use strict";
/* 11 経年推移（令和元年度〜令和6年度）とサマリーの「自院の推移」
   データ: data/trend.json（病院×指標×年度、閉院等の病院の医療圏別合計、合併・分割）, data/trend_mdc.json（病院×年度×MDC件数）
   app.js の S・F・M・MDCS・chart・base・ax・tipRow・setTable・setNote・rankChart などを使う */

const TY = ["令和元", "令和2", "令和3", "令和4", "令和5", "令和6"];
const TYL = ["令和元年度", "令和2年度", "令和3年度", "令和4年度", "令和5年度", "令和6年度"];
const BREAK_X = 4.5;            // 令和5年度と令和6年度の間（集計期間の変更）
const COVID = [0.5, 2.5];       // 令和2〜3年度
const sgn = (v) => (v >= 0 ? "+" : "−");
const TM = {
  n: { label: "退院患者数", unit: "件", fmt: F.int, kind: "count" },
  los: { label: "平均在院日数", unit: "日", fmt: F.d1, low: true, kind: "diff", dfmt: (v) => `${sgn(v)}${Math.abs(v).toFixed(1)}日` },
  eff: { label: "在院日数の指標", unit: "", fmt: F.d2, kind: "diff", dfmt: (v) => `${sgn(v)}${Math.abs(v).toFixed(3)}` },
  cmi: { label: "患者構成の指標", unit: "", fmt: F.d2, kind: "diff", dfmt: (v) => `${sgn(v)}${Math.abs(v).toFixed(3)}` },
  ambm: { label: "救急搬送入院件数（月）", unit: "件/月", fmt: F.d1, kind: "count" },
  amb: { label: "救急搬送入院率", unit: "", fmt: F.pct, kind: "pt" },
  emgm: { label: "救急医療入院（月）", unit: "件/月", fmt: F.d1, kind: "count" },
  emg: { label: "救急医療入院率", unit: "", fmt: F.pct, kind: "pt" },
  unp: { label: "予定外入院率", unit: "", fmt: F.pct, kind: "pt" },
  ref: { label: "他院からの紹介率", unit: "", fmt: F.pct, kind: "pt" },
  refm: { label: "他院からの紹介（月）", unit: "件/月", fmt: F.d1, kind: "count" },
  surg: { label: "手術ありの件数", unit: "件", fmt: F.int, kind: "count" },
  surgR: { label: "手術あり率", unit: "", fmt: F.pct, kind: "pt" },
  ga: { label: "全身麻酔ありの件数", unit: "件", fmt: F.int, kind: "count" },
};
const MULTI = ["n", "los", "eff", "cmi", "ambm", "emgm", "ref", "surg"];
const SPARK = ["n", "los", "ambm", "emgm", "ref", "surg"];
const TR = { key: "n", base: 0, mdc: "all", closed: true, KI: null, mdcData: null };

/* ---------- データ ---------- */
fetch("data/trend.json").then((r) => r.json()).then((d) => {
  S.trend = d; TR.KI = Object.fromEntries(d.meta.keys.map((k, i) => [k, i]));
  if (S.self) renderTrend();
}).catch(() => { const el = document.getElementById("tr-info"); if (el) el.textContent = "経年推移のデータを読み込めませんでした。"; });
fetch("data/trend_mdc.json").then((r) => r.json()).then((d) => { TR.mdcData = d.h; if (S.self && S.trend) renderTrendMdc(); });

function tv(h, k, y) {
  const s = S.trend && S.trend.h[h.id]; if (!s) return null;
  if (k === "surgR") { const a = s[TR.KI.surg][y], b = s[TR.KI.tot][y]; return a != null && b ? a / b : null; }
  return s[TR.KI[k]][y];
}
function quant(v, p) {
  if (!v.length) return null; const a = v.slice().sort((x, y) => x - y), i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}
const yearStats = (k, y, list) => { const v = list.map((h) => tv(h, k, y)).filter((x) => x != null);
  return { n: v.length, med: quant(v, 0.5), p25: quant(v, 0.25), p75: quant(v, 0.75), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null }; };
const unitOf = (m) => (m.unit ? " " + m.unit : "");
const axFmt = (m) => (v) => (m.fmt === F.pct ? Math.round(v * 100) + "%" : Math.abs(v) >= 1000 ? (v / 1000).toLocaleString("ja-JP") + "千" : +v.toFixed(2) + "");
function change(m, a, b) {  // 起点a → 令和6年度b
  if (a == null || b == null) return null;
  if (m.kind === "count") return a > 0 ? b / a - 1 : null;
  return b - a;
}
function changeFmt(m) {
  if (m.kind === "count") return (v) => (v == null ? "–" : `${sgn(v)}${Math.abs(v * 100).toFixed(1)}%`);
  if (m.kind === "pt") return (v) => (v == null ? "–" : `${sgn(v)}${Math.abs(v * 100).toFixed(1)}ポイント`);
  return (v) => (v == null ? "–" : m.dfmt(v));
}
/* 年度の横軸：区切り線を年度の間（4.5）に引けるよう数値軸にする */
const xYears = (b, extra = {}, short = false) => ax(b, Object.assign({ type: "value", min: 0, max: 5, interval: 1, splitLine: { show: false },
  axisLabel: { ...b.axisCommon.axisLabel, fontSize: short ? 10 : 11, formatter: (v) => (short || window.innerWidth < 560 ? TY[v].replace("令和", "R") + (short ? "" : "年度") : TYL[v]) },
  axisPointer: { snap: true } }, extra));
const xy = (arr) => arr.map((v, i) => [i, v]);
const R6LAB = ["令和元年度", "令和2年度", "令和3年度", "令和4年度", "令和5年度", "令和6年度\n（6月〜翌5月）"];
/* 区切り線（集計期間の変更）と網かけ（新型コロナ） */
function guides(withCovid, label, pos = "end") {
  const g = { markLine: { silent: true, symbol: "none", lineStyle: { color: css("--text-muted"), type: [4, 3], width: 1 },
    label: { show: !!label, formatter: "集計期間の変更", position: pos, color: css("--text-secondary"), fontSize: 10 }, data: [{ xAxis: BREAK_X }] } };
  if (withCovid) g.markArea = { silent: true, itemStyle: { color: css("--surface-2"), opacity: 1 },
    label: { show: !!label, position: "insideTop", color: css("--text-muted"), fontSize: 10, formatter: "新型コロナ" }, data: [[{ xAxis: COVID[0] }, { xAxis: COVID[1] }]] };
  return g;
}

/* ---------- 小さなグラフを並べる（1つのチャートに複数の枠） ---------- */
function multiPanels(id, keys, opt) {
  const el = document.getElementById(id), W = el.clientWidth || 900, b = base(), self = S.self;
  const cols = W >= 1000 ? Math.min(opt.maxCols || 4, keys.length) : W >= 620 ? Math.min(3, keys.length) : W >= 420 ? 2 : 1;
  const rows = Math.ceil(keys.length / cols), PH = opt.ph || 190;
  el.style.height = rows * PH + 8 + "px";
  const c = chart(id); c.resize();
  const gap = 18, pw = (W - gap * (cols - 1)) / cols;
  const grids = [], xs = [], ys = [], series = [], titles = [];
  keys.forEach((k, i) => {
    const m = TM[k], r = Math.floor(i / cols), col = i % cols, left = col * (pw + gap), top = r * PH;
    const sv = TY.map((_, y) => tv(self, k, y));
    let sub = "";
    const last = sv[5], first = sv.find((x) => x != null), fi = sv.findIndex((x) => x != null);
    if (opt.selfOnly && last != null && first != null && fi < 5) sub = `  ${m.fmt(last)}${unitOf(m)}（${TY[fi]}比 ${changeFmt(m)(change(m, first, last))}）`;
    titles.push({ text: m.label, subtext: sub, left: left + 4, top: top + 2, textStyle: { fontSize: 12, fontWeight: 600, color: css("--text-primary") },
      subtextStyle: { fontSize: 11, color: css("--text-secondary") }, itemGap: 2 });
    grids.push({ left: left + 46, width: pw - 58, top: top + (opt.selfOnly ? 46 : 30), height: PH - (opt.selfOnly ? 46 : 30) - 30 });
    xs.push(xYears(b, { gridIndex: i }, true));
    ys.push(ax(b, { gridIndex: i, type: "value", scale: true, splitNumber: 3, axisLabel: { ...b.axisCommon.axisLabel, fontSize: 10, formatter: axFmt(m) } }));
    const g = guides(!opt.selfOnly, false);
    if (!opt.selfOnly && S.others.length) {
      const st = TY.map((_, y) => yearStats(k, y, S.others));
      const band = S.others.length >= 4;
      if (band) {  // 中央50%の範囲（25〜75パーセンタイル）を多角形で塗る
        const lo = st.map((x) => x.p25), hi = st.map((x) => x.p75), fill = css("--other");
        const idx0 = TY.map((_, y) => y).filter((y) => lo[y] != null && hi[y] != null);
        series.push({ type: "custom", xAxisIndex: i, yAxisIndex: i, silent: true, tooltip: { show: false }, z: 4, clip: true,
          data: idx0.map((y) => [y, lo[y], hi[y]]), encode: { x: 0, y: [1, 2] },
          renderItem: (params, api) => {
            if (params.dataIndex !== 0) return null;
            const idx = TY.map((_, y) => y).filter((y) => lo[y] != null && hi[y] != null);
            if (idx.length < 2) return null;
            const pts = idx.map((y) => api.coord([y, hi[y]])).concat(idx.slice().reverse().map((y) => api.coord([y, lo[y]])));
            return { type: "polygon", shape: { points: pts }, style: { fill, opacity: 0.55 } };
          } });
      }
      series.push({ type: "line", name: "他院の中央値", xAxisIndex: i, yAxisIndex: i, data: xy(st.map((s) => s.med)), symbol: "none", z: 5,
        lineStyle: { color: css("--ref"), width: 1.5, type: [5, 3] }, itemStyle: { color: css("--ref") }, _st: st });
    }
    series.push({ type: "line", xAxisIndex: i, yAxisIndex: i, data: [], z: 0, silent: true, tooltip: { show: false }, ...g });
    series.push({ type: "line", name: "自院", xAxisIndex: i, yAxisIndex: i, data: xy(sv), symbol: "circle", symbolSize: 7, z: 6,
      lineStyle: { color: css("--self"), width: 2 }, itemStyle: { color: css("--self"), borderColor: css("--surface-1"), borderWidth: 1.5 }, connectNulls: false });
  });
  const stOf = {};
  series.forEach((s) => { if (s._st) stOf[s.xAxisIndex] = s._st; delete s._st; });
  c.setOption({
    ...b, title: titles, grid: grids, xAxis: xs, yAxis: ys, series,
    legend: opt.selfOnly ? undefined : { show: false },
    tooltip: { ...b.tooltip, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: css("--axis") } },
      formatter: (ps) => {
        const p = ps[0]; if (!p) return ""; const gi = p.axisIndex ?? p.seriesIndex, i = series[p.seriesIndex].xAxisIndex, k = keys[i], m = TM[k], y = p.dataIndex;
        const st = stOf[i] ? stOf[i][y] : null, v = tv(self, k, y);
        return `<div style="margin-bottom:2px">${TYL[y]}・${esc(m.label)}</div>` + tipRow(m.fmt(v) + (v != null ? unitOf(m) : ""), "自院") +
          (st && st.n ? tipRow(m.fmt(st.med), `他院の中央値（${st.n}施設）`) + (st.n >= 4 ? tipRow(`${m.fmt(st.p25)}〜${m.fmt(st.p75)}`, "他院の中央50%") : "") : "") +
          (y === 5 ? `<div style="color:${css("--text-muted")};font-size:11px">令和6年度は6月〜翌5月の集計</div>` : "");
      } },
  }, true);
  return { cols };
}

function renderTrendMulti() {
  multiPanels("c-tr-multi", MULTI, {});
  const self = S.self;
  setTable("c-tr-multi", ["指標"].concat(TYL), MULTI.flatMap((k) => {
    const m = TM[k];
    const st = TY.map((_, y) => yearStats(k, y, S.others));
    const r = [{ self: true, cells: [`${m.label}：自院`].concat(TY.map((_, y) => m.fmt(tv(self, k, y)))) }];
    if (S.others.length) r.push({ cells: [`${m.label}：他院の中央値`].concat(st.map((s) => m.fmt(s.med))) });
    return r;
  }));
  setNote("c-tr-multi", S.others.length ? `青：自院／点線：比較対象の他院の中央値／灰色の帯：他院の中央50%の範囲（25〜75パーセンタイル）${S.others.length < 4 ? "（他院が4施設未満のため帯は省略）" : ""}。縦の点線は集計期間の変更、網かけは新型コロナの影響が大きかった令和2〜3年度。`
    : "比較対象の他院がないため、自院の推移だけを表示しています。");
}
function renderTrendSpark() {
  multiPanels("c-tr-spark", SPARK, { selfOnly: true, maxCols: 6, ph: 170 });
  setTable("c-tr-spark", ["指標"].concat(TYL), SPARK.map((k) => ({ cells: [TM[k].label].concat(TY.map((_, y) => TM[k].fmt(tv(S.self, k, y)))) })));
  setNote("c-tr-spark", "縦の点線は集計期間の変更（令和6年度は6月〜翌5月）。括弧内は値がある最初の年度との比較。");
}

/* ---------- 選んだ指標：各病院の推移・順位・変化 ---------- */
function renderTrendLines() {
  const k = TR.key, m = TM[k], b = base(), self = S.self, LIM = 40;
  document.getElementById("tr-lines-title").textContent = `${m.label}の推移（比較対象の各病院）`;
  const others = S.others.filter((h) => TY.some((_, y) => tv(h, k, y) != null)).sort((a, c) => (tv(c, "n", 5) || 0) - (tv(a, "n", 5) || 0));
  const shown = others.slice(0, LIM), st = TY.map((_, y) => yearStats(k, y, S.others));
  const series = shown.map((h) => ({ type: "line", name: h.short, data: xy(TY.map((_, y) => tv(h, k, y))), symbol: "none", z: 1,
    lineStyle: { color: css("--other-strong"), width: 1, opacity: 0.55 }, emphasis: { focus: "series", lineStyle: { width: 2, opacity: 1 } }, _h: h }));
  series.push({ type: "line", name: "他院の中央値", data: xy(st.map((s) => s.med)), symbol: "none", z: 5, lineStyle: { color: css("--ref"), width: 2, type: [5, 3] }, ...guides(true, true) });
  series.push({ type: "line", name: "自院", data: xy(TY.map((_, y) => tv(self, k, y))), symbol: "circle", symbolSize: 8, z: 5,
    lineStyle: { color: css("--self"), width: 2.5 }, itemStyle: { color: css("--self"), borderColor: css("--surface-1"), borderWidth: 2 },
    endLabel: { show: true, formatter: () => self.short, color: css("--text-primary"), fontSize: 11, fontWeight: 600, width: 104, overflow: "truncate" } });
  chart("c-tr-lines").setOption({
    ...b, grid: { left: 12, right: 116, top: 56, bottom: 30, containLabel: true },
    legend: { top: 0, left: 0, data: ["自院", "他院の中央値"], itemWidth: 20, itemHeight: 3, itemStyle: { borderWidth: 0 }, textStyle: { color: css("--text-secondary"), fontSize: 11 } },
    tooltip: { ...b.tooltip, trigger: "axis", formatter: (ps) => {
      const y = ps[0].dataIndex, v = tv(self, k, y), r = rankYear(k, y);
      return `<div style="margin-bottom:2px">${TYL[y]}</div>` + tipRow(m.fmt(v) + (v != null ? unitOf(m) : ""), "自院" + (r ? `（${r.rank}位 / ${r.n}施設）` : "")) +
        (st[y].n ? tipRow(m.fmt(st[y].med), `他院の中央値（${st[y].n}施設）`) + tipRow(`${m.fmt(st[y].min)}〜${m.fmt(st[y].max)}`, "他院の最小〜最大") : ""); } },
    xAxis: xYears(b),
    yAxis: ax(b, { type: "value", scale: true, name: m.label + (m.unit ? `（${m.unit}）` : ""), nameTextStyle: { ...b.axisCommon.nameTextStyle, align: "left" }, axisLabel: { ...b.axisCommon.axisLabel, formatter: axFmt(m) } }),
    series: series.map((s) => { const { _h, ...o } = s; return o; }),
  }, true);
  setNote("c-tr-lines", `灰色の線：比較対象の他院${others.length > LIM ? `（令和6年度の退院患者数が多い${LIM}施設を表示。中央値は${others.length}施設で計算）` : ""}。線にマウスを重ねると病院名が強調されます。`);
  setTable("c-tr-lines", ["病院"].concat(TYL), [self].concat(others).map((h) => ({ self: h === self, cells: [h.name].concat(TY.map((_, y) => m.fmt(tv(h, k, y)))) })));
}
function rankYear(k, y) {
  const m = TM[k], v = tv(S.self, k, y); if (v == null) return null;
  const vals = S.G.map((h) => tv(h, k, y)).filter((x) => x != null);
  return { rank: vals.filter((x) => (m.low ? x < v : x > v)).length + 1, n: vals.length };
}
function renderTrendRank() {
  const k = TR.key, m = TM[k], b = base();
  document.getElementById("tr-rank-title").textContent = `自院の順位の推移（${m.label}${m.low ? "、小さいほど上位" : ""}）`;
  const R = TY.map((_, y) => rankYear(k, y)), maxN = Math.max(2, ...R.map((r) => (r ? r.n : 0)));
  chart("c-tr-rank").setOption({
    ...b, grid: { left: 12, right: 30, top: 46, bottom: 30, containLabel: true },
    tooltip: { ...b.tooltip, trigger: "axis", formatter: (ps) => { const y = ps[0].dataIndex, r = R[y], v = tv(S.self, k, y);
      return `<div style="margin-bottom:2px">${TYL[y]}</div>` + (r ? tipRow(`${r.rank}位 / ${r.n}施設`, "比較対象内の順位") + tipRow(m.fmt(v) + unitOf(m), m.label) : tipRow("–", "値なし")); } },
    xAxis: xYears(b),
    yAxis: ax(b, { type: "value", inverse: true, min: 1, max: maxN, minInterval: 1, name: "順位（上ほど上位）", nameLocation: "start", nameTextStyle: { ...b.axisCommon.nameTextStyle, align: "left" } }),
    series: [{ type: "line", data: xy(R.map((r) => (r ? r.rank : null))), symbol: "circle", symbolSize: 9, lineStyle: { color: css("--self"), width: 2 },
      itemStyle: { color: css("--self"), borderColor: css("--surface-1"), borderWidth: 2 },
      label: { show: true, position: "top", color: css("--text-primary"), fontSize: 11, formatter: (p) => (R[p.dataIndex] ? `${R[p.dataIndex].rank}/${R[p.dataIndex].n}` : "") },
      ...guides(true, true, "start") }],
  }, true);
  setNote("c-tr-rank", "「順位/施設数」。施設数は、その年度に値がある比較対象の病院の数です（調査への参加状況や秘匿で年度ごとに変わります）。");
  setTable("c-tr-rank", ["年度", "順位", "施設数", m.label], TY.map((_, y) => ({ cells: [TYL[y], R[y] ? String(R[y].rank) : "–", R[y] ? String(R[y].n) : "–", m.fmt(tv(S.self, k, y))] })));
}
function renderTrendGrowth() {
  const k = TR.key, m = TM[k], bY = TR.base, cf = changeFmt(m);
  document.getElementById("tr-growth-title").textContent = `${m.label}：${TYL[bY]}から令和6年度への${m.kind === "count" ? "増減率" : "変化"}`;
  const met = { label: `${m.label}の${m.kind === "count" ? "増減率" : "変化"}`, unit: "", fmt: cf, low: !!m.low,
    get: (h) => change(m, tv(h, k, bY), tv(h, k, 5)),
    axisFmt: (v) => (m.kind === "diff" ? +v.toFixed(2) + "" : Math.round(v * 100) + (m.kind === "pt" ? "pt" : "%")) };
  rankChart("c-tr-growth", met, { top: 30, extra: (h) => tipRow(`${m.fmt(tv(h, k, bY))} → ${m.fmt(tv(h, k, 5))}${unitOf(m)}`, `${TYL[bY]} → 令和6年度`) });
  const n = document.getElementById("c-tr-growth").parentElement.querySelector(".cnote");
  if (n) n.textContent += `${TYL[bY]}と令和6年度の両方に値がある病院だけを並べています。令和6年度は集計期間が6月〜翌5月です。`;
}

/* ---------- MDC別の患者数とシェア ---------- */
const mdcCnt = (h, y, mi) => { const a = TR.mdcData && TR.mdcData[h.id] ? TR.mdcData[h.id][y] : null; if (!a) return null;
  return mi === "all" ? sum(a) : a[mi] ?? 0; };
function closedBucket() {
  if (S.axis !== "area" || !TR.closed || !S.trend.closed[S.self.area]) return null;
  return S.trend.closed[S.self.area][S.scope === "all" ? "a" : "d"] || null;
}
const closedCnt = (cb, y, mi) => (!cb ? 0 : mi === "all" ? sum(cb.m[y]) : cb.m[y][mi]);
function renderTrendMdc() {
  if (!S.self || !S.trend) return;
  if (!TR.mdcData) { setNote("c-tr-mdc-bar", "MDC別のデータを読み込み中です…"); return; }
  const mi = TR.mdc, b = base(), self = S.self, cb = closedBucket(), mlab = mi === "all" ? "全MDC" : MDCS[mi];
  document.getElementById("tr-closed-wrap").hidden = S.axis !== "area";
  // 患者数の内訳
  document.getElementById("tr-mdc-bar-title").textContent = `患者数の推移（${mlab}、比較対象全体の内訳）`;
  const sv = TY.map((_, y) => mdcCnt(self, y, mi) || 0), ov = TY.map((_, y) => sum(S.others.map((h) => mdcCnt(h, y, mi) || 0)));
  const cv = TY.map((_, y) => closedCnt(cb, y, mi)), tot = TY.map((_, y) => sv[y] + ov[y] + cv[y]);
  const ser = [{ name: "自院", data: sv, color: css("--self") }, { name: "比較対象の他院", data: ov, color: css("--other") }];
  if (cb) ser.push({ name: "閉院・統合などで令和6年度にない病院", data: cv, color: css("--other-strong") });
  chart("c-tr-mdc-bar").setOption({
    ...b, grid: { left: 12, right: 16, top: 52, bottom: 30, containLabel: true },
    legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 10, textStyle: { color: css("--text-secondary"), fontSize: 11 } },
    tooltip: { ...b.tooltip, trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(127,127,127,0.08)" } }, formatter: (ps) => { const y = ps[0].dataIndex;
      return `<div style="margin-bottom:2px">${TYL[y]}・${esc(mlab)}</div>` + ps.map((p) => tipRow(F.int(p.value) + "件", p.seriesName)).join("") +
        tipRow(F.int(tot[y]) + "件", "合計") + tipRow(tot[y] ? F.pct(sv[y] / tot[y]) : "–", "自院のシェア") +
        (cb && cb.names[y] && cb.names[y].length ? `<div style="color:${css("--text-muted")};font-size:11px;max-width:320px;white-space:normal">令和6年度にない病院：${esc(cb.names[y].slice(0, 6).join("、"))}${cb.names[y].length > 6 ? ` ほか${cb.names[y].length - 6}施設` : ""}</div>` : ""); } },
    xAxis: ax(b, { type: "category", data: R6LAB, splitLine: { show: false }, axisLabel: { ...b.axisCommon.axisLabel, interval: 0 } }),
    yAxis: ax(b, { type: "value", axisLabel: { ...b.axisCommon.axisLabel, formatter: (v) => v.toLocaleString("ja-JP") } }),
    series: ser.map((s, i) => ({ name: s.name, type: "bar", stack: "t", data: s.data, barMaxWidth: 46, itemStyle: { color: s.color, borderColor: css("--surface-1"), borderWidth: 1,
      borderRadius: i === ser.length - 1 ? [4, 4, 0, 0] : 0 },
      label: i === 0 ? { show: true, position: "inside", color: "#fff", fontSize: 10, formatter: (p) => (tot[p.dataIndex] && sv[p.dataIndex] ? F.pct(sv[p.dataIndex] / tot[p.dataIndex]) : "") } : undefined })),
  }, true);
  setNote("c-tr-mdc-bar", "令和6年度は6月〜翌5月の集計です。MDC別の件数は「施設別MDC比率 × 件数」から計算した値です（端数の誤差あり）。棒の中の数字は自院のシェア。" +
    (S.axis === "area" ? (cb ? "灰色の濃い部分は、その年度にはあったが令和6年度までに閉院・統合などでなくなった医療圏内の病院です。" : TR.closed ? "この医療圏には、令和6年度までになくなった病院はありません。" : "") : ""));
  setTable("c-tr-mdc-bar", ["年度", "自院", "他院", ...(cb ? ["令和6年度にない病院"] : []), "合計", "自院のシェア"],
    TY.map((_, y) => ({ cells: [TYL[y], F.int(sv[y]), F.int(ov[y]), ...(cb ? [F.int(cv[y])] : []), F.int(tot[y]), tot[y] ? F.pct(sv[y] / tot[y]) : "–"] })));

  // シェアの推移（自院と上位5病院）
  document.getElementById("tr-mdc-share-title").textContent = `シェアの推移（${mlab}、自院と上位5病院）`;
  const top = S.others.filter((h) => mdcCnt(h, 5, mi)).sort((a, c) => mdcCnt(c, 5, mi) - mdcCnt(a, 5, mi)).slice(0, 5);
  const slots = ["--s2", "--s3", "--s4", "--s5", "--s6"].map(css);
  const shareOf = (h) => TY.map((_, y) => { const v = mdcCnt(h, y, mi); return v == null || !tot[y] ? null : v / tot[y]; });
  const ss = [{ name: "自院：" + self.short, data: shareOf(self), color: css("--self"), w: 2.5, z: 5 }].concat(top.map((h, i) => ({ name: h.short, data: shareOf(h), color: slots[i], w: 1.5, z: 3 })));
  chart("c-tr-mdc-share").setOption({
    ...b, grid: { left: 12, right: 24, top: 56, bottom: 30, containLabel: true },
    legend: { top: 0, left: 0, itemWidth: 20, itemHeight: 3, itemStyle: { borderWidth: 0 }, textStyle: { color: css("--text-secondary"), fontSize: 11 } },
    tooltip: { ...b.tooltip, trigger: "axis", formatter: (ps) => `<div style="margin-bottom:2px">${TYL[ps[0].dataIndex]}・${esc(mlab)}</div>` +
      ps.slice().sort((a, c) => (c.value || 0) - (a.value || 0)).map((p) => `<div><span style="display:inline-block;width:10px;height:2px;background:${p.color};vertical-align:middle;margin-right:6px"></span><b>${F.pct(p.value)}</b> <span style="color:${css("--text-secondary")}">${esc(p.seriesName)}</span></div>`).join("") },
    xAxis: xYears(b),
    yAxis: ax(b, { type: "value", min: 0, axisLabel: { ...b.axisCommon.axisLabel, formatter: (v) => Math.round(v * 100) + "%" } }),
    series: ss.map((s, i) => ({ name: s.name, type: "line", data: xy(s.data), z: s.z, symbol: "circle", symbolSize: i === 0 ? 8 : 6,
      lineStyle: { color: s.color, width: s.w }, itemStyle: { color: s.color, borderColor: css("--surface-1"), borderWidth: 1.5 }, ...(i === 0 ? guides(false, true) : {}) })),
  }, true);
  setNote("c-tr-mdc-share", `シェア＝その病院の件数 ÷ 比較対象全体の件数${cb ? "（令和6年度にない病院を含む）" : ""}。上位5病院は令和6年度の件数順。`);
  setTable("c-tr-mdc-share", ["病院"].concat(TYL), [self].concat(top).map((h) => ({ self: h === self, cells: [h.name].concat(shareOf(h).map(F.pct)) })));

  // 自院のMDC別の増減（起点年度＝100）
  const bY = TR.base;
  document.getElementById("tr-mdc-heat-title").textContent = `自院のMDC別患者数の増減（${TYL[bY]}＝100）`;
  const rowsL = ["全MDC"].concat(MDCS), data = [];
  rowsL.forEach((_, r) => { const m2 = r === 0 ? "all" : r - 1, bv = mdcCnt(self, bY, m2);
    TY.forEach((__, y) => { const v = mdcCnt(self, y, m2); data.push([y, r, bv >= 30 && v != null ? Math.round((v / bv) * 100) : null, v, bv]); }); });
  chart("c-tr-mdc-heat").setOption({
    ...b, grid: { left: 12, right: 20, top: 10, bottom: 70, containLabel: true },
    tooltip: { ...b.tooltip, trigger: "item", formatter: (p) => { const [y, r, ix, v, bv] = p.data;
      return `<div style="margin-bottom:2px">${esc(rowsL[r])}・${TYL[y]}</div>` + tipRow(F.int(v) + "件", "自院の件数") + tipRow(F.int(bv) + "件", TYL[bY]) + tipRow(ix == null ? "–（起点が30件未満）" : String(ix), `指数（${TYL[bY]}＝100）`); } },
    xAxis: ax(b, { type: "category", data: R6LAB, splitLine: { show: false }, axisLine: { show: false }, axisLabel: { ...b.axisCommon.axisLabel, interval: 0 } }),
    yAxis: ax(b, { type: "category", data: rowsL, inverse: true, splitLine: { show: false }, axisLine: { show: false },
      axisLabel: { ...b.axisCommon.axisLabel, formatter: (v, i) => (i === 0 ? `{s|${v}}` : v), rich: { s: { fontWeight: 700, color: css("--text-primary"), fontSize: 11 } } } }),
    visualMap: { type: "continuous", min: 50, max: 150, dimension: 2, calculable: false, orient: "horizontal", left: "center", bottom: 8, itemHeight: 220, itemWidth: 10,
      text: ["150以上", "50以下"], textStyle: { color: css("--text-secondary"), fontSize: 11 }, inRange: { color: [css("--neg"), css("--mid"), css("--pos")] } },
    series: [{ type: "heatmap", data: data.map((d) => ({ value: d, itemStyle: d[2] == null ? { color: css("--surface-2") } : undefined })),
      itemStyle: { borderColor: css("--surface-1"), borderWidth: 2, borderRadius: 3 },
      label: { show: true, fontSize: 10, color: css("--text-primary"), formatter: (p) => (p.data.value ? (p.data.value[2] == null ? "" : p.data.value[2]) : "") } }],
  }, true);
  setNote("c-tr-mdc-heat", `${TYL[bY]}の件数を100とした指数（青：増加、赤：減少）。起点の年度の件数が30件未満のMDCは空欄です。起点の年度は上の「起点の年度」で変えられます。`);
  setTable("c-tr-mdc-heat", ["MDC"].concat(TYL), rowsL.map((l, r) => ({ cells: [l].concat(TY.map((_, y) => { const d = data[r * 6 + y]; return d[3] == null ? "–" : `${F.int(d[3])}件${d[2] != null ? `（${d[2]}）` : ""}`; })) })));
  refreshOpenTables();
}

/* ---------- 自院の状況（参加年度・合併） ---------- */
function renderTrendInfo() {
  const el = document.getElementById("tr-info"), self = S.self, yrs = TY.map((_, y) => tv(self, "n", y) != null || tv(self, "beds", y) != null);
  const miss = TYL.filter((_, y) => !yrs[y]);
  const parts = [];
  parts.push(miss.length ? `<b>${esc(self.short)}</b>は${esc(miss.join("・"))}の値がありません（その年度は調査に参加していないか、別の告示番号の病院とつながっていません）。` : `<b>${esc(self.short)}</b>は6年度すべての値があります。`);
  (S.trend.events[self.id] || []).forEach((e) => parts.push(`${TYL[e.y]}（${esc(e.date)}）に${esc(e.kind)}：${esc(e.before.join("・"))} → ${esc(e.after.join("・"))}。${e.kind === "合併" ? "合併した年度より前の、他の病院の実績はこの病院の値に含まれていません（二次医療圏の患者数・シェアでは「令和6年度にない病院」として市場に含めています）。" : "分割した年度より前の値は、分割前の病院全体の値です。"}`));
  const nb = S.others.filter((h) => tv(h, "n", 0) != null).length;
  parts.push(`比較対象の他院${S.others.length}施設のうち、令和元年度の値があるのは${nb}施設です。`);
  el.innerHTML = parts.map((p) => `<span class="tr-warn">${p}</span>`).join("<br>");
}

/* ---------- 全体 ---------- */
function renderTrend() {
  if (!S.self) return;
  if (!S.trend) { const el = document.getElementById("tr-info"); if (el) el.textContent = "経年推移のデータを読み込み中です…"; return; }
  renderTrendInfo(); renderTrendSpark(); renderTrendMulti(); renderTrendLines(); renderTrendRank(); renderTrendGrowth(); renderTrendMdc();
  refreshOpenTables();
}
(function initTrendControls() {
  const k = document.getElementById("tr-key"), bs = document.getElementById("tr-base"), md = document.getElementById("tr-mdc"), cl = document.getElementById("tr-closed");
  Object.entries(TM).forEach(([key, m]) => k.add(new Option(m.label, key)));
  TYL.slice(0, 5).forEach((t, i) => bs.add(new Option(t, i)));
  md.add(new Option("全MDC", "all")); MDCS.forEach((t, i) => md.add(new Option(t, i)));
  k.addEventListener("change", () => { TR.key = k.value; if (S.self && S.trend) { renderTrendLines(); renderTrendRank(); renderTrendGrowth(); refreshOpenTables(); } });
  bs.addEventListener("change", () => { TR.base = +bs.value; if (S.self && S.trend) { renderTrendGrowth(); renderTrendMdc(); refreshOpenTables(); } });
  md.addEventListener("change", () => { TR.mdc = md.value === "all" ? "all" : +md.value; renderTrendMdc(); });
  cl.addEventListener("change", () => { TR.closed = cl.checked; renderTrendMdc(); });
})();
