#!/usr/bin/env python3
"""Spike S3 — hype scoring prototype over a chat dump (JSONL from S2).

Usage: python score.py chat.jsonl [--bucket 15] [--top 12]

Scores each time bucket by:
  rate     : messages per bucket vs a rolling median baseline (log ratio)
  burst    : share of messages that are "reaction" messages (emotes, laughing,
             W/L, caps, !!!, ???) — chat reacting, not chatting
  clip     : explicit "clip it / clip that / clipped" requests (strong)
  unique   : distinct users in the bucket (a crowd, not one spammer)
Then finds peaks (local maxima with a minimum gap) and prints the top N with
the messages around them so a human can judge. No AI involved.
"""
import argparse, json, math, re, statistics
from collections import defaultdict

REACT_WORDS = {"lol", "lmao", "lmfao", "kekw", "omegalul", "lul", "pog", "pogchamp",
               "poggers", "w", "l", "gg", "wtf", "bruh", "nooo", "no", "yes", "omg",
               "nah", "ayo", "rip", "f", "damn", "wow", "yo", "lets", "letsgo", "monkas",
               "sadge", "copium", "clueless", "kek", "icant", "dead", "💀", "😭", "🔥"}
CLIP_RE = re.compile(r"\bclip(ped|per|s|ping)?\b(?!\s*(farm|channel))|\bclip (it|that|this)\b", re.I)
TECH_RE = re.compile(r"\b(mic|mics|audio|sound|lag|lagging|froze|frozen|buffer|buffering|muted|mute|stream (is )?(dead|down|broke)|can'?t hear|cant hear|no sound|volume|bitrate|pixel|fixed|works now|we('re| are)? back|we good|much better)\b", re.I)
BOT_BADGES = {"bot-badge"}


def is_bot(m):
    return bool(BOT_BADGES & set(m["b"]))


def drop_bots_and_announcements(msgs):
    """Drop bot-badged messages and any exact text repeated >= 4 times by the
    same user (Nightbot/StreamElements timers without the badge)."""
    from collections import Counter
    rep = Counter((m["u"], m["m"]) for m in msgs)
    return [m for m in msgs if not is_bot(m) and rep[(m["u"], m["m"])] < 4]


def is_reaction(m):
    if m["e"]:
        return True
    t = m["m"].strip()
    if not t:
        return False
    low = t.lower()
    words = re.findall(r"[a-z0-9💀😭🔥]+", low)
    if words and all(w in REACT_WORDS or len(w) <= 2 for w in words):
        return True
    if len(t) >= 4 and t.upper() == t and any(ch.isalpha() for ch in t):
        return True
    if re.search(r"(!{2,}|\?{2,}|a{3,}h|o{3,}|w{3,})", low):
        return True
    return False


def score(msgs, bucket):
    by = defaultdict(list)
    for m in msgs:
        by[m["t"] // bucket].append(m)
    last = max(by) if by else 0
    n = [len(by.get(i, [])) for i in range(last + 1)]
    # rolling median baseline over ±10 minutes
    half = max(1, (600 // bucket))
    base = []
    for i in range(len(n)):
        w = n[max(0, i - half): i + half + 1]
        base.append(max(1.0, statistics.median(w)))
    rows = []
    for i in range(len(n)):
        ms = by.get(i, [])
        rate = math.log2((n[i] + 0.5) / base[i])  # >0 above baseline
        react = sum(1 for m in ms if is_reaction(m)) / n[i] if n[i] else 0
        clip = len({m["u"] for m in ms if CLIP_RE.search(m["m"])})  # distinct users asking
        tech = sum(1 for m in ms if TECH_RE.search(m["m"])) / n[i] if n[i] else 0
        users = len({m["u"] for m in ms})
        uniq = users / n[i] if n[i] else 0
        s = 0.0
        if n[i] >= 3:
            s = max(0, rate) * 1.0 + react * 1.5 + (0.5 if uniq > 0.6 else 0)
            if clip:
                s += 1.2 * min(clip, 3)           # explicit requests, scaled by how many asked
            if tech > 0.25:
                s *= 0.3                           # chat is complaining, not hyped
            s *= min(1.0, users / 5)               # confidence: a crowd, not two people
        rows.append({"i": i, "t": i * bucket, "n": n[i], "base": base[i], "rate": rate,
                     "react": react, "clip": clip, "tech": tech, "users": users, "score": s})
    return rows


def peaks(rows, min_gap_buckets, top):
    order = sorted(rows, key=lambda r: -r["score"])
    chosen = []
    for r in order:
        if r["score"] <= 0:
            break
        if all(abs(r["i"] - c["i"]) >= min_gap_buckets for c in chosen):
            chosen.append(r)
        if len(chosen) >= top:
            break
    return sorted(chosen, key=lambda r: r["t"])


def hms(t):
    return f"{t // 3600}:{(t % 3600) // 60:02d}:{t % 60:02d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--bucket", type=int, default=15)
    ap.add_argument("--top", type=int, default=12)
    ap.add_argument("--context", type=int, default=30, help="seconds of chat to print before/after")
    ap.add_argument("--json", help="write per-bucket rows here (for a heatmap)")
    a = ap.parse_args()
    raw = [json.loads(l) for l in open(a.path)]
    msgs = drop_bots_and_announcements(raw)
    print(f"dropped {len(raw) - len(msgs)} bot/announcement messages")
    rows = score(msgs, a.bucket)
    if a.json:
        json.dump(rows, open(a.json, "w"))
    total = len(msgs); dur = max(m["t"] for m in msgs)
    print(f"{total} messages over {hms(dur)} ({total / (dur / 60):.1f}/min avg), bucket {a.bucket}s\n")
    for r in peaks(rows, max(2, 120 // a.bucket), a.top):
        reason = []
        if r["rate"] > 1: reason.append(f"{2 ** r['rate']:.1f}× baseline rate")
        if r["react"] > 0.4: reason.append(f"{r['react'] * 100:.0f}% reactions")
        if r["clip"]: reason.append(f"{r['clip']}× 'clip it'")
        if r["tech"] > 0.25: reason.append("tech trouble (demoted)")
        print(f"=== {hms(r['t'])}  score {r['score']:.2f}  ({r['n']} msgs, {r['users']} users; {', '.join(reason) or 'mild'})")
        lo, hi = r["t"] - a.context, r["t"] + a.bucket + a.context
        for m in msgs:
            if lo <= m["t"] <= hi:
                flag = "*" if is_reaction(m) else " "
                print(f"  {flag} {hms(m['t'])} {m['m'][:90]}")
        print()


if __name__ == "__main__":
    main()
