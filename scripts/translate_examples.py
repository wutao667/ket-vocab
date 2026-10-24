#!/usr/bin/env python3
"""
Bulk-translate the English examples into Chinese (literal style).

Reads  : data/ket_vocab_dataset.json
Writes : data/example_zh.json   (word -> 中文译文)

Design notes
------------
* Batches N sentences per request and asks for a JSON array back, which is far
  cheaper than one request per sentence.
* Resumes: anything already present in the output file is skipped, so a crash or
  a gateway restart never loses progress.
* Validates the response shape; a batch that fails twice is recorded as failed
  rather than silently producing a wrong-length array.
* Literal style (per the owner's decision): faithful, natural Chinese, no
  embellishment, suitable for a child reading alongside the English.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / "data"
SRC = DATA / "ket_vocab_dataset.json"
OUT = DATA / "example_zh.json"
FAILED = DATA / "example_zh_failed.json"

CONFIG = Path("/home/wutao/.openclaw/openclaw.json")
PROVIDER = "litellm-wutao"
MODEL = "deepseek-flash"
BATCH = 20
WORKERS = 4

SYSTEM = (
    "你是英语学习词典的例句翻译员。把每条英文例句翻译成中文。"
    "要求：\n"
    "1. 直译为主，忠实原意，不增不减，不发挥。\n"
    "2. 中文自然通顺，符合中文表达习惯。\n"
    "3. 面向 KET（A2 级）学生，用词浅显。\n"
    "4. 专有名词保留通行译法；人名地名可音译或保留原文。\n"
    "5. 只输出 JSON 数组，元素是与输入等长的中文字符串，不要任何解释。"
)


def load_provider():
    cfg = json.load(open(CONFIG))
    p = cfg["models"]["providers"][PROVIDER]
    return p["baseUrl"].rstrip("/"), p["apiKey"]


def call(base_url, api_key, texts, retries=3):
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": json.dumps(texts, ensure_ascii=False)},
        ],
        "temperature": 0,
        "max_tokens": 2048,
    }
    body = json.dumps(payload).encode()
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                base_url + "/chat/completions", data=body,
                headers={"Authorization": f"Bearer {api_key}",
                         "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.load(r)
            content = data["choices"][0]["message"]["content"].strip()
            # tolerate fenced JSON or leading prose
            content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content).strip()
            m = re.search(r"\[.*\]", content, re.S)
            if not m:
                raise ValueError(f"no JSON array in response: {content[:120]}")
            arr = json.loads(m.group(0))
            if not isinstance(arr, list) or len(arr) != len(texts):
                raise ValueError(f"length mismatch {len(arr)} != {len(texts)}")
            if not all(isinstance(x, str) and x.strip() for x in arr):
                raise ValueError("non-string or empty element")
            return arr
        except Exception as exc:                     # noqa: BLE001
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(str(last))


def main():
    vocab = json.load(open(SRC, encoding="utf-8"))
    done = {}
    if OUT.exists():
        done = json.load(open(OUT, encoding="utf-8"))
        print(f"resume: {len(done)} already translated", file=sys.stderr)

    todo = []
    seen = {}
    for e in vocab:
        w, ex = e["word"], e["example"]
        if not ex or w in done:
            continue
        # identical example text (e.g. shared phrase) only needs translating once
        if ex in seen:
            continue
        seen[ex] = w
        todo.append((w, ex))

    print(f"to translate: {len(todo)}", file=sys.stderr)
    base_url, api_key = load_provider()

    batches = [todo[i:i + BATCH] for i in range(0, len(todo), BATCH)]
    failed = []
    completed = 0

    def work(batch):
        texts = [ex for _, ex in batch]
        return batch, call(base_url, api_key, texts)

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(work, b): b for b in batches}
        for fut in as_completed(futures):
            batch = futures[fut]
            try:
                _, translations = fut.result()
                for (w, _), zh in zip(batch, translations):
                    done[w] = zh.strip()
                completed += len(batch)
                print(f"  +{len(batch):3}  total {completed}/{len(todo)}", file=sys.stderr)
            except Exception as exc:                 # noqa: BLE001
                failed.extend([w for w, _ in batch])
                print(f"  !FAILED batch of {len(batch)}: {exc}", file=sys.stderr)

            if completed % 400 < BATCH:
                json.dump(done, open(OUT, "w", encoding="utf-8"),
                          ensure_ascii=False, indent=1)

    # second pass for failed batches, smaller
    if failed:
        print(f"retry {len(failed)} individually-batched entries", file=sys.stderr)
        retry_todo = [(w, dict((e['word'], e['example']) for e in vocab)[w]) for w in failed]
        for batch in [retry_todo[i:i + 5] for i in range(0, len(retry_todo), 5)]:
            try:
                _, translations = work(batch)
                for (w, _), zh in zip(batch, translations):
                    done[w] = zh.strip()
            except Exception as exc:                 # noqa: BLE001
                print(f"  still failing {[w for w,_ in batch]}: {exc}", file=sys.stderr)

    json.dump(done, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    missing = [e["word"] for e in vocab if e["example"] and e["word"] not in done]
    json.dump(missing, open(FAILED, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\ndone: {len(done)} translated, {len(missing)} missing", file=sys.stderr)
    if missing:
        print("missing sample:", missing[:20], file=sys.stderr)


if __name__ == "__main__":
    main()
