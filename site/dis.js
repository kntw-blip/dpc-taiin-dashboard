"use strict";
/* 12 疾患別の推移（令和元年度〜令和6年度）
   データ: data/dis/index.json（疾患一覧、病院の年度別の区分）, data/dis/<疾患コード>.json（病院×年度の手術あり／なしの推計値・幅・在院日数）
   1行 = [手術なし推計, 最小, 最大, 手術あり推計, 最小, 最大, 在院日数（なし）, 在院日数（あり）]
   公表セルがない病院は inv[年度][区分] = [手術なし推計, 最大, 手術あり推計, 最大] で表す
   app.js・trend.js の S・F・MDCS・chart・base・ax・tipRow・setTable・setNote・TY・TYL・xYears・xy・guides・R6LAB・TR を使う */

const DIS = { idx: null, code: null, data: null, cache: new Map(), loading: null };
const BI = { D: 0, P: 1, F: 2 };
const N_EST = 0, N_LO = 1, N_HI = 2, A_EST = 3, A_LO = 4, A_HI = 5, L_N = 6, L_A = 7;

fetch("data/dis/index.json").then((r) => r.json()).then((d) => {
  DIS.idx = d;
  const dl = document.getElementById("dq-list");
  const codes = Object.keys(d.codes).sort();
  codes.forEach((c) => { const nm = lastName(c); const o = document.createElement("option"); o.value = `${c} ${nm}`; dl.append(o); });
  const want = new URL(location.href).searchParams.get("d");
  selectDis(want && d.codes[want] ? want : d.codes["050130"] ? "050130" : codes[0]);
}).catch(() => { const el = document.getElementById("dis-info"); if (el) el.textContent = "疾患別のデータを読み込めませんでした。"; });

function lastName(c) { const n = DIS.idx.codes[c].names; for (let i = 5; i >= 0; i--) if (n[i]) return n[i]; return ""; }
function selectDis(code) {
  DIS.code = code; document.getElementById("dq").value = `${code} ${lastName(code)}`;
  const u = new URL(location.href); u.searchParams.set("d", code); history.replaceState(null, "", u);
  if (DIS.cache.has(code)) { DIS.data = DIS.cache.get(code); renderDis(); return; }
  DIS.data = null; renderDis();
  const p = fetch(`data/dis/${code}.json`).then((r) => r.json()).then((d) => { DIS.cache.set(code, d); if (DIS.code === code) { DIS.data = d; renderDis(); } });
  DIS.loading = p;
}
document.getElementById("dq").addEventListener("change", (e) => {
  const v = e.target.value.trim(), m = v.match(/^([0-9x]{6})/);
  let code = m && DIS.idx && DIS.idx.codes[m[1]] ? m[1] : null;
  if (!code && DIS.idx) { const hit = Object.keys(DIS.idx.codes).find((c) => DIS.idx.codes[c].names.some((n) => n && n.includes(v))); code = hit || null; }
  if (code) selectDis(code);
});

/* 病院 h・年度 y の値（公表セルがない病院は区分別の推計値、調査に参加していない年度は null） */
function disRow(h, y) {
  const d = DIS.data; const r = d.h[h.id] && d.h[h.id][y];
  if (r) return r;
  const t = DIS.idx.types[h.id]; const b = t ? t[y] : "-";
  if (!d.src[y] || b === "-" || !d.inv[y]) return null;
  const v = d.inv[y][BI[b]];
  return [v[0], 0, v[1], v[2], 0, v[3], null, null];
}
const exact = (r) => r && r[N_LO] === r[N_HI] && r[A_LO] === r[A_HI];
const est = (v) => Math.round(v).toLocaleString("ja-JP");
function groupSum(list, y, cb) {
  const s = { n: 0, nL: 0, nH: 0, a: 0, aL: 0, aH: 0, ln: 0, lnW: 0, la: 0, laW: 0, cnt: 0 };
  list.forEach((h) => { const r = disRow(h, y); if (!r) return; s.cnt++;
    s.n += r[N_EST]; s.nL += r[N_LO]; s.nH += r[N_HI]; s.a += r[A_EST]; s.aL += r[A_LO]; s.aH += r[A_HI];
    if (r[L_N] != null && r[N_LO]) { s.ln += r[L_N] * r[N_LO]; s.lnW += r[N_LO]; }
    if (r[L_A] != null && r[A_LO]) { s.la += r[L_A] * r[A_LO]; s.laW += r[A_LO]; } });
  if (cb) { s.n += cb[y][0]; s.a += cb[y][1]; s.nL += 0; s.nH += cb[y][0]; s.aH += cb[y][1]; }
  return s;
}
function disClosed() {
  if (S.axis !== "area" || !TR.closed || !DIS.data.closed[S.self.area]) return null;
  return DIS.data.closed[S.self.area][S.scope === "all" ? "a" : "d"] || null;
}

function renderDis() {
  if (!S.self || !DIS.idx) return;
  const info = document.getElementById("dis-info");
  if (!DIS.data) { info.textContent = "読み込み中です…"; return; }
  const d = DIS.data, I = DIS.idx.codes[DIS.code], self = S.self, nm = lastName(DIS.code), b = base();
  const has = TY.map((_, y) => !!d.src[y]);
  const selfRows = TY.map((_, y) => (has[y] ? disRow(self, y) : null));
  // 疾患と自院の状況
  const names = [...new Set(d.names.filter(Boolean))];
  const parts = [`<b>${esc(DIS.code)} ${esc(nm)}</b>（MDC${esc(I.mdc)}）。`];
  if (names.length > 1) parts.push(`名称の変更：${names.map(esc).join(" → ")}。`);
  if (has.some((x) => !x)) parts.push(`${TYL.filter((_, y) => !has[y]).join("・")}は、この疾患コードの集計がありません（診療報酬改定による区分の変更など）。`);
  const src = [...new Set(d.src.filter(Boolean))];
  parts.push(`集計表：${src.map((s) => (s === "o" ? "疾患別手術有無別処置1有無別集計" : "疾患別手術別集計（手術なし＝99＋輸血のみ）")).join("／")}。`);
  const nEx = selfRows.filter((r) => r && exact(r)).length, nAny = selfRows.filter(Boolean).length;
  parts.push(nAny ? `自院の値は${nAny}年度分のうち${nEx}年度が公表値だけで確定、${nAny - nEx}年度が推計を含みます。` : "自院はこの疾患の値がありません。");
  info.innerHTML = parts.join("");

  // A 自院の件数（手術あり／なし）
  document.getElementById("dis-self-title").textContent = `自院の件数：${nm}（手術あり／なし）`;
  const sA = selfRows.map((r) => (r ? r[A_EST] : null)), sN = selfRows.map((r) => (r ? r[N_EST] : null));
  const cA = css("--s2"), cN = css("--s3");
  chart("c-dis-self").setOption({
    ...b, grid: { left: 12, right: 16, top: 52, bottom: 30, containLabel: true },
    legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 10, textStyle: { color: css("--text-secondary"), fontSize: 11 } },
    tooltip: { ...b.tooltip, trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(127,127,127,0.08)" } }, formatter: (ps) => {
      const y = ps[0].dataIndex, r = selfRows[y]; if (!r) return `${TYL[y]}<br>値なし`;
      const tot = r[N_EST] + r[A_EST];
      return `<div style="margin-bottom:2px">${TYL[y]}・${esc(nm)}${exact(r) ? "" : "（推計を含む）"}</div>` +
        tipRow(`${exact(r) ? "" : "約"}${est(r[A_EST])}件` + (r[A_LO] !== r[A_HI] ? `（${est(r[A_LO])}〜${est(r[A_HI])}）` : ""), "手術あり") +
        tipRow(`${exact(r) ? "" : "約"}${est(r[N_EST])}件` + (r[N_LO] !== r[N_HI] ? `（${est(r[N_LO])}〜${est(r[N_HI])}）` : ""), "手術なし") +
        tipRow(tot ? F.pct(r[A_EST] / tot) : "–", "手術ありの割合"); } },
    xAxis: ax(b, { type: "category", data: R6LAB, splitLine: { show: false }, axisLabel: { ...b.axisCommon.axisLabel, interval: 0 } }),
    yAxis: ax(b, { type: "value", axisLabel: { ...b.axisCommon.axisLabel, formatter: (v) => v.toLocaleString("ja-JP") } }),
    series: [
      { name: "手術なし", type: "bar", stack: "s", data: sN, barMaxWidth: 46, itemStyle: { color: cN, borderColor: css("--surface-1"), borderWidth: 1 } },
      { name: "手術あり", type: "bar", stack: "s", data: sA, barMaxWidth: 46, itemStyle: { color: cA, borderColor: css("--surface-1"), borderWidth: 1, borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: "top", color: css("--text-primary"), fontSize: 11,
          formatter: (p) => { const r = selfRows[p.dataIndex]; if (!r) return ""; const t = r[N_EST] + r[A_EST]; return t ? `${F.pct(r[A_EST] / t)}${exact(r) ? "" : "＊"}` : ""; } } },
    ],
  }, true);
  setNote("c-dis-self", "棒の上の数字は手術ありの割合。「＊」は10件未満の非公表セルの推計を含む年度です（幅はマウスを重ねると表示）。");
  setTable("c-dis-self", ["年度", "手術あり", "手術なし", "合計", "手術ありの割合", "推計"], TY.map((_, y) => { const r = selfRows[y];
    return { cells: r ? [TYL[y], `${est(r[A_EST])}（${est(r[A_LO])}〜${est(r[A_HI])}）`, `${est(r[N_EST])}（${est(r[N_LO])}〜${est(r[N_HI])}）`, est(r[A_EST] + r[N_EST]),
      r[A_EST] + r[N_EST] ? F.pct(r[A_EST] / (r[A_EST] + r[N_EST])) : "–", exact(r) ? "" : "推計を含む"] : [TYL[y], "–", "–", "–", "–", ""] }; }));

  // B 手術ありの割合（自院と比較対象全体、幅つき）
  const cb = disClosed();
  const G = TY.map((_, y) => (has[y] ? groupSum(S.G, y, cb) : null));
  const rate = (a, n) => (a + n ? a / (a + n) : null);
  const selfR = selfRows.map((r) => (r ? [rate(r[A_EST], r[N_EST]), rate(r[A_LO], r[N_HI]), rate(r[A_HI], r[N_LO])] : null));
  const grpR = G.map((g) => (g && g.cnt ? [rate(g.a, g.n), rate(g.aL, g.nH), rate(g.aH, g.nL)] : null));
  document.getElementById("dis-rate-title").textContent = `手術ありの割合：${nm}`;
  const band = (vals, color, name) => ({ type: "custom", name, silent: true, z: 4, tooltip: { show: false },
    data: vals.map((v, y) => (v ? [y, v[1], v[2]] : null)).filter(Boolean), encode: { x: 0, y: [1, 2] },
    renderItem: (params, api) => { if (params.dataIndex !== 0) return null;
      const pts = vals.map((v, y) => (v ? y : null)).filter((y) => y != null);
      if (pts.length < 2) return null;
      const poly = pts.map((y) => api.coord([y, vals[y][2]])).concat(pts.slice().reverse().map((y) => api.coord([y, vals[y][1]])));
      return { type: "polygon", shape: { points: poly }, style: { fill: color, opacity: 0.18 } }; } });
  chart("c-dis-rate").setOption({
    ...b, grid: { left: 12, right: 24, top: 52, bottom: 30, containLabel: true },
    legend: { top: 0, left: 0, data: ["自院", "比較対象全体"], itemWidth: 20, itemHeight: 3, itemStyle: { borderWidth: 0 }, textStyle: { color: css("--text-secondary"), fontSize: 11 } },
    tooltip: { ...b.tooltip, trigger: "axis", formatter: (ps) => { const y = ps[0].dataIndex, s = selfR[y], g = grpR[y];
      return `<div style="margin-bottom:2px">${TYL[y]}・${esc(nm)}</div>` +
        tipRow(s ? `${F.pct(s[0])}（${F.pct(s[1])}〜${F.pct(s[2])}）` : "–", "自院") +
        tipRow(g ? `${F.pct(g[0])}（${F.pct(g[1])}〜${F.pct(g[2])}）` : "–", `比較対象全体（${G[y] ? G[y].cnt : 0}施設${cb ? "＋令和6年度にない病院" : ""}）`); } },
    xAxis: xYears(b),
    yAxis: ax(b, { type: "value", min: 0, axisLabel: { ...b.axisCommon.axisLabel, formatter: (v) => Math.round(v * 100) + "%" } }),
    series: [
      band(grpR, css("--other-strong"), null), band(selfR, css("--self"), null),
      { name: "比較対象全体", type: "line", data: xy(grpR.map((v) => (v ? v[0] : null))), symbol: "circle", symbolSize: 6, z: 6,
        lineStyle: { color: css("--ref"), width: 2, type: [5, 3] }, itemStyle: { color: css("--ref") } },
      { type: "line", data: [], z: 0, silent: true, tooltip: { show: false }, ...guides(true, true) },
      { name: "自院", type: "line", data: xy(selfR.map((v) => (v ? v[0] : null))), symbol: "circle", symbolSize: 8, z: 7,
        lineStyle: { color: css("--self"), width: 2.5 }, itemStyle: { color: css("--self"), borderColor: css("--surface-1"), borderWidth: 2 } },
    ],
  }, true);
  setNote("c-dis-rate", "線は推計値、薄い帯は非公表のセルを0件〜9件とした場合の幅。比較対象全体は自院を含む合計で計算しています。");
  setTable("c-dis-rate", ["年度", "自院", "自院の幅", "比較対象全体", "比較対象全体の幅"], TY.map((_, y) => ({ cells: [TYL[y],
    selfR[y] ? F.pct(selfR[y][0]) : "–", selfR[y] ? `${F.pct(selfR[y][1])}〜${F.pct(selfR[y][2])}` : "–",
    grpR[y] ? F.pct(grpR[y][0]) : "–", grpR[y] ? `${F.pct(grpR[y][1])}〜${F.pct(grpR[y][2])}` : "–"] })));

  // C 比較対象全体の件数と自院のシェア
  document.getElementById("dis-grp-title").textContent = `比較対象全体の件数と自院のシェア：${nm}`;
  const selfT = selfRows.map((r) => (r ? r[N_EST] + r[A_EST] : 0));
  const othT = TY.map((_, y) => (has[y] ? sum(S.others.map((h) => { const r = disRow(h, y); return r ? r[N_EST] + r[A_EST] : 0; })) : 0));
  const clT = TY.map((_, y) => (cb ? cb[y][0] + cb[y][1] : 0));
  const totT = TY.map((_, y) => selfT[y] + othT[y] + clT[y]);
  const ser = [{ name: "自院", data: selfT, color: css("--self") }, { name: "比較対象の他院", data: othT, color: css("--other") }];
  if (cb) ser.push({ name: "閉院・統合などで令和6年度にない病院", data: clT, color: css("--other-strong") });
  chart("c-dis-grp").setOption({
    ...b, grid: { left: 12, right: 16, top: 52, bottom: 30, containLabel: true },
    legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 10, textStyle: { color: css("--text-secondary"), fontSize: 11 } },
    tooltip: { ...b.tooltip, trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(127,127,127,0.08)" } }, formatter: (ps) => { const y = ps[0].dataIndex;
      return `<div style="margin-bottom:2px">${TYL[y]}・${esc(nm)}（推計を含む）</div>` + ps.map((p) => tipRow("約" + est(p.value) + "件", p.seriesName)).join("") +
        tipRow("約" + est(totT[y]) + "件", "合計") + tipRow(totT[y] ? F.pct(selfT[y] / totT[y]) : "–", "自院のシェア"); } },
    xAxis: ax(b, { type: "category", data: R6LAB, splitLine: { show: false }, axisLabel: { ...b.axisCommon.axisLabel, interval: 0 } }),
    yAxis: ax(b, { type: "value", axisLabel: { ...b.axisCommon.axisLabel, formatter: (v) => v.toLocaleString("ja-JP") } }),
    series: ser.map((s, i) => ({ name: s.name, type: "bar", stack: "t", data: s.data.map((v, y) => (has[y] ? v : null)), barMaxWidth: 46,
      itemStyle: { color: s.color, borderColor: css("--surface-1"), borderWidth: 1, borderRadius: i === ser.length - 1 ? [4, 4, 0, 0] : 0 },
      label: i === 0 ? { show: true, position: "inside", color: "#fff", fontSize: 10, formatter: (p) => (totT[p.dataIndex] && selfT[p.dataIndex] ? F.pct(selfT[p.dataIndex] / totT[p.dataIndex]) : "") } : undefined })),
  }, true);
  setNote("c-dis-grp", "件数は手術あり＋手術なしの推計値。棒の中の数字は自院のシェア。" + (cb ? "二次医療圏では、令和6年度までに閉院・統合などでなくなった病院も市場に含めています（「11 経年推移」のチェックで切り替え）。" : ""));
  setTable("c-dis-grp", ["年度", "自院", "他院", ...(cb ? ["令和6年度にない病院"] : []), "合計", "自院のシェア"], TY.map((_, y) => ({ cells: [TYL[y], est(selfT[y]), est(othT[y]),
    ...(cb ? [est(clT[y])] : []), est(totT[y]), totT[y] ? F.pct(selfT[y] / totT[y]) : "–"] })));

  // D 平均在院日数（手術あり／なし）
  document.getElementById("dis-los-title").textContent = `平均在院日数：${nm}（手術あり／なし）`;
  const sLA = selfRows.map((r) => (r ? r[L_A] : null)), sLN = selfRows.map((r) => (r ? r[L_N] : null));
  const gLA = G.map((g) => (g && g.laW ? g.la / g.laW : null)), gLN = G.map((g) => (g && g.lnW ? g.ln / g.lnW : null));
  const line = (name, vals, color, dashed, self) => ({ name, type: "line", data: xy(vals), connectNulls: false, symbol: "circle", symbolSize: self ? 8 : 6, z: self ? 5 : 3,
    lineStyle: { color, width: self ? 2.5 : 1.8, type: dashed ? [5, 3] : "solid" }, itemStyle: { color, borderColor: css("--surface-1"), borderWidth: self ? 2 : 1 } });
  chart("c-dis-los").setOption({
    ...b, grid: { left: 12, right: 24, top: document.getElementById("c-dis-los").clientWidth < 560 ? 64 : 44, bottom: 30, containLabel: true },
    legend: { top: 0, left: 0, itemWidth: 20, itemHeight: 3, itemStyle: { borderWidth: 0 }, textStyle: { color: css("--text-secondary"), fontSize: 11 } },
    tooltip: { ...b.tooltip, trigger: "axis", formatter: (ps) => `<div style="margin-bottom:2px">${TYL[ps[0].dataIndex]}・${esc(nm)}</div>` +
      ps.filter((p) => p.seriesType === "line" && p.seriesName).map((p) => tipRow(p.value && p.value[1] != null ? p.value[1].toFixed(1) + "日" : "–", p.seriesName)).join("") },
    xAxis: xYears(b),
    yAxis: ax(b, { type: "value", scale: true, axisLabel: { ...b.axisCommon.axisLabel, formatter: (v) => v + "日" } }),
    series: [line("自院：手術あり", sLA, cA, false, true), line("自院：手術なし", sLN, cN, false, true),
      { ...line("比較対象全体：手術あり", gLA, cA, true, false), ...guides(false, true) }, line("比較対象全体：手術なし", gLN, cN, true, false)],
  }, true);
  setNote("c-dis-los", "実線が自院、点線が比較対象全体（自院を含む）。公表されているセル（10件以上）だけの加重平均です。");
  setTable("c-dis-los", ["年度", "自院：手術あり", "自院：手術なし", "比較対象全体：手術あり", "比較対象全体：手術なし"], TY.map((_, y) => ({ cells: [TYL[y],
    ...[sLA[y], sLN[y], gLA[y], gLN[y]].map((v) => (v == null ? "–" : v.toFixed(1) + "日"))] })));
  refreshOpenTables();
}
document.getElementById("tr-closed").addEventListener("change", () => renderDis());
