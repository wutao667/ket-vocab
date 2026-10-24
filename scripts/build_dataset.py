#!/usr/bin/env python3
"""
Build the KET vocabulary dataset: 单词 / 音标 / 中文含义 / 英文例句.

Sources
-------
- A2 Key Vocabulary List (Aug 2025) PDF  -> headwords, POS, official example phrases
- ipa-dict (en_UK)                        -> IPA (normalised to standard British notation)
- ECDICT                                  -> Chinese definitions (+ phonetic fallback)
- Tatoeba English sentences (2.04M)       -> example sentences for words lacking one
- data/overrides.json                     -> hand-checked corrections (highest priority)
"""
import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / "data"
TMP = Path("/tmp")

KET_PATH = DATA / "a2key_words.json"
OVERRIDES = DATA / "overrides.json"
OUT_JSON = DATA / "ket_vocab_dataset.json"
OUT_CSV = DATA / "ket_vocab_dataset.csv"
GAPS_JSON = DATA / "gaps.json"
EX_ZH_PATH = DATA / "example_zh.json"

VOWELS = set("aeiouɑɒɔəɜɪʊʌæɛɐᵻɚɝɨʉɘɵœøɯ")
STRESS = ("ˈ", "ˌ")

# ---------------------------------------------------------------- loading
def load_map(fn, sep="\t"):
    d = {}
    for line in open(TMP / fn, encoding="utf-8"):
        if sep not in line:
            continue
        k, v = line.rstrip("\n").split(sep, 1)
        d.setdefault(k.lower(), v.strip())
    return d


def load_ecdict():
    rows = {}
    with open(TMP / "ecdict.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            rows[r["word"].lower()] = r
    return rows


# ---------------------------------------------------------------- lookup keys
def entry_candidates(word):
    """All dictionary keys that could represent this headword."""
    w = word.strip()
    out = [w.lower()]

    if "/" in w:                                    # a/an, cafe/café, call/ring
        segs = [s.strip() for s in w.split("/") if s.strip()]
        left = segs[0]
        out.append(left.lower())
        prefix = left.rsplit(" ", 1)[0] if " " in left else ""
        for right in segs[1:]:
            if " " in right:
                out.append(right.lower())
            else:
                if prefix:
                    out.append(f"{prefix} {right}".lower())
                out.append(right.lower())
        out.append(re.sub(r"\s*/\s*", " ", w).lower())
        out.append(re.sub(r"\s*/\s*", "", w).lower())

    m = re.match(r"^(.*?)\((.*?)\)(.*)$", w)        # blond(e), photo(graph), PC (personal computer)
    if m:
        base, inner, tail = (g.strip() for g in m.groups())
        out += [(base + inner + tail).lower(), (base + tail).lower(), base.lower(),
                (base + inner).lower()]

    out.append(w.replace("@", "at").lower())
    out.append(re.sub(r"[!?.]+$", "", w).strip().lower())
    out.append(w.replace("-", " ").lower())
    out.append(w.replace("-", "").lower())
    # placeholder forms: "give somebody a call" -> "give a call"
    out.append(re.sub(r"\b(somebody|someone|something)\b", "", w).replace("  ", " ").strip().lower())

    res, seen = [], set()
    for x in out:
        x = re.sub(r"\s+", " ", x).strip(" .")
        if x and x not in seen:
            seen.add(x)
            res.append(x)
    return res


def lookup(mapping, word):
    for c in entry_candidates(word):
        if mapping.get(c):
            return c, mapping[c]
    return None, None


# ---------------------------------------------------------------- IPA
CONSONANT_CLASS = r"[^aeiouɑɒɔəɜɪʊʌæɛɐᵻɚɝɨʉɘɵœøɯˈˌː\s]"


# Legal English onset clusters, in the inventory we normalise to.
LEGAL_ONSETS = {
    "p", "b", "t", "d", "k", "g", "f", "v", "θ", "ð", "s", "z", "ʃ", "ʒ",
    "h", "m", "n", "l", "r", "w", "j", "tʃ", "dʒ",
    "pl", "pr", "pj", "bl", "br", "bj", "tr", "tw", "tj", "dr", "dw", "dj",
    "kl", "kr", "kw", "kj", "gl", "gr", "gw", "gj", "fl", "fr", "fj", "vj",
    "θr", "θw", "sl", "sw", "sp", "st", "sk", "sm", "sn", "sj", "ʃr",
    "hj", "mj", "nj", "lj",
    "spl", "spr", "spj", "str", "stj", "skr", "skw", "skj", "skl",
    "smj", "snj", "spw",
}


def move_stress(p):
    """ipa-dict puts the stress mark immediately BEFORE the stressed vowel;
    standard IPA puts it before that syllable's onset. Shift the mark left over
    the longest legal onset cluster.

    The move only happens when the mark directly precedes a vowel, which makes
    the operation idempotent (re-running it cannot push the mark further left
    across a preceding syllable)."""
    for mark in ("ˈ", "ˌ"):
        pos = 0
        while True:
            i = p.find(mark, pos)
            if i < 0:
                break
            nxt = p[i + 1:i + 2]
            if not nxt or nxt not in VOWELS:
                pos = i + 1
                continue
            j = i
            while j > 0 and p[j - 1] not in VOWELS and p[j - 1] not in "ˈˌ ː":
                j -= 1
            run = p[j:i]
            onset = ""
            for k in range(min(len(run), 3), 0, -1):
                if run[-k:] in LEGAL_ONSETS:
                    onset = run[-k:]
                    break
            if not onset and run:
                onset = run[-1]
            if not onset:
                pos = i + 1
                continue
            start = i - len(onset)
            seg = p[start:i]
            p = p[:start] + mark + seg + p[i + 1:]
            pos = start + 1 + len(seg)
    return p


def normalise_ipa(p):
    if not p:
        return ""
    p = p.strip().strip("/")
    p = (p.replace("ә", "ə").replace("є", "ɛ")        # Cyrillic lookalikes from ECDICT
          .replace("ɐ", "ə").replace("ɹ", "r").replace("ɫ", "l")
          .replace("ɝ", "ɜː").replace("ɚ", "ə").replace("ᵻ", "ɪ")
          .replace("ɡ", "ɡ"))
    p = re.sub(r"\s+", " ", p)
    p = move_stress(p)
    # drop stray stress marks at the very start of a segment before a vowel is fine,
    # but collapse duplicates like ˈˈ
    p = re.sub(r"([ˈˌ])\1+", r"\1", p)
    # ɜː in British notation
    p = p.replace("əː", "ɜː")
    return "/" + p.strip("/") + "/"


def legacy_to_ipa(s):
    """ECDICT uses an ASCII-ish legacy scheme; convert to IPA-ish."""
    if not s:
        return ""
    s = s.strip()
    # digraph vowels MUST be handled before the single-character substitutions,
    # otherwise 'әu' would degrade into 'ə' + 'əʊ'
    s = (s.replace("әu", "əʊ").replace("єu", "əʊ")
          .replace("uә", "ʊə").replace("iә", "ɪə").replace("єә", "eə")
          .replace("ɔi", "ɔɪ").replace("ai", "aɪ").replace("ei", "eɪ")
          .replace("au", "aʊ").replace("ou", "əʊ"))
    s = s.replace("ә", "ə").replace("є", "ɛ")     # Cyrillic lookalikes first
    s = s.replace("i:", "iː").replace("u:", "uː").replace("a:", "ɑː")
    s = s.replace("ɔ:", "ɔː").replace("ә:", "ɜː").replace("e:", "eɪ")
    s = s.replace("'", "ˈ").replace(",", "ˌ")
    s = re.sub(r"[^ˈˌ]*$", lambda m: m.group(0), s)
    return normalise_ipa(s)


def build_ipa(word, ipa_uk, ecdict_phon):
    key, val = lookup(ipa_uk, word)
    if val:
        return normalise_ipa(val), "ipa-dict"

    # compose multi-word entries from their parts
    parts = [p for p in re.split(r"[\s/]+", re.sub(r"[()!?.,]", "", word)) if p]
    if len(parts) > 1:
        pieces, ok = [], True
        for p in parts:
            _, v = lookup(ipa_uk, p)
            if v:
                v = normalise_ipa(v)
            else:
                _, v2 = lookup(ecdict_phon, p)
                v = legacy_to_ipa(v2) if v2 else ""
            if not v:
                ok = False
                break
            pieces.append(v.strip("/"))
        if ok and pieces:
            return normalise_ipa(" ".join(pieces)), "composed"

    _, val = lookup(ecdict_phon, word)
    if val:
        return legacy_to_ipa(val), "ecdict-converted"
    return "", "missing"


# ---------------------------------------------------------------- Chinese gloss
POS_LABEL = {
    "n": "名", "pl": "名", "v": "动", "vt": "动", "vi": "动",
    "adj": "形", "a": "形", "adv": "副", "ad": "副",
    "prep": "介", "conj": "连", "pron": "代", "det": "限", "art": "限",
    "exclam": "叹", "int": "叹", "mv": "助", "aux": "助",
    "phr v": "动", "prep phr": "介", "number": "数", "num": "数",
    "av": "助", "sing": "名",
}

POS_TO_ECDICT = {
    "n": ("n", "pl"), "pl": ("n", "pl"), "v": ("v", "vt", "vi"),
    "adj": ("a", "adj"), "adv": ("ad", "adv"), "prep": ("prep",),
    "conj": ("conj",), "pron": ("pron",), "det": ("det", "art"),
    "exclam": ("int", "exclam"), "mv": ("aux", "v"), "av": ("aux",),
    "phr v": ("v", "vt", "vi"), "prep phr": ("prep",),
    "number": ("num",), "sing": ("n",),
}

DERIVED_NOTE = re.compile(r"[（(][^（）()]{0,20}(现在分词|过去分词|过去式|复数|比较级|最高级|第三人称)[^（）()]{0,10}[)）]")
DOMAIN_TAG = re.compile(r"^\[[^\]]{1,8}\]\s*")
REF_NOTE = re.compile(r"[（(][^（）()]{0,15}(的|见)[^（）()]{0,15}[)）]$")


def split_lines(text):
    if not text:
        return []
    # ECDICT stores literal backslash-n inside TSV fields
    text = text.replace("\\n", "\n")
    return [l.strip() for l in text.split("\n") if l.strip()]


def trim_senses(body, limit=3):
    body = (body.replace("...", "…").replace(",,", ",")
                .replace(";", "；"))
    body = re.sub(r"\s*,\s*", "、", body)
    body = DERIVED_NOTE.sub("", body)
    body = re.sub(r"\s*；\s*", "；", body)
    parts = [p.strip(" 　.。") for p in re.split(r"[、；]", body) if p.strip(" 　.。")]
    # keep senses that are actually Chinese, drop leftover English glosses
    kept = [p for p in parts if re.search(r"[\u4e00-\u9fff]", p)]
    if not kept:
        kept = parts
    # de-duplicate while keeping order
    out, seen = [], set()
    for p in kept:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return "、".join(out[:limit])


def clean_translation(translation, pos_tags):
    lines = split_lines(translation)
    if not lines:
        return ""
    # drop domain-tagged senses ([计] computing, [医] medical, [化] chemistry...)
    lines = [l for l in lines if not DOMAIN_TAG.match(l)]
    if not lines:
        lines = [DOMAIN_TAG.sub("", l).strip() for l in split_lines(translation)]
        lines = [l for l in lines if l]

    wanted = []
    for p in pos_tags:
        wanted.extend(POS_TO_ECDICT.get(p, []))

    tagged, untagged = [], []
    for line in lines:
        m = re.match(r"^([a-z]{1,5})\.\s*(.+)$", line)
        if m:
            tagged.append((m.group(1), m.group(2)))
        else:
            untagged.append(line)

    if not tagged:
        return trim_senses(untagged[0]) if untagged else ""

    picked = [(t, b) for t, b in tagged if not wanted or t in wanted] or tagged

    ordered = []
    for p in pos_tags:
        for tag in POS_TO_ECDICT.get(p, ()):
            for t, b in picked:
                if t == tag and (t, b) not in ordered:
                    ordered.append((t, b))
    for t, b in picked:
        if (t, b) not in ordered:
            ordered.append((t, b))

    # merge senses that share the same Chinese POS label (e.g. vt+vi -> 动)
    merged, order = {}, []
    for tag, body in ordered:
        body = trim_senses(body)
        if not body:
            continue
        label = POS_LABEL.get(tag, tag)
        if label not in merged:
            merged[label] = []
            order.append(label)
        for sense in body.split("、"):
            if sense and sense not in merged[label]:
                merged[label].append(sense)
    return "；".join(f"{label}. {'、'.join(merged[label][:4])}" for label in order)


# ---------------------------------------------------------------- examples
TOKEN_RE = re.compile(r"[a-z']+")
IRREGULAR = {
    "be": ["is", "are", "was", "were", "been", "being", "am", "'s"],
    "have": ["has", "had", "having", "'ve"],
    "do": ["does", "did", "done", "doing"],
    "go": ["goes", "went", "gone", "going"],
    "get": ["gets", "got", "gotten", "getting"],
    "make": ["makes", "made", "making"],
    "take": ["takes", "took", "taken", "taking"],
    "come": ["comes", "came", "coming"],
    "see": ["sees", "saw", "seen", "seeing"],
    "eat": ["eats", "ate", "eaten", "eating"],
    "buy": ["buys", "bought", "buying"],
    "think": ["thinks", "thought", "thinking"],
    "give": ["gives", "gave", "given", "giving"],
    "put": ["puts", "putting"],
    "sit": ["sits", "sat", "sitting"],
    "run": ["runs", "ran", "running"],
    "swim": ["swims", "swam", "swum", "swimming"],
    "write": ["writes", "wrote", "written", "writing"],
    "read": ["reads", "reading"],
    "speak": ["speaks", "spoke", "spoken", "speaking"],
    "meet": ["meets", "met", "meeting"],
    "win": ["wins", "won", "winning"],
    "lose": ["loses", "lost", "losing"],
    "find": ["finds", "found", "finding"],
    "tell": ["tells", "told", "telling"],
    "say": ["says", "said", "saying"],
    "feel": ["feels", "felt", "feeling"],
    "leave": ["leaves", "left", "leaving"],
    "sleep": ["sleeps", "slept", "sleeping"],
    "teach": ["teaches", "taught", "teaching"],
    "learn": ["learns", "learnt", "learned", "learning"],
    "bring": ["brings", "brought", "bringing"],
    "catch": ["catches", "caught", "catching"],
    "fall": ["falls", "fell", "fallen", "falling"],
    "drink": ["drinks", "drank", "drunk", "drinking"],
    "ride": ["rides", "rode", "ridden", "riding"],
    "drive": ["drives", "drove", "driven", "driving"],
    "fly": ["flies", "flew", "flown", "flying"],
    "sing": ["sings", "sang", "sung", "singing"],
    "wear": ["wears", "wore", "worn", "wearing"],
    "begin": ["begins", "began", "begun", "beginning"],
    "break": ["breaks", "broke", "broken", "breaking"],
    "choose": ["chooses", "chose", "chosen", "choosing"],
    "pay": ["pays", "paid", "paying"],
    "sit down": ["sits down", "sat down", "sitting down"],
}


def word_forms(w):
    w = w.lower()
    forms = {w}
    if w in IRREGULAR:
        forms.update(IRREGULAR[w])
    if w.endswith("y") and len(w) > 2 and w[-2] not in VOWELS:
        forms |= {w[:-1] + "ies", w[:-1] + "ied"}
    if w.endswith(("s", "x", "ch", "sh", "zz")):
        forms.add(w + "es")
    if w.endswith("o"):
        forms.add(w + "es")
    forms |= {w + "s", w + "ed", w + "ing"}
    if w.endswith("e"):
        forms |= {w + "d", w[:-1] + "ing"}
    if len(w) > 3 and w[-1] not in VOWELS and w[-2] in VOWELS and w[-3] not in VOWELS:
        forms |= {w + w[-1] + "ed", w + w[-1] + "ing"}
    return {f for f in forms if f}


def phrase_pattern(phrase):
    """Regex matching a multi-word entry, tolerant of inflection on each word."""
    words = [w for w in re.split(r"[\s/]+", phrase) if w]
    parts = []
    for i, w in enumerate(words):
        forms = sorted(word_forms(w), key=len, reverse=True)
        alts = "|".join(re.escape(f) for f in forms)
        parts.append(r"(?:%s)" % alts)
    return re.compile(r"\b" + r"\s+".join(parts) + r"\b", re.I)


def build_matchers(target_words):
    """Return (form -> [headword keys], key -> phrase regex, phrase-first-token -> [keys])."""
    form_to_keys = {}
    phrase_rx = {}
    phrase_anchor = {}

    for w in target_words:
        key = w.lower()
        if re.search(r"[\s/]", w.strip()):
            phrase_rx[key] = phrase_pattern(w)
            first = [p for p in re.split(r"[\s/]+", re.sub(r"[()!?.,]", "", w)) if p]
            if first:
                for f in word_forms(first[0]):
                    phrase_anchor.setdefault(f, []).append(key)
        else:
            for f in word_forms(w):
                form_to_keys.setdefault(f, []).append(key)

    return form_to_keys, phrase_rx, phrase_anchor


def collect_candidates(sent_path, form_to_keys, phrase_rx, phrase_anchor, cap=40):
    """Single pass over Tatoeba using an inverted index (no per-sentence regex scan)."""
    cands = {}
    seen = {}
    with open(sent_path, encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            s = parts[2]
            if len(s) > 140:
                continue
            toks = set(TOKEN_RE.findall(s.lower()))
            if not toks:
                continue

            hit_keys = []
            for t in toks:
                if t in form_to_keys:
                    hit_keys.extend(form_to_keys[t])
                if t in phrase_anchor:
                    hit_keys.extend(phrase_anchor[t])

            for key in hit_keys:
                bucket = cands.setdefault(key, [])
                if len(bucket) >= cap:
                    continue
                ss = seen.setdefault(key, set())
                if s in ss:
                    continue
                # verify phrase matches properly
                rx = phrase_rx.get(key)
                if rx is not None and not rx.search(s):
                    continue
                ss.add(s)
                bucket.append(s)
    return cands


def load_common_words(sent_path, top=2500):
    c = Counter()
    with open(sent_path, encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            c.update(TOKEN_RE.findall(parts[2].lower()))
    return {w for w, _ in c.most_common(top)}


def simplicity(sentence, common, ket_words):
    toks = TOKEN_RE.findall(sentence.lower())
    n = len(toks)
    if n < 4 or n > 14:
        return -99
    known = sum(1 for t in toks if t in common or t in ket_words)
    ratio = known / n
    score = ratio * 10 - abs(n - 8) * 0.8
    if n > 12:
        score -= (n - 12) * 1.5
    if re.search(r"[;:—–\"“”()]", sentence):
        score -= 2
    if sentence.count(",") > 1:
        score -= 1.5
    if re.search(r"\b(although|however|nevertheless|whereas|consequently|moreover)\b",
                 sentence.lower()):
        score -= 4
    if re.match(r"^(Tom|Mary|John|Jack|Anna)\b", sentence):
        score -= 1.2        # Tatoeba's default names, keep variety
    if "?" in sentence:
        score -= 0.3
    return score


CAMBRIDGE_POS_TAIL = re.compile(r"\s*\((?:n|v|adj|adv|prep|pron|conj|det|exclam|pl|phr v|mv|number)(?:\s*&\s*(?:n|v|adj|adv|prep|pron|conj|det))*\)\s*\.?$")
AUX_WORDS = {"is", "are", "was", "were", "am", "be", "been", "being", "do", "does", "did",
             "have", "has", "had", "can", "could", "will", "would", "shall", "should",
             "may", "might", "must", "don't", "doesn't", "didn't", "can't", "won't"}


def is_full_sentence(text):
    """Cambridge entries are often bare phrases ('wild animals.', 'a break for lunch')."""
    if not text:
        return False
    toks = TOKEN_RE.findall(text.lower())
    if len(toks) < 4:
        return False
    if toks[0] in AUX_WORDS:
        return True
    # needs a finite verb somewhere, and should not be a pure noun phrase
    verbish = AUX_WORDS | {
        "like", "want", "need", "go", "goes", "went", "get", "gets", "got", "make",
        "makes", "made", "take", "takes", "took", "have", "put", "puts", "see", "saw",
        "look", "looks", "play", "plays", "work", "works", "live", "lives", "eat",
        "eats", "drink", "drinks", "come", "comes", "came", "know", "knows", "think",
    }
    if any(t in verbish for t in toks):
        return True
    # heuristic: a subject pronoun + anything reads as a clause
    return toks[0] in {"i", "you", "he", "she", "it", "we", "they", "there", "this", "that"}


def clean_cambridge_phrase(phrase):
    p = CAMBRIDGE_POS_TAIL.sub("", phrase.strip()).strip()
    p = re.sub(r"\s+", " ", p)
    if p and p[-1] not in ".!?…":
        p += "."
    return p


# ---------------------------------------------------------------- main
def main():
    ket = json.load(open(KET_PATH, encoding="utf-8"))
    ov = json.load(open(OVERRIDES, encoding="utf-8"))
    ex_zh = json.load(open(EX_ZH_PATH, encoding="utf-8")) if EX_ZH_PATH.exists() else {}
    ipa_uk = load_map("ipa_en_UK.txt")
    ecdict = load_ecdict()
    ecdict_phon = {k: v["phonetic"] for k, v in ecdict.items()}

    ket_words = {e["word"].lower() for e in ket}
    print(f"headwords: {len(ket)}", file=sys.stderr)

    # Index EVERY headword: a Cambridge "example" may turn out to be a bare phrase,
    # in which case we still want a Tatoeba sentence in reserve.
    need = [e["word"] for e in ket if not ov["example"].get(e["word"])]
    print(f"need auto examples: {len(need)}", file=sys.stderr)

    common = load_common_words(TMP / "eng_sent.tsv")
    form_to_keys, phrase_rx, phrase_anchor = build_matchers(need)
    print("scanning Tatoeba...", file=sys.stderr)
    cands = collect_candidates(TMP / "eng_sent.tsv", form_to_keys, phrase_rx, phrase_anchor)
    print(f"candidates collected for {len(cands)} headwords", file=sys.stderr)

    out, stats = [], {"ipa": Counter(), "zh": Counter(), "ex": Counter()}
    used_examples = set()

    for e in ket:
        word = e["word"]
        # POS can be overridden: a few A-Z entries carry no tag in the PDF at all
        # (e.g. "go shopping"), which would otherwise leave the column unlabelled.
        pos_raw = ov.get("pos", {}).get(word) or e.get("pos", "")
        pos_tags = [p.strip() for p in pos_raw.replace("&", ",").split(",") if p.strip()]

        # ---- IPA (override > ipa-dict > composed > ecdict)
        if word in ov["ipa"]:
            ipa, src = ov["ipa"][word], "manual"
        else:
            ipa, src = build_ipa(word, ipa_uk, ecdict_phon)
        stats["ipa"][src] += 1

        # ---- Chinese
        if word in ov["zh"]:
            zh = ov["zh"][word]
        else:
            _, row = lookup(ecdict, word)
            zh = clean_translation(row["translation"], pos_tags) if row else ""
            # ECDICT often stores bare glosses with no POS tag; label them with
            # the part of speech the KET list gives so the column stays uniform.
            if zh and not re.match(r"^(名|动|形|副|介|连|代|限|叹|助|数|abbr)\.", zh):
                label = POS_LABEL.get(pos_tags[0], "") if pos_tags else ""
                zh = f"{label}. {zh}" if label else zh
        stats["zh"]["ok" if zh else "missing"] += 1

        # ---- example (override > full Cambridge sentence > Tatoeba > Cambridge phrase)
        example, ex_src = "", "missing"
        cam_phrase = ""
        if e.get("examples"):
            raw = e["examples"][0].strip()
            if raw and not re.match(r"^(Page \d+|©|Vocabulary)", raw):
                cleaned = clean_cambridge_phrase(raw)
                if is_full_sentence(cleaned):
                    example, ex_src = cleaned, "cambridge-sentence"
                else:
                    cam_phrase = cleaned

        if not example:
            key = word.lower()
            best, best_score = None, -1e9
            for s in cands.get(key, []):
                if s in used_examples:
                    continue
                sc = simplicity(s, common, ket_words)
                if sc > best_score:
                    best, best_score = s, sc
            if best and best_score > -50:
                example, ex_src = best, "tatoeba"
                used_examples.add(best)

        if word in ov["example"]:
            example, ex_src = ov["example"][word], "manual"
        elif not example and cam_phrase:
            example, ex_src = cam_phrase, "cambridge-phrase"

        stats["ex"][ex_src] += 1

        # ---- Chinese translation of the example (bulk LLM pass, literal style)
        example_zh = ex_zh.get(word, "")

        out.append({
            "word": word, "pos": pos_raw, "ipa": ipa, "zh": zh,
            "example": example, "example_zh": example_zh,
            "source_ipa": src, "source_example": ex_src,
            "source_example_zh": "llm" if example_zh else "",
        })

    # A few headwords share the exact same sample sentence (e.g. "bin" / "rubbish"),
    # so the translator emitted one line for both. Backfill by final sentence text
    # rather than leaving those rows blank.
    zh_by_sentence = {}
    for r in out:
        if r["example_zh"] and r["example"]:
            zh_by_sentence.setdefault(r["example"].strip(), r["example_zh"])
    for r in out:
        if not r["example_zh"] and r["example"].strip() in zh_by_sentence:
            r["example_zh"] = zh_by_sentence[r["example"].strip()]
            r["source_example_zh"] = "llm-shared"

    json.dump(out, open(OUT_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    with open(OUT_CSV, "w", encoding="utf-8-sig", newline="") as f:
        wcsv = csv.writer(f)
        wcsv.writerow(["#", "单词", "音标", "中文含义", "英文例句", "例句中文", "词性"])
        for i, r in enumerate(out, 1):
            wcsv.writerow([i, r["word"], r["ipa"], r["zh"],
                           r["example"], r["example_zh"], r["pos"]])

    gaps = {
        "ipa": [r["word"] for r in out if not r["ipa"]],
        "zh": [r["word"] for r in out if not r["zh"]],
        "example": [r["word"] for r in out if not r["example"]],
        "example_zh": [r["word"] for r in out if not r["example_zh"]],
    }
    json.dump(gaps, open(GAPS_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    summary = {k: dict(v) for k, v in stats.items()}
    print(json.dumps(summary, ensure_ascii=False, indent=1), file=sys.stderr)
    print("gaps:", {k: len(v) for k, v in gaps.items()}, file=sys.stderr)


if __name__ == "__main__":
    main()
