#!/usr/bin/env python3
"""
Audit the Appendix 2 topic lists against the A-Z vocabulary and emit an explicit,
reviewable mapping table.

Match classes (in priority order):
  exact          -- identical after NFKC + case + whitespace normalisation
  variant        -- differs only by plural/slash/annotation/regional note
  alias          -- resolved by the hand-checked ALIAS table below
  topic-only     -- appears only in Appendix 2, no A-Z headword exists

Anything that cannot be classified automatically is reported for human review;
nothing is silently dropped.
"""
import json
import re
import unicodedata
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / "data"

# Hand-checked resolutions for entries that are not plain variants.
# Value = exact `word` field in ket_vocab_dataset.json, or list for ranges.
ALIAS = {
    # --- disambiguation: these sources resolve to exactly ONE headword ---
    # (plural/slash heuristics picked the wrong partner: news->new, Mrs->Mr, ...)
    "ring": "ring",
    "shorts": "shorts",
    "news": "news",
    "Mrs": "Mrs",
    "glass": "glass",
    "train": "train",
    "lights": "light",
    "rucksack": "backpack",
    "photograph": "photo(graph)",
    "photograph (n & v)": "photo(graph)",
    "listen to": "listen (to)",
    "piece of cake": "cake",
    "railway station": "railway (station)",
    "tourist information": "tourist information centre",
    "(aero)/(air)plane": "aeroplane",
    "straight on": "straight",
    "centimeter / cm": "centimetre/centimeter (cm)",
    "kilo(gram[me])/kg": "kilogramme (kg)",
    "January - December": [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ],
    "Monday - Sunday": [
        "Monday", "Tuesday", "Wednesday", "Thursday",
        "Friday", "Saturday", "Sunday",
    ],
}


def norm(s):
    s = unicodedata.normalize("NFKC", s).lower().strip()
    s = re.sub(r"\s+", " ", s)
    return s.replace("\u2019", "'").replace("\u2018", "'")


def variant_keys(raw):
    """Keys a source entry may match under, beyond the literal string."""
    keys = {norm(raw)}
    stripped = norm(re.sub(r"\([^)]*\)", "", raw))
    if stripped:
        keys.add(stripped)
    if "/" in raw:
        for p in raw.split("/"):
            if p.strip():
                keys.add(norm(p))
        keys.add(norm(re.sub(r"\s*/\s*", " ", raw)))
        keys.add(norm(re.sub(r"\s*/\s*", "", raw)))
    # plural / singular pair
    for k in list(keys):
        if k.endswith("s") and len(k) > 3:
            keys.add(k[:-1])
        if k.endswith("es") and len(k) > 4:
            keys.add(k[:-2])
        keys.add(k + "s")
    return {k for k in keys if k}


def main():
    vocab = json.load(open(DATA / "ket_vocab_dataset.json", encoding="utf-8"))
    topics = json.load(open(DATA / "a2key_topics.json", encoding="utf-8"))

    by_norm, by_word = {}, {}
    for v in vocab:
        by_word[v["word"]] = v["word"]
        for k in variant_keys(v["word"]):
            by_norm.setdefault(k, set()).add(v["word"])

    rows, unknown = [], []
    counts = {"exact": 0, "variant": 0, "alias": 0, "topic-only": 0}

    for t in topics:
        for src in t["words"]:
            targets, method = [], None

            if src in ALIAS:
                val = ALIAS[src]
                targets = val if isinstance(val, list) else [val]
                method = "alias"
            elif norm(src) in by_norm:
                cands = by_norm[norm(src)]
                targets = sorted(cands)
                method = "exact" if len(targets) == 1 and norm(targets[0]) == norm(src) else "variant"
            else:
                cands = set()
                for k in variant_keys(src):
                    cands |= by_norm.get(k, set())
                if cands:
                    targets = sorted(cands)
                    method = "variant"

            if not targets:
                method = "topic-only"
                counts[method] += 1
                unknown.append({"topic": t["topic"], "source": src})
            else:
                missing = [x for x in targets if x not in by_word]
                if missing:
                    raise SystemExit(
                        f"ALIAS target not found in vocabulary: {src} -> {missing}")
                counts[method] += 1

            rows.append({
                "topic": t["topic"],
                "source": src,
                "vocab_words": targets,
                "match_method": method,
            })

    out = {"counts": counts, "mapping": rows, "topic_only": unknown}
    json.dump(out, open(DATA / "topic_mapping.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    total = len(rows)
    print(f"topic entries: {total}")
    for k, n in counts.items():
        print(f"  {k:11} {n:4}  ({n/total*100:.1f}%)")
    print(f"resolved to vocabulary: {total - counts['topic-only']} "
          f"({(total - counts['topic-only'])/total*100:.1f}%)")
    if unknown:
        print("\ntopic-only entries (need a decision):")
        for u in unknown:
            print(f"  {u['topic']:38} | {u['source']}")


if __name__ == "__main__":
    main()
