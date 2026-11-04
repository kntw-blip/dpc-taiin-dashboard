"""参考資料3 (4) FIMの入力状況・(6) 重症度等の入力状況 → sev.json
usage: python build_sev.py RAW_DIR OUT_DIR
公表値は「入力対象割合（入院患者に占める割合）」と、対象患者の点数帯・分類ごとの割合。
おおよその対象患者数は 入力対象割合 × 一般病棟に入院があったデータ数（参考資料1 (1)）で推計する（誤差は数%程度）。
出力 sev.json:
  den:   {告示番号: 一般病棟に入院があったデータ数}
  fim:   {cols: [...], h: {告示番号: [値...]}}
  items: [{key, group, title, cols, targets, dist, kpi:{label, idx}, quality, note, h: {告示番号: [値...]}}]
"""
import json, re, sys, glob, pathlib, unicodedata
from python_calamine import CalamineWorkbook

RAW, OUT = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
nk = lambda s: unicodedata.normalize("NFKC", str(s if s is not None else "")).replace("\n", "").strip()

def num(v, nd=6):
    if isinstance(v, (int, float)): return round(float(v), nd)
    try: return round(float(nk(v)), nd)
    except ValueError: return None

def book(key):
    fs = [f for f in glob.glob(str(RAW / "dpc" / "*.xlsx")) if key in f]
    if len(fs) != 1: raise RuntimeError(f"{key}: {fs}")
    return CalamineWorkbook.from_path(fs[0])

def data_rows(rows): return [r for r in rows if re.fullmatch(r"\d{5}", nk(r[0]))]

# 分母：一般病棟に入院があったデータ数
den = {}
for r in data_rows(book("１_分析対象外としたデータの状況").get_sheet_by_name("分析対象外").to_python(skip_empty_area=False)):
    v = num(r[5], 0)
    if v: den[nk(r[0])] = int(v)

# FIM
wb = book("参考資料３__４_FIM"); rows = wb.get_sheet_by_name(wb.sheet_names[0]).to_python(skip_empty_area=False)
FIM_COLS = ["回復期リハ等の病床数", "FIM入力対象割合", "平均年齢", "手術ありの割合",
            "入棟時 運動13〜26点", "入棟時 運動27〜52点", "入棟時 運動53〜91点", "入棟時 認知5〜10点", "入棟時 認知11〜20点", "入棟時 認知21〜35点", "入棟時 不明",
            "退棟時 運動13〜26点", "退棟時 運動27〜52点", "退棟時 運動53〜91点", "退棟時 認知5〜10点", "退棟時 認知11〜20点", "退棟時 認知21〜35点", "退棟時 不明", "死亡"]
fim = {}
for r in data_rows(rows):
    v = [num(x) for x in r[3:22]]
    if v[1]: fim[nk(r[0])] = v

# 重症度等（16項目）：(シート名, 区分, 表示名, 構成比か, 代表指標の名前, 代表指標の列（値の並びでの位置）, 入力精度の指標か, 列の表示名)
MRS = ["0：症状なし", "1：障害なし", "2：軽度の障害", "3：中等度の障害", "4：中等度〜重度の障害", "5：重度の障害"]
SPEC = [
    ("発症前_Rankin_Scale", "脳卒中", "発症前のRankin Scale", True, "発症前mRS 0〜1（病前に自立）の割合", [1, 2], False, None, MRS + ["9：不明"]),
    ("脳卒中の発症時期", "脳卒中", "脳卒中の発症時期", True, "発症3日目以内の割合", [1], False, None, None),
    ("退院時_modified_Rankin_Scale", "脳卒中", "退院時のmodified Rankin Scale", True, "退院時mRS 0〜2（自立）の割合", [1, 2, 3], False,
     "患者構成（発症前の状態・発症時期）の調整をしていない値です。", MRS + ["6：死亡", "9：不明"]),
    ("Hugh-Jones分類", "呼吸器", "Hugh-Jones分類（呼吸困難の程度）", True, "Hugh-Jones 4〜5（重度）の割合", [4, 5], False, None,
     ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "0：不明", "6歳未満の小児"]),
    ("肺炎患者_重症度", "呼吸器", "肺炎患者の重症度", False, "肺炎重症度規定因子該当者の割合", None, False,
     "各項目は独立した割合です（合計は100%になりません）。", None),
    ("救急医療入院患者_PF比", "呼吸器", "救急医療入院患者のP/F比", False, "救急受診時のP/F比不明の割合", [1], True,
     "公表値は入力対象の割合と「不明」の割合のみで、データの入力精度を表します。", None),
    ("救急受診時等のNYHA心機能分類", "循環器", "NYHA心機能分類（救急受診時等）", False, "救急受診時の分類不能の割合", [1], True,
     "公表値は入力対象の割合と「分類不能」の割合のみで、データの入力精度を表します。", None),
    ("CCS分類", "循環器", "CCS分類（狭心症の重症度）", True, "Class Ⅲ〜Ⅳの割合", [3, 4], False, None, None),
    ("Killip分類", "循環器", "Killip分類（急性心筋梗塞の心不全の程度）", True, "Class 3〜4の割合", [3, 4], False, None, None),
    ("収縮期血圧", "循環器", "収縮期血圧（心不全等）", False, "救急受診時 100mmHg未満の割合", [1], False,
     "救急受診時と、治療室・病棟入室時のそれぞれの分布です。", None),
    ("急性心筋梗塞の発症時期", "循環器", "急性心筋梗塞の発症時期", True, "発症24時間以内の割合", [1], False, None, None),
    ("Stanford_AB型", "循環器", "大動脈解離のStanford分類", True, "A型の割合", [1], False, None, None),
    ("肝硬変のChild-Pugh分類", "消化器", "肝硬変のChild-Pugh分類", True, "Grade C（重度）の割合", [3], False, None, None),
    ("急性膵炎の重症度分類", "消化器", "急性膵炎の重症度分類", False, "重症の割合", [1], False, "各項目は独立した割合です。", None),
    ("分娩時出血量", "産科", "分娩時出血量", False, "出血量不明の割合", [1], True,
     "公表値は入力対象の割合と「不明」の割合のみで、データの入力精度を表します。", None),
    ("BurnIndex", "外傷", "熱傷のBurn Index", True, "Burn Index 21以上の割合", [3, 4, 5, 6], False, None, None),
]
wb = book("参考資料３__６_重症度")
items = []
for sheet, group, title, dist, kpi_label, kpi_idx, quality, note, labels in SPEC:
    rows = wb.get_sheet_by_name(sheet).to_python(skip_empty_area=False)
    hdr = [r for r in rows[:4] if not re.fullmatch(r"\d{5}", nk(r[0]))]
    ncol = max(len(r) for r in hdr)
    cols = []
    for j in range(3, ncol):
        a = nk(hdr[0][j]) if j < len(hdr[0]) else ""
        b = nk(hdr[1][j]) if len(hdr) > 1 and j < len(hdr[1]) else ""
        if not a and cols: a = cols[-1].split("｜")[0]
        cols.append(f"{a}｜{b}" if b else a)
    targets = [i for i, c in enumerate(cols) if "入力対象" in c]
    if labels:  # 構成比の分類名をわかりやすく
        for i, lab in zip([i for i in range(len(cols)) if i not in targets], labels): cols[i] = lab
    if sheet == "肺炎患者_重症度":
        kpi_idx = [i for i, c in enumerate(cols) if "規定因子" in c]
        cols = [("SpO2≦90%（FiO2 35%以下で維持）の割合" if "要さない" in c else "SpO2≦90%（維持にFiO2 35%超が必要）の割合" if "SpO2について" in c else c) for c in cols]
    h = {}
    for r in data_rows(rows):
        v = [num(x) for x in r[3:3 + len(cols)]]
        if v[0]: h[nk(r[0])] = v
    items.append({"key": sheet, "group": group, "title": title, "cols": cols, "targets": targets, "dist": dist,
                  "kpi": {"label": kpi_label, "idx": kpi_idx}, "quality": quality, "note": note or "", "h": h})
    print(f"{sheet}: cols {len(cols)}, targets {targets}, hospitals {len(h)}")

OUT.mkdir(parents=True, exist_ok=True)
p = OUT / "sev.json"
p.write_text(json.dumps({"den": den, "fim": {"cols": FIM_COLS, "h": fim}, "items": items}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"sev.json: den {len(den)}, fim {len(fim)}, items {len(items)}, {p.stat().st_size/1e6:.2f} MB")
