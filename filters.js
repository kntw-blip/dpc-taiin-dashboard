"use strict";
/* スマホ表示（幅720px以下）で、上部に固定された条件欄を折りたたむ
   - 自院を選んだあと、下にスクロールすると1行の要約（病院名・比較軸・比較対象）に自動で縮む
   - 要約をタップすると開く。開いたあとは「条件を閉じる」か、さらに下へスクロールすると縮む
   - ページの一番上に戻ると開く
   - 検索欄の入力中・ガイドツアー中は縮めない */
(function () {
  const bar = document.getElementById("filters"), openBtn = document.getElementById("f-mini-open"), closeBtn = document.getElementById("f-close");
  const mq = window.matchMedia("(max-width: 720px)");
  const AUTO_AT = 80, AGAIN = 160;   // 縮み始める位置／手動で開いたあと、さらにこれだけ下にスクロールすると縮む
  let collapsed = false, openedAt = null, hold = false, ticking = false;

  const S = () => (window.DPCApp ? window.DPCApp.S : null);
  const hasSelf = () => !!(S() && S().self);
  const busy = () => hold || document.activeElement === document.getElementById("q") || !document.getElementById("q-list").hidden;

  function set(c) {
    if (c === collapsed) return;
    // 条件欄はページの先頭にあるため、高さが変わると本文がずれる → スクロール位置で補正して、見ている内容を動かさない
    const h0 = bar.offsetHeight, y = window.scrollY;
    collapsed = c;
    bar.classList.toggle("collapsed", c);
    openBtn.setAttribute("aria-expanded", String(!c));
    const dh = bar.offsetHeight - h0;
    if (y > 0 && dh) window.scrollTo(0, Math.max(0, y + dh));
  }
  function onScroll() {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      if (!mq.matches || !hasSelf()) { set(false); return; }
      const y = window.scrollY;
      if (y <= 8) { openedAt = null; set(false); return; }
      if (busy() || collapsed) return;
      if (openedAt != null) { if (y > openedAt + AGAIN) { openedAt = null; set(true); } return; }
      if (y > AUTO_AT) set(true);
    });
  }
  function update() {
    const s = S(); if (!s || !s.self) { bar.classList.remove("has-self"); return; }
    bar.classList.add("has-self");
    document.getElementById("f-mini-name").textContent = s.self.short || s.self.name;
    const ax = s.axis === "area" ? `二次医療圏「${s.self.area ? s.self.area.split("|")[1] : "–"}」`
      : s.axis === "corp" ? "法人" : `類似病院${s.peerN}施設（${{ all: "全国", reg: "同じ地方", pref: "同じ都道府県" }[s.region]}）`;
    document.getElementById("f-mini-cond").textContent = `${ax}｜${s.scope === "all" ? "出来高算定病院も含む" : "DPC・準備病院"}`;
    onScroll();
  }
  openBtn.addEventListener("click", () => { set(false); openedAt = window.scrollY; });
  closeBtn.addEventListener("click", () => { openedAt = null; set(true); });
  window.addEventListener("scroll", onScroll, { passive: true });
  mq.addEventListener("change", onScroll);
  window.DPCFilters = {
    update,
    expand() { set(false); openedAt = window.scrollY; },
    hold(on) { hold = !!on; if (on) set(false); },   // ガイドツアー中は開いたままにする
    get collapsed() { return collapsed; },
  };
})();
