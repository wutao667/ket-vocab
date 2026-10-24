#!/usr/bin/env python3
"""
Re-extract headwords + example phrases from the A2 Key PDF using layout coordinates,
fixing two defects of the first pass:
  1. wrapped example lines were split into separate fragments
  2. A-Z section letters ('B') leaked in as examples
"""
import json
import re
from pathlib import Path

import fitz

BASE = Path(__file__).resolve().parent.parent
PDF = BASE / "data" / "a2key_vocab_list.pdf"
OUT = BASE / "data" / "a2key_words.json"

# A POS atom as it actually appears in the A2 Key list, including the multi-word
# forms "(n pl)", "(unc n)", "(aux v)", "(phr v)", "(prep phr)".
POS_ATOM = (r"(?:aux\s+v|phr\s+v|prep\s+phr|unc\s+n|n\s+pl|abbr"
            r"|n|v|mv|adj|adv|av|prep|conj|det|pron|exclam|pl|sing|number)")
# One parenthetical POS group, allowing combined tags such as "(adj & n)".
POS_PAREN = re.compile(
    r"\(\s*(" + POS_ATOM + r"(?:\s*[,&]\s*" + POS_ATOM + r")*)\s*\)", re.I)
# Same, but tolerating an annotation inside the same parentheses as the tag,
# e.g. "bright (adj – for colours)" or "smart (adj – NOT ARTIFICIAL)".
POS_PAREN_ANNOT = re.compile(
    r"\(\s*(" + POS_ATOM + r"(?:\s*[,&]\s*" + POS_ATOM + r")*)\s*[^()]*\)", re.I)
# Headword = everything before the FIRST real POS group; trailing regional notes
# such as "(Br Eng) (Am Eng: cookie)" are ignored. Verified against the real
# line forms in this PDF:
#   biscuit (n) (Br Eng) (Am Eng: cookie)      -> biscuit / n
#   chips (n pl) (Br Eng) (Am Eng: biscuit)    -> chips / n pl
#   rubbish (unc n)                            -> rubbish / unc n
#   design (PLANNING) (n)                      -> design (PLANNING) / n
#   kilogramme (kg) (n) (Br Eng) (Am Eng:      -> kilogramme (kg) / n  (truncated)
#   will ('ll) (mv)                            -> will ('ll) / mv
#   photo(graph) (n)                           -> photo(graph) / n
# Column position already separates headwords from indented example lines, so no
# end-of-line anchor is needed here.
def split_headword(text):
    m = POS_PAREN.search(text) or POS_PAREN_ANNOT.search(text)
    if not m:
        return None
    head = text[:m.start()].strip()
    if not head:
        return None
    return head, re.sub(r"\s+", " ", m.group(1).strip())


BARE_HEAD_RE = re.compile(r"^[a-zA-Z][a-zA-Z'’\-./() ]{0,38}$")


def bare_headword(text):
    """A few A-Z entries carry no POS tag at all in this PDF (e.g. "go shopping").
    Only accept short, letter-initial text sitting exactly at a headword column,
    which is already guaranteed by the caller."""
    t = text.strip()
    if not t or not BARE_HEAD_RE.match(t):
        return None
    if t.endswith(")") and "(" not in t:          # stray wrapped fragment
        return None
    if len(t.split()) > 5:
        return None
    if LETTER_RE.match(t) or t in {"Schools", "Vocabulary List"}:
        return None
    if t.endswith((".", "!", "?", ":")):
        return None
    return t, ""
FOOTER_RE = re.compile(r"^(©|Page \d+ of|\d+$)")
LETTER_RE = re.compile(r"^[A-Z]$")

# two columns: left column starts ~43pt, right column ~316pt
COL_LEFT, COL_RIGHT = 43, 316
TOL = 10


def page_rows(doc, pno):
    rows = []
    for b in doc[pno].get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            text = "".join(s["text"] for s in l["spans"]).strip()
            if not text:
                continue
            x0, y0, x1, y1 = l["bbox"]
            rows.append({"x": x0, "y": y0, "x1": x1, "y1": y1, "text": text})
    return rows


def column_of(x):
    if abs(x - COL_LEFT) < TOL:
        return 0
    if abs(x - COL_RIGHT) < TOL:
        return 1
    return None


def main():
    doc = fitz.open(PDF)
    entries = []          # ordered list of {word, pos, examples:[...]}
    by_key = {}

    for pno in range(3, 24):          # A-Z section
        rows = [r for r in page_rows(doc, pno)
                if not FOOTER_RE.match(r["text"])
                and "Vocabulary List" != r["text"]
                and "A2 Key and Key for" != r["text"]
                and r["text"] != "Schools"]

        cols = {0: [], 1: []}
        for r in rows:
            c = column_of(r["x"])
            if c is not None:
                cols[c].append(r)
            elif r["x"] > COL_LEFT + TOL:
                # indented content (example text / bullet) -> attach to nearest column
                cols[0 if r["x"] < 300 else 1].append(r)

        for c in (0, 1):
            col_rows = sorted(cols[c], key=lambda r: r["y"])
            current = None
            pending_cont = False      # previous line was a wrapped example fragment
            last_head_y = -999.0      # y of the last accepted headword in this column

            for r in col_rows:
                text = r["text"]

                if LETTER_RE.match(text) and len(text) == 1 and r["x"] < 250:
                    current = None
                    pending_cont = False
                    continue

                parsed = split_headword(text) if column_of(r["x"]) is not None else None
                if parsed is None and column_of(r["x"]) is not None:
                    # a handful of A-Z entries carry no POS tag (e.g. "go shopping")
                    bare = bare_headword(text)
                    if bare and current is not None:
                        # require vertical proximity so a wrapped fragment further
                        # down the column is not mistaken for a new entry
                        gap = r["y"] - last_head_y
                        if 6 <= gap <= 30:
                            parsed = bare
                if parsed:
                    word, pos = parsed
                    entry = {"word": word, "pos": pos, "examples": []}
                    entries.append(entry)
                    by_key[word.lower()] = entry
                    current = entry
                    pending_cont = False
                    last_head_y = r["y"]
                    continue

                if current is None:
                    continue

                if text == "•":
                    pending_cont = False
                    continue

                col_start = COL_LEFT if c == 0 else COL_RIGHT
                if r["x"] >= col_start + 12:      # indented = example line
                    frag = text
                    # continuation of a wrapped line (no bullet before it)
                    if pending_cont and current["examples"]:
                        current["examples"][-1] += " " + frag
                    else:
                        current["examples"].append(frag)
                    pending_cont = True
                else:
                    pending_cont = False

    # cleanup
    for e in entries:
        cleaned = []
        for ex in e["examples"]:
            ex = re.sub(r"\s+", " ", ex).strip()
            ex = re.sub(r"\s*\((?:n|v|adj|adv|prep|pron|conj|det|exclam|pl|phr v|mv)\)\s*$", "", ex)
            if ex and not LETTER_RE.match(ex):
                cleaned.append(ex)
        e["examples"] = cleaned

    # merge duplicates (same headword twice across columns)
    merged, order = {}, []
    for e in entries:
        k = e["word"].lower()
        if k in merged:
            for ex in e["examples"]:
                if ex not in merged[k]["examples"]:
                    merged[k]["examples"].append(ex)
        else:
            merged[k] = e
            order.append(k)

    out = [merged[k] for k in order]
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"entries: {len(out)}  with examples: {sum(1 for x in out if x['examples'])}")
    for w in ("against", "awful", "book", "able", "as"):
        hit = merged.get(w)
        print(w, "->", hit["examples"] if hit else "MISSING")


if __name__ == "__main__":
    main()
