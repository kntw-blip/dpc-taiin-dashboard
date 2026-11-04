"""参考資料2 (7) 疾患別手術別集計（MDC別）→ surg.json
usage: python build_surg.py RAW_DIR OUT_DIR
  RAW_DIR/dpc_surg/surg_MDCxx__*.xlsx : 病院 × (DPC6桁疾患 × 手術区分[9〜10桁]) の件数・平均在院日数（令和6年度）
  RAW_DIR/dpc_table/*.xlsx            : DPC電子点数表（「６）手術」シートで手術区分 → Kコード・手術名）
出力 surg.json:
  cats: [[key, 疾患コード, 疾患名, 手術区分, 手術名ラベル, Kコード(空白区切り), 手技名の一覧], ...]
  h:    {告示番号: [[cat_index, 件数, 平均在院日数], ...]}   … 10件未満（秘匿）は含まない
"""
import json, re, sys, glob, pathlib, collections, unicodedata
from python_calamine import CalamineWorkbook

RAW, OUT = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
nk = lambda s: unicodedata.normalize("NFKC", str(s if s is not None else "")).strip()

def num(v):
    if isinstance(v, (int, float)): return float(v)
    try: return float(nk(v).replace(",", ""))
    except ValueError: return None

# ---------- 手術区分 → 手術名（電子点数表） ----------
tbl = glob.glob(str(RAW / "dpc_table" / "*.xlsx"))[0]
wb = CalamineWorkbook.from_path(tbl)
sh = next(s for s in wb.sheet_names if "手術" in s and "処置" not in s and "出来高" not in s and "重症" not in s)
names = collections.defaultdict(list)   # (疾患6桁, 対応コード) → [(手術1の名称, Kコード, [手術2以降の名称])]
for r in wb.get_sheet_by_name(sh).to_python(skip_empty_area=False)[2:]:
    mdc, bun, corr = nk(r[0]), nk(r[1]), nk(r[5])
    if not (re.fullmatch(r"\d{2}", mdc) and re.fullmatch(r"[0-9x]{4}", bun) and corr): continue
    corr = corr.split(".")[0].zfill(2)
    nm, k = nk(r[6]), nk(r[7])
    if k.startswith("KKK"): continue
    adds = [nk(r[c]) for c in (8, 10, 12, 14) if c < len(r) and nk(r[c])]
    names[(mdc + bun, corr)].append((nm, k, adds))

base_of = lambda nm: re.split(r"\s", nm)[0]

def label(d, code):
    """手術区分の表示名: 主たる手術の手技名（最大3つ）＋共通の加算等"""
    lst = names.get((d, code), [])
    if code == "97":
        # 97 は「定義表にない手術」に加え、点数表で97に割り当てられた手術を含む（例：白内障の水晶体再建術）
        base = []
        for nm, _, _ in lst:
            b = base_of(nm)
            if b and b not in base: base.append(b)
        return "その他の手術" + (f"（{'、'.join(base[:2])}{' 等' if len(base) > 2 else ''}を含む）" if base else "")
    base, adds = [], []
    for nm, _, ad in lst:
        b = base_of(nm)
        if b and b not in base: base.append(b)
        for a in ad:
            a = base_of(a)
            if a and a not in adds: adds.append(a)
    if not base: return f"手術区分{code}"
    s = "、".join(base[:3]) + (f" 等{len(base)}種" if len(base) > 3 else "")
    if adds: s += "＋" + "・".join(adds[:2]) + (" 等" if len(adds) > 2 else "")
    return s

def detail(d, code):
    """検索・ツールチップ用：手技名の一覧とKコードの一覧"""
    lst = names.get((d, code), [])
    nm, ks = [], []
    for n, k, _ in lst:
        if base_of(n) not in nm: nm.append(base_of(n))
        if k and k not in ks: ks.append(k)
    return "、".join(nm), " ".join(ks)

# ---------- 病院別の件数・在院日数 ----------
cats, cidx, H = [], {}, collections.defaultdict(list)
stats = collections.Counter()
for f in sorted(glob.glob(str(RAW / "dpc_surg" / "surg_MDC*.xlsx"))):
    wb = CalamineWorkbook.from_path(f)
    rows = wb.get_sheet_by_name(wb.sheet_names[0]).to_python(skip_empty_area=False)
    h0, h1, h2, h3 = rows[0], rows[1], rows[2], rows[3]
    cnt, los = {}, {}   # (疾患, 区分) → 列番号
    d = dn = kind = None
    for j in range(3, len(h3)):
        if nk(h0[j]): d, dn = nk(h0[j]), nk(h1[j])
        if nk(h2[j]): kind = nk(h2[j])
        code = nk(h3[j]).split(".")[0]
        if not code or code == "99" or "再掲" in code: continue
        code = code.zfill(2)
        (cnt if kind == "件数" else los)[(d, code)] = j
        if (d, code) not in cidx and kind == "件数":
            cidx[(d, code)] = len(cats)
            nm_all, ks = detail(d, code)
            cats.append([f"{d}-{code}", d, dn, code, label(d, code), ks, nm_all])
            if label(d, code).startswith("手術区分"): stats["no_label"] += 1
    for r in rows[4:]:
        k = nk(r[0])
        if not re.fullmatch(r"\d{5}", k): continue
        for key, j in cnt.items():
            n = num(r[j])
            if n is None: continue
            l = num(r[los[key]]) if key in los else None
            H[k].append([cidx[key], int(n), round(l, 2) if l is not None else None])
            stats["cells"] += 1

OUT.mkdir(parents=True, exist_ok=True)
p = OUT / "surg.json"
p.write_text(json.dumps({"cats": cats, "h": H}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"surg.json: cats {len(cats)}, hospitals {len(H)}, cells {stats['cells']}, no_label {stats['no_label']}, {p.stat().st_size/1e6:.2f} MB")
