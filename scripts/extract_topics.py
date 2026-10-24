#!/usr/bin/env python3
"""
Re-extract Appendix 2 topic lists from the A2 Key PDF.

Layout facts (verified from coordinates):
  * the word grid has 4 columns at x ~ 50 / 181 / 313 / 445
  * a topic list is read COLUMN-MAJOR: column 0 top->bottom, then column 1, ...
    (column 0 of "Appliances" reads camera, CD (player), cell phone, clock, ... = alphabetical)
  * topic headings are bold lines in column 0, and every other column follows
    them in the SAME topic block
  * a topic may continue onto the next page

Earlier attempts failed by walking column 0 to the page end (so `current` became
the page's LAST topic) and then appending columns 1-3 to it. This version first
splits each page into topic blocks by heading y-position, then reads each block
column-major.
"""
import json
import re
from pathlib import Path

import fitz

BASE = Path(__file__).resolve().parent.parent
PDF = BASE / "data" / "a2key_vocab_list.pdf"
OUT = BASE / "data" / "a2key_topics.json"

COLS = [50, 181, 313, 445]
TOL = 14

NOISE = {
    "Appendix 2", "Topic Lists", "Vocabulary List",
    "A2 Key and Key for", "Schools", "A2 Key and Key for Schools",
}
FOOTER_RE = re.compile(r"^(©|Page \d+ of \d+)")
POS_CELL_RE = re.compile(r"^\([^()]{1,40}\)$")


def col_index(x):
    for i, c in enumerate(COLS):
        if abs(x - c) <= TOL:
            return i
    return None


def main():
    doc = fitz.open(PDF)
    topics = []
    current = None                      # topic still open across page boundaries

    for pno in range(24, 32):
        cells = []                      # (col, y, text, bold, size)
        for b in doc[pno].get_text("dict")["blocks"]:
            for line in b.get("lines", []):
                spans = [s for s in line["spans"] if s["text"].strip()]
                if not spans:
                    continue
                text = "".join(s["text"] for s in spans).strip()
                if text in NOISE or FOOTER_RE.match(text):
                    continue
                ci = col_index(line["bbox"][0])
                if ci is None:
                    continue
                cells.append({
                    "col": ci, "y": round(line["bbox"][1]),
                    "text": text,
                    "bold": all("Bold" in s["font"] for s in spans),
                    "size": max(s["size"] for s in spans),
                })

        # --- locate topic headings on this page (bold, column 0)
        heading_rows = sorted(
            (c["y"] for c in cells
             if c["col"] == 0 and c["bold"] and c["size"] >= 10.5
             and not POS_CELL_RE.match(c["text"]) and not c["text"].startswith("(")),
        )

        if not heading_rows:
            # whole page belongs to the topic carried over
            blocks = [(current, cells)]
        else:
            blocks = []
            # content above the first heading belongs to the carried-over topic
            above = [c for c in cells if c["y"] < heading_rows[0] - 2]
            if above and current is not None:
                blocks.append((current, above))
            for i, hy in enumerate(heading_rows):
                end = heading_rows[i + 1] - 2 if i + 1 < len(heading_rows) else 10 ** 9
                heading = next(c for c in cells
                               if c["col"] == 0 and c["y"] == hy and c["bold"])
                topic = {"topic": heading["text"], "words": []}
                topics.append(topic)
                block = [c for c in cells if hy + 2 <= c["y"] < end]
                blocks.append((topic, block))

        for topic, block in blocks:
            if topic is None:
                continue
            for c in sorted(block, key=lambda c: (c["col"], c["y"])):
                text = c["text"]
                if POS_CELL_RE.match(text):
                    continue
                if text == topic["topic"]:
                    continue
                topic["words"].append(text)
            current = topic

    # de-duplicate inside each topic, preserve first-seen order
    for t in topics:
        seen, out = set(), []
        for w in t["words"]:
            if w not in seen:
                seen.add(w)
                out.append(w)
        t["words"] = out

    json.dump(topics, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"topics: {len(topics)}  entries: {sum(len(t['words']) for t in topics)}")
    for t in topics:
        print(f"  {t['topic']}: {len(t['words'])}")


if __name__ == "__main__":
    main()
