"""年度の途中で合併した病院の2行を1行にまとめる（build_data.py・build_surg.py・build_sev.py で共通に使う）

退院患者調査では、年度の途中で合併した病院は同じ告示番号の行が2つある。
  1行目：合併前の主たる病院（通番あり）／2行目：合併後（通番「-」）
2行を次の決まりで1行にまとめる（列ごとに rule(j) で指定）。
  "sum"  : 合計（片方が秘匿・空欄なら、もう片方の値。10件未満の秘匿セルは0として扱う）
  "max"  : 大きい方
  "last" : 合併後の行の値（名称・病床など）
  int    : 同じ行の列 int を重みにした加重平均（平均在院日数・割合など）
  str    : 行の外の重み ext[告示番号][通番の欄][str] による加重平均（"n5"・"n6"＝件数、"m6"＝提出月数、"den"＝一般病棟のデータ数）
"""
import collections, re, unicodedata

def nk(s): return unicodedata.normalize("NFKC", str(s if s is not None else "")).strip()
def kid(v):
    k = nk(v).split(".")[0]
    return k if re.fullmatch(r"\d{5}", k) else None
def sub_of(r): return (kid(r[1]) or nk(r[1])) if len(r) > 1 else ""
def fnum(v):
    if isinstance(v, (int, float)): return float(v)
    try: return float(nk(v).replace(",", ""))
    except ValueError: return None

MERGED = set()   # まとめた告示番号（ログ用）

def combine(k, g, rule, ext):
    ncol = max(len(r) for r in g)
    res = list(g[-1]) + [None] * (ncol - len(g[-1]))
    subs = [sub_of(r) for r in g]
    res[1] = next((r[1] for r in g if kid(r[1])), res[1])
    cell = lambda r, j: fnum(r[j]) if j < len(r) else None
    for j in range(3, ncol):
        rl = rule(j)
        if rl is None or rl == "last": continue
        vals = [cell(r, j) for r in g]
        known = [v for v in vals if v is not None]
        if not known: continue
        if rl == "sum": res[j] = sum(known)
        elif rl == "max": res[j] = max(known)
        else:
            if isinstance(rl, int): ws = [cell(r, rl) or 0 for r in g]
            else: ws = [((ext or {}).get(k, {}).get(s, {}).get(rl) or 0) for s in subs]
            W = sum(w for v, w in zip(vals, ws) if v is not None)
            res[j] = sum(v * w for v, w in zip(vals, ws) if v is not None) / W if W else known[0]
    return res

def merge_dups(rows, rule, ext=None):
    """告示番号が重複する行をまとめた行のリストを返す（並び順は最初の行の位置）"""
    groups = collections.defaultdict(list)
    for r in rows:
        k = kid(r[0]) if r else None
        if k: groups[k].append(r)
    out, done = [], set()
    for r in rows:
        k = kid(r[0]) if r else None
        if not k or len(groups[k]) == 1: out.append(r); continue
        if k in done: continue
        done.add(k); MERGED.add(k); out.append(combine(k, groups[k], rule, ext))
    return out

def ranges(*spec):
    """ranges((3, 9, "sum"), (10, 16, 3)) → rule(j)"""
    def rule(j):
        for a, b, rl in spec:
            if a <= j <= b: return rl
        return "last"
    return rule
