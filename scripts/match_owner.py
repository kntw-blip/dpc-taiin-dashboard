"""DPC退院患者調査の施設 ↔ 地方厚生局一覧表の病院 を照合し、開設者（法人）を付与する。
usage: python match_owner.py SHISETSU_XLSX KOUSEI_CSV A38_DBF OUT_CSV
照合: 同一都道府県内で 名称類似度 + 所在市区町村の一致 + 病床数の近さ を総合して最良候補を採用。
出力列: kokuji, name, pref, muni, beds, k_code, k_name, k_address, k_beds, owner, corp, score, conf
"""
import csv, re, sys, unicodedata, difflib, collections
from python_calamine import CalamineWorkbook
from dbfread import DBF

def nk(s): return unicodedata.normalize("NFKC", str(s or "")).strip()

CORP_HEAD = re.compile(
    r"^(地方独立行政法人|独立行政法人|国立研究開発法人|国立大学法人|公立大学法人|学校法人|社会医療法人財団|社会医療法人社団|社会医療法人|"
    r"特定医療法人財団|特定医療法人社団|特定医療法人|医療法人財団|医療法人社団|医療法人|社会福祉法人|一般社団法人|一般財団法人|公益社団法人|"
    r"公益財団法人|宗教法人|医療生活協同組合|生活協同組合|株式会社|有限会社|恩賜財団|社会福祉法人恩賜財団)")

def norm(s):
    s = nk(s)
    s = s.replace("ヶ", "ケ").replace("ケ", "ケ").replace("髙", "高").replace("﨑", "崎").replace("邉", "辺").replace("邊", "辺").replace("齋", "斎").replace("齊", "斉")
    s = re.sub(r"[\s・･\-‐－—()（）「」『』〔〕\[\]【】.,、。]", "", s)
    return s

def core(s):
    """法人名の接頭部を除いた施設名の中核部分"""
    orig = s
    s = norm(s)
    for _ in range(3):
        m = CORP_HEAD.match(s)
        if not m: break
        rest = s[m.end():]
        # 法人名（〜会/〜団/〜機構/〜大学 等）を1つ取り除く。ただし残りが短すぎる場合は取り除かない
        m2 = re.match(r"^(.{1,20}?(会|団|機構|大学|学園|学院|センター|財団|協会|組合))", rest)
        if m2 and len(rest) - m2.end() >= 2: rest = rest[m2.end():]
        s = rest
    if len(s) <= 3 or s in ("病院", "総合病院", "中央病院", "記念病院"):
        return norm(orig)
    return s

TITLE = re.compile(r"(広域連合長|連合長|企業長|病院事業管理者|管理者|理事長|代表理事|代表取締役|取締役社長|社長|会長|学長|総長|総裁|機構長|組合長|院長|代表者|代表|執行役|知事|市長|町長|村長|区長)")

NATIONWIDE = [  # 全国で1法人（支部長名などで代表者が変わるもの）
    (re.compile(r"済生会"), "社会福祉法人恩賜財団済生会"),
    (re.compile(r"日本赤十字社"), "日本赤十字社"),
]

def corp_of(owner):
    """開設者欄 → (法人名, 代表者名)。代表者の職名・氏名を除いた団体名を返す"""
    o = re.sub(r"\s+", " ", nk(owner)).strip()
    for pat, nm in NATIONWIDE:
        if pat.search(o): return nm, ""
    m = TITLE.search(o)
    if not m: return norm(o), ""
    t, rep = m.group(1), norm(o[m.end():])
    if t in ("知事", "市長", "町長", "村長", "区長"):
        # 「富山県知事」「浜松市長」「○○町 町長」→ 自治体名
        before = o[:m.start()]
        tok = before.split(" ")[-1] if before and not before.endswith(" ") else ""
        if not tok:
            toks = before.strip().split(" ")
            tok = toks[-1] if toks and toks[-1] else ""
            unit = ""
        else:
            unit = {"知事": "", "市長": "市", "町長": "町", "村長": "村", "区長": "区"}[t]
        name = tok + unit
        if name.endswith(unit * 2) and unit: name = name[:-1]
        return norm(name), rep
    return (norm(o[:m.start()]) or norm(o)), rep

def load_dpc(path):
    rows = CalamineWorkbook.from_path(path).get_sheet_by_name("施設概要表").to_python(skip_empty_area=False)
    out = []
    for r in rows[1:]:
        k = nk(r[0])
        if not re.fullmatch(r"\d{5}", k): continue
        out.append({"kokuji": k, "tsuban": nk(r[1]), "muni": nk(r[2]).zfill(5), "pref": nk(r[3]), "name": nk(r[4]),
                    "beds": float(r[15]) if isinstance(r[15], (int, float)) else 0.0})
    return out

def main(shisetsu, kousei_csv, a38, out):
    dpc = load_dpc(shisetsu)
    kh = list(csv.DictReader(open(kousei_csv, encoding="utf-8")))
    muni_name = {}
    for r in DBF(a38, encoding="cp932"): muni_name[r["A38a_001"]] = r["A38a_002"]
    ALIAS = {"40305": "40231", "04423": "04216", "22138": "22131", "22139": "22135", "22140": "22137"}
    by_pref = collections.defaultdict(list)
    for h in kh:
        h["_n"], h["_c"] = norm(h["name"]), core(h["name"]); by_pref[h["pref"]].append(h)
    res = []
    for d in dpc:
        dn, dc = norm(d["name"]), core(d["name"])
        mn = muni_name.get(ALIAS.get(d["muni"], d["muni"]), "")
        best = None
        for h in by_pref.get(d["pref"], []):
            if dn == h["_n"]: ns = 1.0
            elif dc and dc == h["_c"]: ns = 0.97
            elif (len(dc) >= 4 and h["_n"].endswith(dc)) or (len(h["_c"]) >= 4 and dn.endswith(h["_c"])): ns = 0.93
            else: ns = difflib.SequenceMatcher(None, dc, h["_c"]).ratio()
            if ns < 0.5: continue
            mh = 1.0 if mn and mn in h["address"] else 0.0
            hb = float(h["beds_total"] or 0)
            bs = 1 - min(1, abs(hb - d["beds"]) / max(hb, d["beds"], 1)) if d["beds"] else 0.5
            sc = ns * 0.6 + mh * 0.2 + bs * 0.2
            if not best or sc > best[0]: best = (sc, ns, mh, bs, h)
        row = {k: d[k] for k in ("kokuji", "name", "pref", "muni", "beds")}
        if best:
            sc, ns, mh, bs, h = best
            if ns >= 0.93 and (mh or bs >= 0.9): conf = "A"
            elif (ns >= 0.8 and mh and bs >= 0.8) or (ns >= 0.93 and bs >= 0.6) or (ns >= 0.7 and mh and bs >= 0.97): conf = "B"
            else: conf = "C"
            row.update({"k_code": h["code"], "k_name": h["name"], "k_address": h["address"], "k_beds": h["beds_total"],
                        "owner": h["owner"], "corp": corp_of(h["owner"])[0], "rep": corp_of(h["owner"])[1], "score": round(sc, 3), "name_sim": round(ns, 3),
                        "muni_hit": int(mh), "conf": conf})
        else:
            row.update({"conf": "N"})
        res.append(row)
    # 同じ厚生局レコードに複数のDPC施設が当たった場合は低スコア側を C に落とす
    hits = collections.defaultdict(list)
    for r in res:
        if r.get("k_code"): hits[(r["pref"], r["k_code"])].append(r)
    for v in hits.values():
        if len(v) > 1:
            v.sort(key=lambda r: -r["score"])
            for r in v[1:]: r["conf"] = "C"; r["dup"] = 1
    # 法人キー: 医療法人系は同名の別法人があるため代表者名（なければ都道府県）を付ける。
    #           市町村・一部事務組合は同名自治体があるため都道府県を付ける。それ以外（独法・国立大学・学校法人・日赤等）は名称のみ
    for r in res:
        if r.get("conf") in ("A", "B") and r.get("corp"):
            c = r["corp"]
            if re.match(r"^(社会|特定|社団|財団)?医療法人", c): r["corp_key"] = f'{c}|{r["rep"] or r["pref"]}'
            elif re.search(r"(市|町|村|区|組合|企業団|広域連合)$", c) and "法人" not in c: r["corp_key"] = f'{c}|{r["pref"]}'
            elif not re.search(r"法人|会社|社$|機構|組合|連合会|県$|都$|府$|道$|財団|協会|学園|大学|赤十字|済生会|掖済会", c): r["corp_key"] = f'{c}|{r["pref"]}'  # 個人等
            else: r["corp_key"] = c
    keys = ["kokuji", "name", "pref", "muni", "beds", "k_code", "k_name", "k_address", "k_beds", "owner", "corp", "rep", "corp_key", "score", "name_sim", "muni_hit", "conf", "dup"]
    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=keys); w.writeheader(); w.writerows(res)
    c = collections.Counter(r["conf"] for r in res)
    print("total", len(res), dict(sorted(c.items())))

if __name__ == "__main__":
    main(*sys.argv[1:5])
