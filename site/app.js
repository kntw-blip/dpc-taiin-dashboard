"use strict";
/* DPC退院患者調査ダッシュボード（令和6年度）
   データ: data/core.json（病院別主要指標）, data/mdc.json（MDC別詳細）, data/areas.json（医療圏・メタ情報） */

const $ = (s) => document.querySelector(s);
const root = document.documentElement;
const vizRoot = document.querySelector(".viz-root");
const css = (n) => getComputedStyle(vizRoot).getPropertyValue(n).trim();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const S = { H: [], byId: new Map(), byArea: new Map(), byCorp: new Map(), mdc: null, areas: {}, meta: {},
            self: null, axis: "area", scope: "dpc", G: [], charts: {}, tables: {} };

/* ---------- 書式 ---------- */
const F = {
  int: (v) => v == null ? "–" : Math.round(v).toLocaleString("ja-JP"),
  d1: (v) => v == null ? "–" : v.toFixed(1),
  d2: (v) => v == null ? "–" : v.toFixed(2),
  d3: (v) => v == null ? "–" : v.toFixed(3),
  pct: (v) => v == null ? "–" : (v * 100).toFixed(1) + "%",
};
const MDCS = ["01 神経系", "02 眼科系", "03 耳鼻咽喉科系", "04 呼吸器系", "05 循環器系", "06 消化器系", "07 筋骨格系", "08 皮膚", "09 乳房",
              "10 内分泌・代謝", "11 腎・尿路系", "12 女性生殖器・産科", "13 血液・免疫", "14 新生児", "15 小児疾患", "16 外傷・熱傷・中毒", "17 精神", "18 その他"];

/* ---------- 指標の定義（low: 小さいほど上位） ---------- */
const sum = (a) => a.reduce((s, x) => s + (x || 0), 0);
const M = {
  n6: { label: "退院患者数", unit: "件", fmt: F.int, get: (h) => h.n6, prev: (h) => h.n5 },
  los6: { label: "平均在院日数", unit: "日", fmt: F.d1, get: (h) => h.los6, prev: (h) => h.los5, low: true },
  eff6: { label: "在院日数の指標", unit: "", fmt: F.d2, get: (h) => h.eff6, prev: (h) => h.eff5 },
  cmi6: { label: "患者構成の指標", unit: "", fmt: F.d2, get: (h) => h.cmi6, prev: (h) => h.cmi5 },
  kinds6: { label: "出現した診断群分類の数", unit: "分類", fmt: F.int, get: (h) => h.kinds6 },
  perBed: { label: "病床あたり退院患者数", unit: "件/床・年", fmt: F.d1, get: (h) => h.perBed },
  b_total: { label: "病床数（医療保険）", unit: "床", fmt: F.int, get: (h) => h.b_total },
  ambm6: { label: "救急車搬送（月）", unit: "件/月", fmt: F.d1, get: (h) => h.ambm6, prev: (h) => h.ambm5 },
  amb6: { label: "救急車搬送率", unit: "", fmt: F.pct, get: (h) => h.amb6, prev: (h) => h.amb5 },
  emgm6: { label: "救急医療入院（月）", unit: "件/月", fmt: F.d1, get: (h) => h.emgm6, prev: (h) => h.emgm5 },
  emg6: { label: "救急医療入院率", unit: "", fmt: F.pct, get: (h) => h.emg6, prev: (h) => h.emg5 },
  ref6: { label: "他院からの紹介率", unit: "", fmt: F.pct, get: (h) => h.ref6, prev: (h) => h.ref5 },
  surgN: { label: "手術ありの件数", unit: "件", fmt: F.int, get: (h) => h.surgN },
  surgR: { label: "手術あり率", unit: "", fmt: F.pct, get: (h) => h.surgR },
  gaN: { label: "全身麻酔ありの件数", unit: "件", fmt: F.int, get: (h) => h.gaN },
  chemoN: { label: "化学療法ありの件数", unit: "件", fmt: F.int, get: (h) => h.chemoN },
  radN: { label: "放射線療法ありの件数", unit: "件", fmt: F.int, get: (h) => h.radN },
  home6: { label: "家庭への退院率", unit: "", fmt: F.pct, get: (h) => h.home6, prev: (h) => h.home5 },
  death6: { label: "死亡退院率", unit: "", fmt: F.pct, get: (h) => h.death6, prev: (h) => h.death5, low: true },
  readmU: { label: "4週以内の計画外再入院率", unit: "", fmt: F.pct, get: (h) => h.readmU, low: true },
  gen6: { label: "後発医薬品の使用割合", unit: "", fmt: F.pct, get: (h) => h.gen6 },
};

/* ---------- 読み込み ---------- */
async function load() {
  const [core, ar] = await Promise.all([fetch("data/core.json").then((r) => r.json()), fetch("data/areas.json").then((r) => r.json())]);
  S.areas = ar.areas; S.meta = ar.meta;
  const C = core.cols;
  for (const row of core.rows) {
    const h = {}; C.forEach((c, i) => (h[c] = row[i]));
    derive(h); S.H.push(h); S.byId.set(h.id, h);
    if (h.area) (S.byArea.get(h.area) || S.byArea.set(h.area, []).get(h.area)).push(h);
    if (h.corp_key) (S.byCorp.get(h.corp_key) || S.byCorp.set(h.corp_key, []).get(h.corp_key)).push(h);
  }
  $("#built").textContent = `データ作成：${S.meta.built_at}（UTC）`;
  fetch("data/surg.json").then((r) => r.json()).then((d) => {
    const byH = new Map();
    for (const [id, arr] of Object.entries(d.h)) { const m = new Map(); arr.forEach(([ci, n, l]) => m.set(ci, [n, l])); byH.set(id, m); }
    S.surg = { cats: d.cats, byH }; initSurgSearch(); if (S.self) renderSurg();
  });
  S.mdcPromise = fetch("data/mdc.json").then((r) => r.json()).then((d) => { S.mdc = d; if (S.self) renderMdcDependent(); });
}
function derive(h) {
  const a = h.adv;
  if (a && a[0]) { h.surgN = a[1]; h.surgR = a[1] != null ? a[1] / a[0] : null; h.chemoN = a[2]; h.radN = a[3]; h.gaN = a[6]; h.gaR = a[6] != null ? a[6] / a[0] : null;
                   h.chemoR = a[2] != null ? a[2] / a[0] : null; h.radR = a[3] != null ? a[3] / a[0] : null; }
  const yr = (arr, y) => (arr && arr[y]) || null;
  const o5 = yr(h.outc, 0), o6 = yr(h.outc, 1);
  h.death5 = o5 && o5[4] != null && o5[5] != null ? o5[4] + o5[5] : null;
  h.death6 = o6 && o6[4] != null && o6[5] != null ? o6[4] + o6[5] : null;
  const d5 = yr(h.dest, 0), d6 = yr(h.dest, 1);
  h.home5 = d5 && d5[0] != null ? sum(d5.slice(0, 3)) : null;
  h.home6 = d6 && d6[0] != null ? sum(d6.slice(0, 3)) : null;
  h.readmU = h.readm3 && h.readm3[4] != null && h.readm3[7] != null ? h.readm3[4] + h.readm3[7] : null;
  h.perBed = h.n6 && h.b_total ? h.n6 / h.b_total : null;
  h.mdcN = h.mdc6 && h.mdcn6 ? h.mdc6.map((r) => (r == null ? null : r * h.mdcn6)) : null;
  h.short = shortName(h.name);
}
const CORP_RE = /^(地方独立行政法人|独立行政法人|国立研究開発法人|国立大学法人|公立大学法人|学校法人|社会医療法人(社団|財団)?|特定医療法人(社団|財団)?|医療法人(社団|財団)?|社団医療法人|財団医療法人|一般財団法人|一般社団法人|公益財団法人|公益社団法人|社会福祉法人(恩賜財団)?)[\s　]*/;
function shortName(n) {
  let s = n.replace(CORP_RE, "");
  s = s.replace(/^(国立病院機構|地域医療機能推進機構|労働者健康安全機構)[\s　]*/, "");
  const parts = s.split(/[\s　]+/);
  if (parts.length > 1 && parts[parts.length - 1].length >= 3) s = parts[parts.length - 1];
  return s || n;
}

/* ---------- 比較対象 ---------- */
const inScope = (h) => S.scope === "all" || h.type === "DPC" || h.type === "準備";
function computeGroup() {
  const h = S.self;
  let list;
  if (S.axis === "area") list = S.byArea.get(h.area) || [h];
  else list = h.corp_key ? S.byCorp.get(h.corp_key) || [h] : [h];
  S.G = list.filter((x) => x === h || inScope(x));
  S.others = S.G.filter((x) => x !== h);
}
const groupLabel = () => {
  const h = S.self;
  if (S.axis === "area") return `二次医療圏「${h.area.split("|")[1]}」（${h.pref}）`;
  return h.corp ? `法人「${h.corp}」` : "法人不明";
};
const mean = (list, f) => { const v = list.map(f).filter((x) => x != null); return v.length ? sum(v) / v.length : null; };
const wsum = (list, f) => sum(list.map(f).map((x) => x ?? 0));
function rankOf(m, h, list) {
  const v = m.get(h); if (v == null) return null;
  const vals = list.map(m.get).filter((x) => x != null);
  const better = vals.filter((x) => (m.low ? x < v : x > v)).length;
  return { rank: better + 1, n: vals.length };
}

/* ---------- 共通チャート設定 ---------- */
function chart(id) {
  const el = document.getElementById(id);
  if (!S.charts[id]) S.charts[id] = echarts.init(el, null, { renderer: "svg" });
  return S.charts[id];
}
function base() {
  const t = { color: css("--text-secondary"), fontSize: 11 };
  return {
    textStyle: { fontFamily: getComputedStyle(vizRoot).fontFamily, color: css("--text-primary") },
    animationDuration: 300,
    tooltip: { confine: true, backgroundColor: css("--surface-1"), borderColor: css("--border"), borderWidth: 1,
               textStyle: { color: css("--text-primary"), fontSize: 12 }, extraCssText: "box-shadow:0 6px 20px rgba(0,0,0,.14);border-radius:8px;" },
    axisCommon: { axisLine: { lineStyle: { color: css("--axis") } }, axisTick: { show: false }, axisLabel: t,
                  splitLine: { lineStyle: { color: css("--grid"), width: 1 } }, nameTextStyle: t },
  };
}
function ax(b, extra) { return Object.assign({}, b.axisCommon, extra); }
const tipRow = (val, label) => `<div><b style="font-size:13px">${esc(val)}</b> <span style="color:${css("--text-secondary")}">${esc(label)}</span></div>`;

/* 表ビュー（すべてのチャートに対応する表） */
function setTable(id, head, rows) { S.tables[id] = { head, rows }; }
function initTableButtons() {
  document.querySelectorAll(".card[data-chart]").forEach((card) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "ghost small tbtn"; b.textContent = "表"; b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => {
      const ch = card.querySelector(".chart"); const on = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", String(on)); b.textContent = on ? "グラフ" : "表";
      let tv = card.querySelector(".tableview");
      if (on) {
        if (!tv) { tv = document.createElement("div"); tv.className = "tableview"; ch.after(tv); }
        fillTable(tv, S.tables[ch.id]); tv.hidden = false; ch.style.display = "none";
      } else { if (tv) tv.hidden = true; ch.style.display = ""; S.charts[ch.id]?.resize(); }
    });
    card.appendChild(b);
  });
}
function fillTable(tv, t) {
  tv.textContent = "";
  if (!t) return;
  const tb = document.createElement("table"), th = document.createElement("thead"), trh = document.createElement("tr");
  t.head.forEach((x, i) => { const c = document.createElement("th"); c.textContent = x; if (i === 0) c.className = "t"; trh.appendChild(c); });
  th.appendChild(trh); tb.appendChild(th);
  const body = document.createElement("tbody");
  t.rows.forEach((r) => { const tr = document.createElement("tr"); if (r.self) tr.className = "self";
    r.cells.forEach((x, i) => { const c = document.createElement("td"); c.textContent = x; if (i === 0) c.className = "t"; tr.appendChild(c); }); body.appendChild(tr); });
  tb.appendChild(body); tv.appendChild(tb);
}
function refreshOpenTables() {
  document.querySelectorAll(".card[data-chart]").forEach((card) => {
    const tv = card.querySelector(".tableview"), ch = card.querySelector(".chart");
    if (tv && !tv.hidden) fillTable(tv, S.tables[ch.id]);
  });
}

/* ---------- ランキング（自院を強調、他院はグレー、他院平均を縦線） ---------- */
function rankChart(id, mk, opt = {}) {
  const m = typeof mk === "string" ? M[mk] : mk, b = base(), self = S.self, top = opt.top || 25;
  const list = S.G.filter((h) => m.get(h) != null).sort((a, c) => (m.low ? m.get(a) - m.get(c) : m.get(c) - m.get(a)));
  const pos = list.indexOf(self);
  let show = list.slice(0, top);
  if (pos >= top) show = show.concat([self]);
  const el = document.getElementById(id);
  el.style.height = Math.max(240, show.length * 24 + 70) + "px";
  const avg = mean(S.others, m.get);
  const c = chart(id); c.resize();
  const items = show.map((h) => ({ value: m.get(h), hid: h.id, itemStyle: { color: h === self ? css("--self") : css("--other"), borderRadius: [0, 4, 4, 0] } }));
  c.setOption({
    ...b, grid: { left: 8, right: 70, top: 28, bottom: 28, containLabel: true },
    tooltip: { ...b.tooltip, trigger: "item", formatter: (p) => {
      const h = S.byId.get(p.data.hid), r = list.indexOf(h) + 1;
      return `<div style="margin-bottom:2px">${esc(h.name)}</div>` + tipRow(m.fmt(p.value) + (m.unit ? " " + m.unit : ""), `${r}位 / ${list.length}施設`); } },
    xAxis: ax(b, { type: "value", axisLabel: { ...b.axisCommon.axisLabel, formatter: (v) => (m.fmt === F.pct ? Math.round(v * 100) + "%" : v.toLocaleString("ja-JP")) } }),
    yAxis: ax(b, { type: "category", inverse: true, data: show.map((h, i) => (h === self && pos >= top ? `${pos + 1}位 ` : `${list.indexOf(h) + 1}位 `) + h.short),
      axisLabel: { ...b.axisCommon.axisLabel, width: 190, overflow: "truncate",
        formatter: (v, i) => (show[i] === self ? `{s|${v}}` : v), rich: { s: { color: css("--text-primary"), fontWeight: 700, fontSize: 11 } } },
      splitLine: { show: false } }),
    series: [{ type: "bar", data: items, barMaxWidth: 16, barCategoryGap: "30%",
      label: { show: true, position: "right", color: css("--text-primary"), fontSize: 11,
        formatter: (p) => (p.data.hid === self.id ? m.fmt(p.value) : "") },
      markLine: avg == null ? undefined : { silent: true, symbol: "none", lineStyle: { color: css("--ref"), type: "solid", width: 1 },
        label: { show: false }, data: [{ xAxis: avg }] } }],
  }, true);
  const order = m.low ? "小さい順" : "大きい順";
  const note = `${order}。縦線は他院平均（${m.fmt(avg)}${m.unit && avg != null ? " " + m.unit : ""}）。` +
    (list.length > show.length ? `${list.length}施設中、上位${top}施設${pos >= top ? "と自院" : ""}を表示。` : "") + (pos < 0 ? "自院の値は秘匿または未公表です。" : "");
  setNote(id, note);
  setTable(id, ["病院", "順位", m.label + (m.unit ? `（${m.unit}）` : "")],
    list.map((h, i) => ({ self: h === self, cells: [h.name, `${i + 1}`, m.fmt(m.get(h))] })));
}
function setNote(id, txt) {
  const el = document.getElementById(id);
  let n = el.parentElement.querySelector(".cnote");
  if (!n) { n = document.createElement("p"); n.className = "muted small cnote"; el.parentElement.querySelector("h3").after(n); }
  n.textContent = txt; n.hidden = !txt;
}

/* ---------- 散布図（他院はグレーの点、自院は青で名前つき） ---------- */
function scatter(id, xk, yk, opt = {}) {
  const mx = typeof xk === "string" ? M[xk] : xk, my = typeof yk === "string" ? M[yk] : yk, b = base(), self = S.self;
  const pts = S.G.filter((h) => mx.get(h) != null && my.get(h) != null);
  const ring = css("--surface-1");
  // 外れ値で軸が潰れないよう、2〜98パーセンタイルの範囲に収め、範囲外の点は端に三角で表示
  const bound = (vals) => { const v = vals.slice().sort((a, c) => a - c); if (v.length < 10) return null;
    const lo = v[Math.floor(v.length * 0.02)], hi = v[Math.ceil(v.length * 0.98) - 1], pad = (hi - lo) * 0.08; return [lo - pad, hi + pad]; };
  let bx = opt.clamp ? bound(pts.map(mx.get)) : null, by = opt.clamp ? bound(pts.map(my.get)) : null;
  if (bx && pts.includes(self)) bx = [Math.min(bx[0], mx.get(self)), Math.max(bx[1], mx.get(self))];
  if (by && pts.includes(self)) by = [Math.min(by[0], my.get(self)), Math.max(by[1], my.get(self))];
  const cl = (v, b) => (b ? Math.min(b[1], Math.max(b[0], v)) : v);
  const pt = (h) => { const x = mx.get(h), y = my.get(h), cx = cl(x, bx), cy = cl(y, by);
    return { value: [cx, cy], raw: [x, y], hid: h.id, symbol: cx !== x || cy !== y ? "triangle" : "circle" }; };
  const others = pts.filter((h) => h !== self).map(pt);
  const me = pts.includes(self) ? [pt(self)] : [];
  const ref = [];
  if (opt.refX != null) ref.push({ xAxis: opt.refX });
  if (opt.refY != null) ref.push({ yAxis: opt.refY, label: opt.refYLabel ? { show: true, formatter: opt.refYLabel, color: css("--text-secondary"), fontSize: 11, position: "insideEndTop" } : { show: false } });
  const fmtAx = (m) => (v) => (m.fmt === F.pct ? Math.round(v * 100) + "%" : v.toLocaleString("ja-JP"));
  chart(id).setOption({
    ...b, grid: { left: 12, right: 24, top: 30, bottom: 40, containLabel: true },
    legend: { top: 0, right: 0, textStyle: { color: css("--text-secondary"), fontSize: 11 }, data: ["自院", "比較対象の他院"] },
    tooltip: { ...b.tooltip, trigger: "item", formatter: (p) => `<div style="margin-bottom:2px">${esc(S.byId.get(p.data.hid).name)}</div>` +
      tipRow(mx.fmt(p.data.raw[0]), mx.label) + tipRow(my.fmt(p.data.raw[1]), my.label) },
    xAxis: ax(b, { type: opt.logX ? "log" : "value", name: mx.label + (mx.unit ? `（${mx.unit}）` : ""), nameLocation: "middle", nameGap: 26, scale: !!opt.scale,
      min: bx ? bx[0] : undefined, max: bx ? bx[1] : undefined,
      axisLabel: { ...b.axisCommon.axisLabel, formatter: fmtAx(mx), showMinLabel: !bx, showMaxLabel: !bx } }),
    yAxis: ax(b, { type: "value", name: my.label + (my.unit ? `（${my.unit}）` : ""), nameLocation: "end", scale: !!opt.scale,
      nameTextStyle: { ...b.axisCommon.nameTextStyle, align: "left" }, min: by ? by[0] : undefined, max: by ? by[1] : undefined,
      axisLabel: { ...b.axisCommon.axisLabel, formatter: fmtAx(my), showMinLabel: !by, showMaxLabel: !by } }),
    series: [
      { name: "比較対象の他院", type: "scatter", data: others, symbolSize: 9, itemStyle: { color: css("--other-strong"), borderColor: ring, borderWidth: 2 },
        emphasis: { scale: 1.4 },
        markLine: ref.length ? { silent: true, symbol: "none", lineStyle: { color: css("--axis"), type: "solid", width: 1 }, label: { show: false }, data: ref } : undefined },
      { name: "自院", type: "scatter", data: me, symbolSize: 14, z: 10, itemStyle: { color: css("--self"), borderColor: ring, borderWidth: 2 },
        label: { show: true, position: "right", formatter: (p) => S.byId.get(p.data.hid).short, color: css("--text-primary"), fontSize: 12, fontWeight: 600 } },
    ],
  }, true);
  setTable(id, ["病院", mx.label, my.label], pts.map((h) => ({ self: h === self, cells: [h.name, mx.fmt(mx.get(h)), my.fmt(my.get(h))] })));
  setNote(id, bx || by ? (others.concat(me).some((d) => d.symbol === "triangle") ? "▲は軸の範囲外の値（端に寄せて表示）。正確な値はツールチップか表で確認できます。" : "") : "");
}

/* ---------- 100%積み上げ（自院・比較対象全体・他院） ---------- */
function stack100(id, cats, getVec, opt = {}) {
  const b = base(), self = S.self, slots = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6"].map(css);
  const others = S.others.filter((h) => getVec(h)).sort((a, c) => (c.n6 || 0) - (a.n6 || 0)).slice(0, opt.top || 10);
  // 比較対象全体（件数で重み付け）
  const members = S.G.filter((h) => getVec(h) && h.n6);
  const tot = cats.map((_, i) => wsum(members, (h) => (getVec(h)[i] || 0) * h.n6));
  const T = sum(tot);
  const rows = [{ name: "自院：" + self.short, v: getVec(self), self: true }, { name: "比較対象全体", v: T ? tot.map((x) => x / T) : null }]
    .concat(others.map((h) => ({ name: h.short, v: getVec(h), full: h.name })));
  const valid = rows.filter((r) => r.v);
  const el = document.getElementById(id); el.style.height = Math.max(220, valid.length * 28 + 90) + "px";
  const c = chart(id); c.resize();
  c.setOption({
    ...b, grid: { left: 8, right: 16, top: 40, bottom: 24, containLabel: true },
    legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 10, textStyle: { color: css("--text-secondary"), fontSize: 11 } },
    tooltip: { ...b.tooltip, trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(127,127,127,0.08)" } },
      formatter: (ps) => `<div style="margin-bottom:2px">${esc(valid[ps[0].dataIndex].full || valid[ps[0].dataIndex].name)}</div>` +
        ps.map((p) => `<div><span style="display:inline-block;width:10px;height:2px;background:${p.color};vertical-align:middle;margin-right:6px"></span><b>${F.pct(p.value)}</b> <span style="color:${css("--text-secondary")}">${esc(p.seriesName)}</span></div>`).join("") },
    xAxis: ax(b, { type: "value", max: 1, axisLabel: { ...b.axisCommon.axisLabel, formatter: (v) => Math.round(v * 100) + "%" } }),
    yAxis: ax(b, { type: "category", inverse: true, data: valid.map((r) => r.name), splitLine: { show: false },
      axisLabel: { ...b.axisCommon.axisLabel, width: 180, overflow: "truncate", formatter: (v, i) => (valid[i].self || i === 1 ? `{s|${v}}` : v),
        rich: { s: { color: css("--text-primary"), fontWeight: 700, fontSize: 11 } } } }),
    series: cats.map((cn, i) => ({ name: cn, type: "bar", stack: "s", barMaxWidth: 18, data: valid.map((r) => r.v[i] || 0),
      itemStyle: { color: slots[i], borderColor: css("--surface-1"), borderWidth: 1 } })),
  }, true);
  setTable(id, ["病院"].concat(cats), valid.map((r, i) => ({ self: !!r.self, cells: [r.full || r.name].concat(cats.map((_, j) => F.pct(r.v[j]))) })));
}

/* ---------- サマリー ---------- */
const KPI = ["n6", "los6", "eff6", "cmi6", "ambm6", "emgm6", "ref6", "surgR", "gaN", "home6", "readmU", "gen6"];
function renderSummary() {
  const self = S.self, box = $("#kpis"); box.textContent = "";
  const axisWord = S.axis === "area" ? "医療圏内" : "法人内";
  for (const k of KPI) {
    const m = M[k], v = m.get(self), p = m.prev ? m.prev(self) : null, r = rankOf(m, self, S.G);
    const d = document.createElement("div"); d.className = "kpi";
    const l = document.createElement("div"); l.className = "l"; l.textContent = m.label;
    const val = document.createElement("div"); val.className = "v"; val.textContent = m.fmt(v);
    if (m.unit && v != null) { const u = document.createElement("span"); u.className = "u"; u.textContent = m.unit; val.appendChild(u); }
    const dd = document.createElement("div"); dd.className = "d";
    if (v != null && p != null && p !== 0) {
      const diff = m.fmt === F.pct ? `${((v - p) * 100 >= 0 ? "+" : "")}${((v - p) * 100).toFixed(1)}ポイント` : `${v - p >= 0 ? "+" : ""}${(((v - p) / p) * 100).toFixed(1)}%`;
      dd.textContent = `${v >= p ? "▲" : "▼"} 前年度比 ${diff}`;
    } else dd.textContent = m.prev ? "前年度比 –" : " ";
    const rr = document.createElement("div"); rr.className = "r"; rr.textContent = r ? `${axisWord} ${r.rank}位 / ${r.n}施設` : `${axisWord} –`;
    d.append(l, val, dd, rr); box.appendChild(d);
  }
  // 順位メーター
  const rk = $("#ranks"); rk.textContent = "";
  for (const k of ["n6", "eff6", "cmi6", "ambm6", "emgm6", "ref6", "surgN", "gaN", "home6", "gen6", "los6", "death6", "readmU"]) {
    const m = M[k], r = rankOf(m, self, S.G);
    const left = document.createElement("div"); left.textContent = m.label + (m.low ? "（低いほど上位）" : "");
    const meter = document.createElement("div"); meter.className = "meter";
    const fill = document.createElement("i"); fill.style.width = r && r.n > 1 ? `${((r.n - r.rank) / (r.n - 1)) * 100}%` : r ? "100%" : "0";
    meter.appendChild(fill); left.appendChild(meter);
    const right = document.createElement("div"); right.className = "rk"; right.textContent = r ? `${r.rank}位 / ${r.n}` : "–";
    rk.append(left, right);
  }
  // レーダー（他院平均＝100）
  const RK = ["n6", "eff6", "cmi6", "ambm6", "ref6", "surgR", "gaN", "gen6"];
  const vals = RK.map((k) => { const a = mean(S.others, M[k].get), v = M[k].get(self); return a && v != null ? (v / a) * 100 : null; });
  const mx = 250;  // 250を超える値は外周に表示（実際の値は表で確認）
  const b = base();
  chart("c-radar").setOption({
    ...b,
    legend: { bottom: 0, textStyle: { color: css("--text-secondary"), fontSize: 11 }, data: ["自院", "他院平均"] },
    tooltip: { ...b.tooltip, trigger: "item", formatter: (p) => `<div style="margin-bottom:2px">${esc(p.name)}</div>` +
      RK.map((k, i) => tipRow(p.seriesIndex === 0 && vals[i] != null ? Math.round(vals[i]) : p.seriesIndex === 0 ? "–" : 100, M[k].label)).join("") },
    radar: { radius: "62%", center: ["50%", "48%"], indicator: RK.map((k) => ({ name: M[k].label, max: mx })), splitNumber: 4,
      axisName: { color: css("--text-secondary"), fontSize: 11 }, splitLine: { lineStyle: { color: css("--grid") } },
      splitArea: { show: false }, axisLine: { lineStyle: { color: css("--grid") } } },
    series: [{ type: "radar", data: [
      { name: "自院", value: vals.map((x) => (x == null ? 0 : Math.min(x, mx))), lineStyle: { color: css("--self"), width: 2 },
        itemStyle: { color: css("--self") }, symbolSize: 8, areaStyle: { color: css("--self"), opacity: 0.1 } },
      { name: "他院平均", value: RK.map(() => 100), lineStyle: { color: css("--ref"), width: 1 }, itemStyle: { color: css("--ref") }, symbol: "none" },
    ] }],
  }, true);
  setTable("c-radar", ["指標", "自院", "他院平均", "指数（他院平均＝100）"],
    RK.map((k, i) => ({ cells: [M[k].label, M[k].fmt(M[k].get(self)), M[k].fmt(mean(S.others, M[k].get)), vals[i] == null ? "–" : String(Math.round(vals[i]))] })));
  if (!S.others.length) setNote("c-radar", "比較対象の他院がないため、指数は表示できません。");
  else setNote("c-radar", vals.some((x) => x != null && x > mx) ? "250を超える指標は外周に表示しています（実際の値は「表」で確認できます）。" : "");
}

/* ---------- 1 規模 ---------- */
function renderScale() {
  rankChart("c-rank-n", "n6");
  scatter("c-sc-beds", "b_total", "n6", { clamp: true });
  const cats = ["DPC算定病床", "回復期リハ", "地域包括ケア・地域包括医療", "療養", "精神", "その他"];
  const vec = (h) => {
    if (!h.b_total) return null;
    const v = [h.b_dpc || 0, h.b_kaifuku || 0, (h.b_chiiki || 0) + (h.b_chiikiiryo || 0), h.b_ryoyo || 0, h.b_seishin || 0];
    return v.concat([Math.max(0, h.b_total - sum(v))]);
  };
  const b = base(), self = S.self, slots = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6"].map(css);
  const rows = [self].concat(S.others.filter(vec).sort((a, c) => c.b_total - a.b_total).slice(0, 15));
  const el = document.getElementById("c-beds"); el.style.height = Math.max(220, rows.length * 26 + 80) + "px";
  const c = chart("c-beds"); c.resize();
  c.setOption({
    ...b, grid: { left: 8, right: 20, top: 40, bottom: 24, containLabel: true },
    legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 10, textStyle: { color: css("--text-secondary"), fontSize: 11 } },
    tooltip: { ...b.tooltip, trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(127,127,127,0.08)" } },
      formatter: (ps) => `<div style="margin-bottom:2px">${esc(rows[ps[0].dataIndex].name)}</div>` + ps.filter((p) => p.value).map((p) => tipRow(F.int(p.value) + "床", p.seriesName)).join("") },
    xAxis: ax(b, { type: "value" }),
    yAxis: ax(b, { type: "category", inverse: true, data: rows.map((h) => (h === self ? "自院：" : "") + h.short), splitLine: { show: false },
      axisLabel: { ...b.axisCommon.axisLabel, width: 180, overflow: "truncate", formatter: (v, i) => (i === 0 ? `{s|${v}}` : v), rich: { s: { color: css("--text-primary"), fontWeight: 700, fontSize: 11 } } } }),
    series: cats.map((cn, i) => ({ name: cn, type: "bar", stack: "b", barMaxWidth: 16, data: rows.map((h) => (vec(h) ? vec(h)[i] : 0)),
      itemStyle: { color: slots[i], borderColor: css("--surface-1"), borderWidth: 1 } })),
  }, true);
  setTable("c-beds", ["病院"].concat(cats, ["合計"]), rows.map((h) => ({ self: h === self, cells: [h.name].concat((vec(h) || []).map(F.int), [F.int(h.b_total)]) })));
}

/* ---------- 2 疾患構成・シェア ---------- */
function renderMdc() {
  const self = S.self, b = base(), G = S.G.filter((h) => h.mdcN);
  const T = MDCS.map((_, i) => wsum(G, (h) => h.mdcN[i]));
  // シェア
  const share = MDCS.map((_, i) => (self.mdcN && self.mdcN[i] != null && T[i] ? self.mdcN[i] / T[i] : null));
  const rk = MDCS.map((_, i) => {
    if (!self.mdcN || self.mdcN[i] == null) return null;
    const v = self.mdcN[i]; return { r: G.filter((h) => (h.mdcN[i] || 0) > v).length + 1, n: G.filter((h) => h.mdcN[i]).length };
  });
  chart("c-mdc-share").setOption({
    ...b, grid: { left: 8, right: 110, top: 10, bottom: 24, containLabel: true },
    tooltip: { ...b.tooltip, trigger: "item", formatter: (p) => `<div style="margin-bottom:2px">${esc(MDCS[p.dataIndex])}</div>` +
      tipRow(F.pct(share[p.dataIndex]), "比較対象内のシェア") + tipRow(F.int(self.mdcN?.[p.dataIndex]) + "件", "自院の患者数") +
      tipRow(F.int(T[p.dataIndex]) + "件", "比較対象の合計") + (rk[p.dataIndex] ? tipRow(`${rk[p.dataIndex].r}位 / ${rk[p.dataIndex].n}`, "順位") : "") },
    xAxis: ax(b, { type: "value", axisLabel: { ...b.axisCommon.axisLabel, formatter: (v) => Math.round(v * 100) + "%" } }),
    yAxis: ax(b, { type: "category", inverse: true, data: MDCS, splitLine: { show: false } }),
    series: [{ type: "bar", data: share.map((v) => v ?? 0), barMaxWidth: 14, itemStyle: { color: css("--self"), borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: "right", color: css("--text-secondary"), fontSize: 11,
        formatter: (p) => (share[p.dataIndex] == null ? "–" : `${F.pct(share[p.dataIndex])}（${rk[p.dataIndex].r}位/${rk[p.dataIndex].n}）`) } }],
  }, true);
  setTable("c-mdc-share", ["MDC", "自院の患者数", "比較対象の合計", "シェア", "順位"],
    MDCS.map((m, i) => ({ cells: [m, F.int(self.mdcN?.[i]), F.int(T[i]), F.pct(share[i]), rk[i] ? `${rk[i].r} / ${rk[i].n}` : "–"] })));
  // 構成比
  const TT = sum(T), mixG = T.map((x) => (TT ? x / TT : null)), mixS = self.mdc6 || MDCS.map(() => null);
  chart("c-mdc-mix").setOption({
    ...b, grid: { left: 8, right: 20, top: 30, bottom: 24, containLabel: true },
    legend: { top: 0, right: 0, textStyle: { color: css("--text-secondary"), fontSize: 11 }, data: ["自院", "比較対象全体"] },
    tooltip: { ...b.tooltip, trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(127,127,127,0.08)" } },
      formatter: (ps) => `<div style="margin-bottom:2px">${esc(MDCS[ps[0].dataIndex])}</div>` + ps.map((p) => tipRow(F.pct(p.value), p.seriesName)).join("") },
    xAxis: ax(b, { type: "value", axisLabel: { ...b.axisCommon.axisLabel, formatter: (v) => Math.round(v * 100) + "%" } }),
    yAxis: ax(b, { type: "category", inverse: true, data: MDCS, splitLine: { show: false } }),
    series: [
      { name: "自院", type: "bar", data: mixS.map((v) => v ?? 0), barMaxWidth: 8, barGap: "20%", itemStyle: { color: css("--self"), borderRadius: [0, 4, 4, 0] } },
      { name: "比較対象全体", type: "bar", data: mixG, barMaxWidth: 8, itemStyle: { color: css("--other-strong"), borderRadius: [0, 4, 4, 0] } },
    ],
  }, true);
  setTable("c-mdc-mix", ["MDC", "自院", "比較対象全体"], MDCS.map((m, i) => ({ cells: [m, F.pct(mixS[i]), F.pct(mixG[i])] })));
  // ヒートマップ
  const rows = [self].concat(S.others.filter((h) => h.mdcN).sort((a, c) => (c.n6 || 0) - (a.n6 || 0)).slice(0, 19)).filter((h) => h.mdcN);
  const data = [];
  rows.forEach((h, y) => MDCS.forEach((_, x) => { const v = h.mdcN[x]; data.push([x, y, v == null || !T[x] ? null : v / T[x], v]); }));
  const seq = ["--seq-1", "--seq-2", "--seq-3", "--seq-4", "--seq-5", "--seq-6", "--seq-7"].map(css);
  const el = document.getElementById("c-heat"); el.style.height = Math.max(260, rows.length * 26 + 130) + "px";
  const c = chart("c-heat"); c.resize();
  c.setOption({
    ...b, grid: { left: 8, right: 20, top: 10, bottom: 80, containLabel: true },
    tooltip: { ...b.tooltip, trigger: "item", formatter: (p) => `<div style="margin-bottom:2px">${esc(rows[p.data[1]].name)}</div>` +
      `<div style="color:${css("--text-secondary")}">${esc(MDCS[p.data[0]])}</div>` + tipRow(F.int(p.data[3]) + "件", "患者数") + tipRow(F.pct(p.data[2]), "比較対象内のシェア") },
    xAxis: ax(b, { type: "category", data: MDCS.map((m) => m.slice(0, 2)), position: "top", splitLine: { show: false }, axisLine: { show: false } }),
    yAxis: ax(b, { type: "category", inverse: true, data: rows.map((h) => (h === self ? "自院：" : "") + h.short), splitLine: { show: false }, axisLine: { show: false },
      axisLabel: { ...b.axisCommon.axisLabel, width: 180, overflow: "truncate", formatter: (v, i) => (i === 0 ? `{s|${v}}` : v), rich: { s: { color: css("--text-primary"), fontWeight: 700, fontSize: 11 } } } }),
    visualMap: { type: "continuous", dimension: 2, min: 0, max: heatMax(data), orient: "horizontal", left: "center", bottom: 8,
      inRange: { color: seq }, text: ["シェア高", "低"], textStyle: { color: css("--text-secondary"), fontSize: 11 }, calculable: false, itemHeight: 160, itemWidth: 10,
      formatter: (v) => F.pct(v) },
    series: [{ type: "heatmap", data, itemStyle: { borderColor: css("--surface-1"), borderWidth: 2, borderRadius: 3 },
      emphasis: { itemStyle: { borderColor: css("--text-primary"), borderWidth: 1 } } }],
  }, true);
  setTable("c-heat", ["病院"].concat(MDCS), rows.map((h) => ({ self: h === self, cells: [h.name].concat(MDCS.map((_, i) => F.int(h.mdcN[i]))) })));
  // 流出入（医療圏の軸のときだけ）
  const fc = $("#card-flow");
  if (S.axis !== "area" || !S.areas[self.area]) { fc.hidden = true; return; }
  fc.hidden = false;
  const all = (S.byArea.get(self.area) || []).filter((h) => h.mdcN);
  const sup = MDCS.map((_, i) => wsum(all, (h) => h.mdcN[i])), dem = S.areas[self.area].res;
  const flow = MDCS.map((_, i) => (dem[i] ? sup[i] / dem[i] - 1 : null));
  chart("c-flow").setOption({
    ...b, grid: { left: 8, right: 60, top: 10, bottom: 24, containLabel: true },
    tooltip: { ...b.tooltip, trigger: "item", formatter: (p) => `<div style="margin-bottom:2px">${esc(MDCS[p.dataIndex])}</div>` +
      tipRow((flow[p.dataIndex] >= 0 ? "+" : "") + F.pct(flow[p.dataIndex]), "流入超過（＋）／流出超過（−）") +
      tipRow(F.int(sup[p.dataIndex]) + "件", "医療圏内の病院の患者数") + tipRow(F.int(dem[p.dataIndex]) + "件", "医療圏に住む患者の数") },
    xAxis: ax(b, { type: "value", axisLabel: { ...b.axisCommon.axisLabel, formatter: (v) => (v > 0 ? "+" : "") + Math.round(v * 100) + "%" } }),
    yAxis: ax(b, { type: "category", inverse: true, data: MDCS, splitLine: { show: false }, axisLine: { show: true, onZero: true } }),
    series: [{ type: "bar", barMaxWidth: 14, data: flow.map((v) => ({ value: v ?? 0, itemStyle: { color: (v ?? 0) >= 0 ? css("--pos") : css("--neg"),
      borderRadius: (v ?? 0) >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })),
      label: { show: true, position: "right", color: css("--text-secondary"), fontSize: 11, formatter: (p) => (flow[p.dataIndex] == null ? "–" : (flow[p.dataIndex] >= 0 ? "+" : "") + F.pct(flow[p.dataIndex])) } }],
  }, true);
  setTable("c-flow", ["MDC", "医療圏内の病院の患者数", "医療圏に住む患者の数", "流出入"], MDCS.map((m, i) => ({ cells: [m, F.int(sup[i]), F.int(dem[i]), flow[i] == null ? "–" : (flow[i] >= 0 ? "+" : "") + F.pct(flow[i])] })));
}

function heatMax(data) {  // 色の上限は外れ値ではなく95パーセンタイル（それ以上は最も濃い色）
  const v = data.map((d) => d[2]).filter((x) => x > 0).sort((a, c) => a - c);
  return v.length ? Math.max(0.02, v[Math.floor(v.length * 0.95)]) : 0.05;
}

/* ---------- 3 効率性・複雑性 ---------- */
function renderEff() {
  scatter("c-sc-eff", "cmi6", "eff6", { refX: 1, refY: 1, scale: true, clamp: true });
  rankChart("c-rank-los", "los6");
}
function renderMdcEff() {
  const self = S.self, b = base(), d = S.mdc && S.mdc[self.id];
  const los = d && d.los ? d.los : MDCS.map(() => [null, null, null, null]);
  const v = los.map((x) => (x && x[3] != null ? x[3] - 1 : null));
  chart("c-mdc-eff").setOption({
    ...b, grid: { left: 8, right: 50, top: 10, bottom: 30, containLabel: true },
    tooltip: { ...b.tooltip, trigger: "item", formatter: (p) => { const x = los[p.dataIndex];
      return `<div style="margin-bottom:2px">${esc(MDCS[p.dataIndex])}</div>` + tipRow(F.d2(x[3]), "在院日数の指標") + tipRow(F.d2(x[2]), "患者構成の指標") +
        tipRow(F.d1(x[1]) + "日", "平均在院日数") + tipRow(F.int(x[0]) + "件", "件数"); } },
    xAxis: ax(b, { type: "value", name: "在院日数の指標（1＝全国平均）", nameLocation: "middle", nameGap: 22,
      axisLabel: { ...b.axisCommon.axisLabel, formatter: (x) => (x + 1).toFixed(1) } }),
    yAxis: ax(b, { type: "category", inverse: true, data: MDCS, splitLine: { show: false }, axisLine: { show: true, onZero: true } }),
    series: [{ type: "bar", barMaxWidth: 14, data: v.map((x) => ({ value: x ?? 0, itemStyle: { color: (x ?? 0) >= 0 ? css("--pos") : css("--neg"),
      borderRadius: (x ?? 0) >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })),
      label: { show: true, position: "right", color: css("--text-secondary"), fontSize: 11, formatter: (p) => (v[p.dataIndex] == null ? "–" : F.d2(v[p.dataIndex] + 1)) } }],
  }, true);
  setNote("c-mdc-eff", d ? "青：全国平均より在院日数が短い／赤：長い。10件未満のMDCは表示されません。" : "読み込み中…");
  setTable("c-mdc-eff", ["MDC", "件数", "平均在院日数", "患者構成の指標", "在院日数の指標"], MDCS.map((m, i) => ({ cells: [m, F.int(los[i][0]), F.d1(los[i][1]), F.d2(los[i][2]), F.d2(los[i][3])] })));
}

/* ---------- 4 救急 ---------- */
function renderEmg() {
  rankChart("c-rank-amb", "ambm6");
  rankChart("c-rank-emg", "emgm6");
  scatter("c-sc-amb", "ambm6", "surgN", { clamp: true });
}
function renderMdcEmg() {
  const self = S.self, b = base();
  const get = (h, i) => { const d = S.mdc && S.mdc[h.id]; return d && d.adm && d.adm[i] ? d.adm[i][3] : null; };
  const mine = MDCS.map((_, i) => get(self, i));
  const tot = MDCS.map((_, i) => wsum(S.G, (h) => get(h, i)));
  chart("c-mdc-emg").setOption({
    ...b, grid: { left: 8, right: 110, top: 10, bottom: 24, containLabel: true },
    tooltip: { ...b.tooltip, trigger: "item", formatter: (p) => `<div style="margin-bottom:2px">${esc(MDCS[p.dataIndex])}</div>` +
      tipRow(F.int(mine[p.dataIndex]) + "件", "自院の救急医療入院") + tipRow(F.int(tot[p.dataIndex]) + "件", "比較対象の合計") +
      tipRow(mine[p.dataIndex] != null && tot[p.dataIndex] ? F.pct(mine[p.dataIndex] / tot[p.dataIndex]) : "–", "比較対象内のシェア") },
    xAxis: ax(b, { type: "value" }),
    yAxis: ax(b, { type: "category", inverse: true, data: MDCS, splitLine: { show: false } }),
    series: [{ type: "bar", data: mine.map((v) => v ?? 0), barMaxWidth: 14, itemStyle: { color: css("--self"), borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: "right", color: css("--text-secondary"), fontSize: 11,
        formatter: (p) => (mine[p.dataIndex] == null ? "–" : `${F.int(mine[p.dataIndex])}（シェア${tot[p.dataIndex] ? F.pct(mine[p.dataIndex] / tot[p.dataIndex]) : "–"}）`) } }],
  }, true);
  setNote("c-mdc-emg", S.mdc ? "–は10件未満（秘匿）。シェアは比較対象の病院の合計に対する割合です（秘匿分は合計に含まれません）。" : "読み込み中…");
  setTable("c-mdc-emg", ["MDC", "自院の救急医療入院", "比較対象の合計", "シェア"], MDCS.map((m, i) => ({ cells: [m, F.int(mine[i]), F.int(tot[i]), mine[i] != null && tot[i] ? F.pct(mine[i] / tot[i]) : "–"] })));
}

/* ---------- 5 地域連携 ---------- */
function renderLink() {
  rankChart("c-rank-ref", "ref6");
  stack100("c-route", ["家庭から", "他院から転院", "介護・福祉施設から", "その他（院内出生等）"],
    (h) => (h.route && h.route[1] && h.route[1][0] != null ? [h.route[1][0], h.route[1][1], h.route[1][2], (h.route[1][3] || 0) + (h.route[1][4] || 0)] : null));
  stack100("c-dest", ["家庭（当院に通院）", "家庭（他院に通院・その他）", "他院へ転院", "介護・福祉施設", "死亡", "その他"],
    (h) => { const d = h.dest && h.dest[1]; if (!d || d[0] == null) return null;
      return [d[0], (d[1] || 0) + (d[2] || 0), d[3], (d[4] || 0) + (d[5] || 0) + (d[6] || 0) + (d[9] || 0), d[7], d[8]]; });
}

/* ---------- 6 手術・高度医療 ---------- */
function renderAdv() {
  rankChart("c-rank-surg", "surgN");
  rankChart("c-rank-ga", "gaN");
  const self = S.self, b = base(), G = S.G.filter((h) => h.adv && h.adv[0]);
  const keys = [["手術", 1], ["化学療法", 2], ["放射線療法", 3], ["全身麻酔", 6]];
  const den = wsum(G, (h) => h.adv[0]);
  const gv = keys.map(([, i]) => (den ? wsum(G, (h) => h.adv[i]) / den : null));
  const sv = keys.map(([, i]) => (self.adv && self.adv[0] && self.adv[i] != null ? self.adv[i] / self.adv[0] : null));
  chart("c-adv-rate").setOption({
    ...b, grid: { left: 8, right: 30, top: 30, bottom: 24, containLabel: true },
    legend: { top: 0, right: 0, textStyle: { color: css("--text-secondary"), fontSize: 11 }, data: ["自院", "比較対象全体"] },
    tooltip: { ...b.tooltip, trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(127,127,127,0.08)" } },
      formatter: (ps) => `<div style="margin-bottom:2px">${esc(keys[ps[0].dataIndex][0])}ありの割合</div>` + ps.map((p) => tipRow(F.pct(p.value), p.seriesName)).join("") },
    xAxis: ax(b, { type: "category", data: keys.map((k) => k[0]), splitLine: { show: false } }),
    yAxis: ax(b, { type: "value", axisLabel: { ...b.axisCommon.axisLabel, formatter: (v) => Math.round(v * 100) + "%" } }),
    series: [
      { name: "自院", type: "bar", data: sv.map((v) => v ?? 0), barMaxWidth: 22, barGap: "15%", itemStyle: { color: css("--self"), borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: "top", color: css("--text-primary"), fontSize: 11, formatter: (p) => F.pct(sv[p.dataIndex]) } },
      { name: "比較対象全体", type: "bar", data: gv, barMaxWidth: 22, itemStyle: { color: css("--other-strong"), borderRadius: [4, 4, 0, 0] } },
    ],
  }, true);
  setTable("c-adv-rate", ["項目", "自院の件数", "自院の割合", "比較対象全体の割合"],
    keys.map(([k, i], j) => ({ cells: [k, F.int(self.adv ? self.adv[i] : null), F.pct(sv[j]), F.pct(gv[j])] })));
}

/* ---------- 7 質 / 8 薬剤 ---------- */
function renderQual() { rankChart("c-rank-death", "death6"); rankChart("c-rank-readm", "readmU"); }
function renderDrug() { rankChart("c-rank-gen", "gen6"); }

/* ---------- 9 手術別の実績 ---------- */
const sv = (h, ci) => (S.surg && S.surg.byH.get(h.id) ? S.surg.byH.get(h.id).get(ci) || null : null);
const catName = (ci) => { const c = S.surg.cats[ci]; return `${c[2]}｜${c[4]}`; };
const catShort = (ci, n = 34) => { const c = S.surg.cats[ci]; const d = c[2].split(/[、(（]/)[0]; const t = `${d}｜${c[4]}`; return t.length > n ? t.slice(0, n - 1) + "…" : t; };
function surgGroupStats(ci, list) {
  const rows = list.map((h) => [h, sv(h, ci)]).filter(([, v]) => v);
  const T = sum(rows.map(([, v]) => v[0]));
  const losW = sum(rows.filter(([, v]) => v[1] != null).map(([, v]) => v[0] * v[1])), losN = sum(rows.filter(([, v]) => v[1] != null).map(([, v]) => v[0]));
  return { rows, T, los: losN ? losW / losN : null };
}
function surgRankOf(ci, h, list) {
  const v = sv(h, ci); if (!v) return null;
  const vals = list.map((x) => sv(x, ci)).filter(Boolean).map((x) => x[0]);
  return { r: vals.filter((x) => x > v[0]).length + 1, n: vals.length };
}
function renderSurg() {
  const self = S.self, b = base(), mine = S.surg.byH.get(self.id);
  // A 自院の主要な手術
  const top = mine ? [...mine.entries()].sort((a, c) => c[1][0] - a[1][0]).slice(0, 20).map(([ci]) => ci) : [];
  const info = top.map((ci) => { const g = surgGroupStats(ci, S.G), r = surgRankOf(ci, self, S.G); return { ci, n: sv(self, ci)[0], los: sv(self, ci)[1], T: g.T, r }; });
  const elA = document.getElementById("c-surg-top"); elA.style.height = Math.max(200, info.length * 26 + 60) + "px";
  const cA = chart("c-surg-top"); cA.resize();
  cA.setOption({
    ...b, grid: { left: 8, right: 170, top: 10, bottom: 24, containLabel: true },
    tooltip: { ...b.tooltip, trigger: "item", formatter: (p) => { const x = info[p.dataIndex];
      return `<div style="margin-bottom:2px;max-width:420px;white-space:normal">${esc(catName(x.ci))}</div>` + tipRow(F.int(x.n) + "件", "自院の件数") +
        tipRow(F.d1(x.los) + "日", "自院の平均在院日数") + tipRow(`${x.r.r}位 / ${x.r.n}`, "比較対象内の順位") + tipRow(F.pct(x.n / x.T), "比較対象内のシェア") + `<div style="color:${css("--text-muted")};margin-top:4px">クリックで下の比較に表示</div>`; } },
    xAxis: ax(b, { type: "value" }),
    yAxis: ax(b, { type: "category", inverse: true, data: info.map((x) => catShort(x.ci)), splitLine: { show: false },
      axisLabel: { ...b.axisCommon.axisLabel, width: 300, overflow: "truncate" } }),
    series: [{ type: "bar", data: info.map((x) => x.n), barMaxWidth: 14, cursor: "pointer", itemStyle: { color: css("--self"), borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: "right", color: css("--text-secondary"), fontSize: 11,
        formatter: (p) => { const x = info[p.dataIndex]; return `${F.int(x.n)}件（${x.r.r}位/${x.r.n}・${F.pct(x.n / x.T)}）`; } } }],
  }, true);
  cA.off("click"); cA.on("click", (p) => { S.surgCat = info[p.dataIndex].ci; renderSurgPick(); document.querySelector(".surg-pick").scrollIntoView({ behavior: "smooth", block: "start" }); });
  setNote("c-surg-top", info.length ? "括弧内は比較対象内の順位とシェア。" : "自院で件数が公表されている手術区分（10件以上）はありません。");
  setTable("c-surg-top", ["疾患｜手術区分", "件数", "平均在院日数", "比較対象内の順位", "シェア"],
    info.map((x) => ({ cells: [catName(x.ci), F.int(x.n), F.d1(x.los), `${x.r.r} / ${x.r.n}`, F.pct(x.n / x.T)] })));
  // B 選択中の手術（自院の最多区分、なければ比較対象で最多の区分）
  if (S.surgCat == null || S.surgSelf !== self.id) {
    S.surgSelf = self.id;
    if (top.length) S.surgCat = top[0];
    else { const tot = new Map(); S.G.forEach((h) => { const m = S.surg.byH.get(h.id); if (m) m.forEach((v, ci) => tot.set(ci, (tot.get(ci) || 0) + v[0])); });
      S.surgCat = [...tot.entries()].sort((a, c) => c[1] - a[1])[0]?.[0] ?? 0; }
  }
  renderSurgPick();
  // C ヒートマップ
  const cols = top.slice(0, 12);
  const colT = cols.map((ci) => surgGroupStats(ci, S.G).T);
  const others = S.others.map((h) => [h, sum(cols.map((ci) => (sv(h, ci) || [0])[0]))]).filter(([, t]) => t > 0).sort((a, c) => c[1] - a[1]).slice(0, 14).map(([h]) => h);
  const rows = [self].concat(others);
  const data = [];
  rows.forEach((h, y) => cols.forEach((ci, x) => { const v = sv(h, ci); data.push([x, y, v && colT[x] ? v[0] / colT[x] : null, v ? v[0] : null]); }));
  const seq = ["--seq-1", "--seq-2", "--seq-3", "--seq-4", "--seq-5", "--seq-6", "--seq-7"].map(css);
  const elC = document.getElementById("c-surg-heat"); elC.style.height = Math.max(240, rows.length * 28 + 260) + "px";
  const cC = chart("c-surg-heat"); cC.resize();
  cC.setOption({
    ...b, grid: { left: 8, right: 20, top: 10, bottom: 50, containLabel: true },
    tooltip: { ...b.tooltip, trigger: "item", formatter: (p) => `<div style="margin-bottom:2px">${esc(rows[p.data[1]].name)}</div>` +
      `<div style="color:${css("--text-secondary")};max-width:420px;white-space:normal">${esc(catName(cols[p.data[0]]))}</div>` +
      tipRow(p.data[3] == null ? "–（10件未満または実績なし）" : F.int(p.data[3]) + "件", "件数") + tipRow(F.pct(p.data[2]), "比較対象内のシェア") },
    xAxis: ax(b, { type: "category", data: cols.map((ci) => catShort(ci, 18)), splitLine: { show: false }, axisLine: { show: false },
      axisLabel: { ...b.axisCommon.axisLabel, rotate: 50, interval: 0 } }),
    yAxis: ax(b, { type: "category", inverse: true, data: rows.map((h) => (h === self ? "自院：" : "") + h.short), splitLine: { show: false }, axisLine: { show: false },
      axisLabel: { ...b.axisCommon.axisLabel, interval: 0, width: 180, overflow: "truncate", formatter: (v, i) => (i === 0 ? `{s|${v}}` : v), rich: { s: { color: css("--text-primary"), fontWeight: 700, fontSize: 11 } } } }),
    visualMap: { type: "continuous", dimension: 2, min: 0, max: heatMax(data), orient: "horizontal", left: "center", bottom: 4, inRange: { color: seq },
      text: ["シェア高", "低"], textStyle: { color: css("--text-secondary"), fontSize: 11 }, itemHeight: 160, itemWidth: 10, formatter: (v) => F.pct(v) },
    series: [{ type: "heatmap", data, itemStyle: { borderColor: css("--surface-1"), borderWidth: 2, borderRadius: 3 } }],
  }, true);
  setNote("c-surg-heat", cols.length ? "空白は10件未満（秘匿）または実績なし。" : "自院の主要な手術がないため表示できません。");
  setTable("c-surg-heat", ["病院"].concat(cols.map(catName)), rows.map((h) => ({ self: h === self, cells: [h.name].concat(cols.map((ci) => F.int((sv(h, ci) || [null])[0]))) })));
}
function renderSurgPick() {
  const ci = S.surgCat, self = S.self, c = S.surg.cats[ci];
  $("#sq").value = catName(ci);
  const g = surgGroupStats(ci, S.G), nat = surgGroupStats(ci, S.H), me = sv(self, ci), r = surgRankOf(ci, self, S.G);
  const box = $("#surg-info"); box.textContent = "";
  const add = (t, bold) => { const e = document.createElement(bold ? "b" : "span"); e.textContent = t; box.appendChild(e); };
  add("自院 "); add(me ? `${F.int(me[0])}件` : "–（10件未満または実績なし）", true);
  if (me) { add(`・平均在院日数 `); add(`${F.d1(me[1])}日`, true); add(`（${r.r}位 / ${r.n}施設、シェア${F.pct(me[0] / g.T)}）`); }
  add(`　比較対象全体 ${F.int(g.T)}件・平均在院日数 ${F.d1(g.los)}日　全国 ${F.int(nat.T)}件・${F.d1(nat.los)}日`);
  $("#surg-k").textContent = `${c[0]}　手技：${c[6] || "–"}　Kコード：${c[5] || "–"}`;
  const mN = { label: "件数", unit: "件", fmt: F.int, get: (h) => (sv(h, ci) || [null])[0] };
  const mL = { label: "平均在院日数", unit: "日", fmt: F.d1, get: (h) => (sv(h, ci) || [null, null])[1], low: true };
  rankChart("c-surg-rank", mN);
  scatter("c-surg-sc", mN, mL, { refY: g.los, refYLabel: `比較対象全体 ${F.d1(g.los)}日` });
  const n = document.getElementById("c-surg-sc").parentElement.querySelector(".cnote");
  if (n && !n.textContent) { n.textContent = "横線は比較対象全体の平均在院日数（件数で重み付け）。"; n.hidden = false; }
  refreshOpenTables();
}
function initSurgSearch() {
  const q = $("#sq"), list = $("#sq-list"); let hits = [], act = -1;
  const norm = (s) => s.normalize("NFKC").replace(/[\s　・、]/g, "").toLowerCase();
  const idx = S.surg.cats.map((c) => norm(c.join(" ")));
  const close = () => { list.hidden = true; q.setAttribute("aria-expanded", "false"); };
  const draw = () => { list.textContent = "";
    hits.forEach((ci, i) => { const li = document.createElement("li"); li.setAttribute("role", "option"); li.setAttribute("aria-selected", String(i === act));
      const a = document.createElement("span"); a.textContent = catName(ci); const m = document.createElement("span"); m.className = "m";
      const me = S.self ? sv(S.self, ci) : null; m.textContent = me ? `自院${F.int(me[0])}件` : ""; li.append(a, m);
      li.addEventListener("mousedown", (e) => { e.preventDefault(); pick(ci); }); list.appendChild(li); });
    list.hidden = !hits.length; q.setAttribute("aria-expanded", String(!!hits.length)); };
  const pick = (ci) => { S.surgCat = ci; close(); q.blur(); renderSurgPick(); };
  q.addEventListener("focus", () => q.select());
  q.addEventListener("input", () => {
    const terms = q.value.split(/[\s　]+/).map(norm).filter(Boolean);
    if (!terms.length) { hits = []; close(); return; }
    const selfMap = S.self ? S.surg.byH.get(S.self.id) : null;
    hits = idx.map((t, ci) => [ci, t]).filter(([, t]) => terms.every((w) => t.includes(w))).map(([ci]) => ci)
      .sort((a, c) => ((selfMap?.get(c) || [0])[0] - (selfMap?.get(a) || [0])[0])).slice(0, 40);
    act = hits.length ? 0 : -1; draw();
  });
  q.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") { act = Math.min(hits.length - 1, act + 1); draw(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { act = Math.max(0, act - 1); draw(); e.preventDefault(); }
    else if (e.key === "Enter" && act >= 0) { pick(hits[act]); e.preventDefault(); }
    else if (e.key === "Escape") close();
  });
  q.addEventListener("blur", () => setTimeout(() => { close(); if (S.surgCat != null) q.value = catName(S.surgCat); }, 120));
}

/* ---------- 比較表 ---------- */
const TCOLS = [["病院", (h) => h.name, "t"], ["種別", (h) => h.type, "t"], ["法人", (h) => h.corp || "法人不明", "t"], ["病床", (h) => h.b_total, F.int],
  ["退院患者数", M.n6.get, F.int], ["前年度", M.n6.prev, F.int], ["平均在院日数", M.los6.get, F.d1], ["在院日数の指標", M.eff6.get, F.d2], ["患者構成の指標", M.cmi6.get, F.d2],
  ["救急車（月）", M.ambm6.get, F.d1], ["救急医療入院（月）", M.emgm6.get, F.d1], ["紹介率", M.ref6.get, F.pct], ["手術件数", M.surgN.get, F.int], ["手術率", M.surgR.get, F.pct],
  ["全身麻酔件数", M.gaN.get, F.int], ["化学療法件数", M.chemoN.get, F.int], ["放射線療法件数", M.radN.get, F.int], ["家庭への退院率", M.home6.get, F.pct],
  ["死亡退院率", M.death6.get, F.pct], ["計画外再入院率", M.readmU.get, F.pct], ["24時間以内死亡※", (h) => (h.d24 ? h.d24[0] : null), F.int], ["後発医薬品", M.gen6.get, F.pct]];
let sortState = { col: 4, dir: -1 };
function renderTable() {
  const tb = $("#cmp"); tb.textContent = "";
  const thead = document.createElement("thead"), tr = document.createElement("tr");
  TCOLS.forEach(([lab, , f], i) => { const th = document.createElement("th"); th.textContent = lab; if (f === "t") th.className = "t";
    th.tabIndex = 0; if (sortState.col === i) th.setAttribute("aria-sort", sortState.dir < 0 ? "descending" : "ascending");
    const go = () => { sortState = { col: i, dir: sortState.col === i ? -sortState.dir : -1 }; renderTable(); };
    th.addEventListener("click", go); th.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }); tr.appendChild(th); });
  thead.appendChild(tr); tb.appendChild(thead);
  const g = TCOLS[sortState.col][1];
  const rows = S.G.slice().sort((a, c) => { const x = g(a), y = g(c); if (x == null) return 1; if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y, "ja") : x - y) * sortState.dir; });
  const body = document.createElement("tbody");
  rows.forEach((h) => { const r = document.createElement("tr"); if (h === S.self) r.className = "self";
    TCOLS.forEach(([, get, f]) => { const td = document.createElement("td"); const v = get(h); td.textContent = f === "t" ? v ?? "" : f(v); if (f === "t") td.className = "t"; r.appendChild(td); });
    body.appendChild(r); });
  tb.appendChild(body);
}
function downloadCsv() {
  const lines = [TCOLS.map((c) => c[0]).join(",")].concat(S.G.map((h) => TCOLS.map(([, get, f]) => { const v = get(h); const s = f === "t" ? v ?? "" : v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")));
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = `比較表_${S.self.short}_${S.axis === "area" ? "医療圏" : "法人"}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

/* ---------- 全体の描画 ---------- */
function renderAll() {
  if (!S.self) return;
  computeGroup();
  const h = S.self;
  $("#empty").hidden = true; $("#main").hidden = false;
  $("#self-name").textContent = h.name;
  const typeLabel = { DPC: "DPC参加病院", 準備: "DPC準備病院", 出来高: "出来高算定病院" }[h.type] || h.type;
  $("#self-meta").textContent = `${h.pref}・二次医療圏「${h.area ? h.area.split("|")[1] : "–"}」／${typeLabel}／病床${F.int(h.b_total)}床（DPC算定${F.int(h.b_dpc)}床）／${h.kihon || "入院基本料 –"}／法人：${h.corp || "法人不明"}`;
  const chip = $("#group-chip"); chip.textContent = "";
  const t1 = document.createElement("div"); t1.innerHTML = `比較対象：<b>${esc(groupLabel())}</b>　自院を含む${S.G.length}施設`;
  chip.appendChild(t1);
  if (S.axis === "corp" && !h.corp_key) { const w = document.createElement("div"); w.className = "warn"; w.textContent = "この病院は開設者を照合できなかったため、法人内の比較はできません。"; chip.appendChild(w); }
  else if (S.G.length === 1) { const w = document.createElement("div"); w.className = "warn"; w.textContent = "条件に合う比較対象の他院がありません。比較対象の範囲を広げると表示される場合があります。"; chip.appendChild(w); }
  if (S.axis === "corp") { const n = document.createElement("div"); n.className = "warn small"; n.textContent = "法人は令和8年10月時点の開設者です。"; chip.appendChild(n); }
  renderSummary(); renderScale(); renderMdc(); renderEff(); renderEmg(); renderLink(); renderAdv(); renderQual(); renderDrug(); renderTable();
  renderMdcDependent();
  if (S.surg) renderSurg();
  refreshOpenTables();
  const u = new URL(location.href); u.searchParams.set("h", h.id); u.searchParams.set("axis", S.axis); u.searchParams.set("scope", S.scope);
  history.replaceState(null, "", u);
}
function renderMdcDependent() { if (!S.self) return; renderMdcEff(); renderMdcEmg(); refreshOpenTables(); }

/* ---------- 病院検索 ---------- */
function initSearch() {
  const q = $("#q"), list = $("#q-list"); let hits = [], act = -1;
  const norm = (s) => s.normalize("NFKC").replace(/[\s　・]/g, "").toLowerCase();
  S.H.forEach((h) => (h._q = norm(h.name + h.pref + (h.area || "") + (h.corp || ""))));
  const close = () => { list.hidden = true; q.setAttribute("aria-expanded", "false"); act = -1; };
  const draw = () => {
    list.textContent = "";
    hits.forEach((h, i) => { const li = document.createElement("li"); li.setAttribute("role", "option"); li.setAttribute("aria-selected", String(i === act));
      const a = document.createElement("span"); a.textContent = h.name; const m = document.createElement("span"); m.className = "m";
      m.textContent = `${h.pref}・${h.area ? h.area.split("|")[1] : ""}・${h.type}`; li.append(a, m);
      li.addEventListener("mousedown", (e) => { e.preventDefault(); pick(h); }); list.appendChild(li); });
    list.hidden = !hits.length; q.setAttribute("aria-expanded", String(!!hits.length));
  };
  const pick = (h) => { S.self = h; q.value = h.name; close(); renderAll(); };
  q.addEventListener("input", () => {
    const terms = norm(q.value).split(/\s+/).filter(Boolean);
    if (!q.value.trim()) { hits = []; close(); return; }
    const t = norm(q.value);
    hits = S.H.filter((h) => h._q.includes(t)).sort((a, c) => (a.type === "出来高") - (c.type === "出来高") || (c.n6 || 0) - (a.n6 || 0)).slice(0, 30);
    act = hits.length ? 0 : -1; draw();
  });
  q.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") { act = Math.min(hits.length - 1, act + 1); draw(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { act = Math.max(0, act - 1); draw(); e.preventDefault(); }
    else if (e.key === "Enter" && act >= 0) { pick(hits[act]); e.preventDefault(); }
    else if (e.key === "Escape") close();
  });
  q.addEventListener("blur", () => setTimeout(close, 100));
}
function initControls() {
  document.querySelectorAll("[data-axis]").forEach((b) => b.addEventListener("click", () => { S.axis = b.dataset.axis; syncSeg(); renderAll(); }));
  document.querySelectorAll("[data-scope]").forEach((b) => b.addEventListener("click", () => { S.scope = b.dataset.scope; syncSeg(); renderAll(); }));
  $("#dl").addEventListener("click", downloadCsv);
  const modes = ["auto", "light", "dark"], labels = { auto: "表示：自動", light: "表示：ライト", dark: "表示：ダーク" };
  let mode = "auto";
  try { mode = localStorage.getItem("theme") || "auto"; } catch (e) {}
  const apply = () => { if (mode === "auto") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", mode); $("#theme").textContent = labels[mode]; };
  apply();
  $("#theme").addEventListener("click", () => { mode = modes[(modes.indexOf(mode) + 1) % 3]; try { localStorage.setItem("theme", mode); } catch (e) {} apply(); renderAll(); });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => renderAll());
  window.addEventListener("resize", () => Object.values(S.charts).forEach((c) => c.resize()));
}
function syncSeg() {
  document.querySelectorAll("[data-axis]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.axis === S.axis)));
  document.querySelectorAll("[data-scope]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.scope === S.scope)));
}

(async function main() {
  initControls(); initTableButtons();
  try { await load(); } catch (e) { $("#empty").textContent = "データの読み込みに失敗しました。ページを再読み込みしてください。"; throw e; }
  initSearch();
  const p = new URLSearchParams(location.search);
  if (p.get("axis") === "corp") S.axis = "corp";
  if (p.get("scope") === "all") S.scope = "all";
  syncSeg();
  if (p.get("h") && S.byId.get(p.get("h"))) { S.self = S.byId.get(p.get("h")); $("#q").value = S.self.name; renderAll(); }
})();
