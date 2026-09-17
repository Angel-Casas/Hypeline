#!/usr/bin/env python3
"""Spike S2 — dump a Twitch VOD's full chat replay to JSONL.

Usage: python dump_chat.py <vod_id> [out.jsonl]

Uses the unofficial GQL persisted query `VideoCommentsByOffsetOrCursor` with
the public web client-id (same call the browser spike proved works). Pages by
cursor. Output: one JSON object per line:
  {"t": offsetSec, "u": userIdHash, "m": text, "e": [emoteNames], "b": [badges]}
Usernames are hashed so the dump can be committed as a test fixture.
"""
import hashlib, json, sys, time, urllib.request

GQL = "https://gql.twitch.tv/gql"
CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"  # public web client-id; unofficial
HASH = "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a"  # verified 2026-09-12


def gql(payload):
    req = urllib.request.Request(
        GQL, data=json.dumps(payload).encode(),
        headers={"Client-Id": CLIENT_ID, "Content-Type": "application/json"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # noqa
            wait = 2 ** attempt
            print(f"  retry in {wait}s: {e}", file=sys.stderr)
            time.sleep(wait)
    raise SystemExit("gave up")


def page(vod, cursor=None, offset=0):
    variables = {"videoID": vod}
    if cursor:
        variables["cursor"] = cursor
    else:
        variables["contentOffsetSeconds"] = offset
    return gql([{
        "operationName": "VideoCommentsByOffsetOrCursor",
        "variables": variables,
        "extensions": {"persistedQuery": {"version": 1, "sha256Hash": HASH}},
    }])[0]["data"]["video"]["comments"]


def anon(login):
    return hashlib.sha1(("hypeline:" + (login or "?")).encode()).hexdigest()[:8]


def main():
    vod = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else f"chat_{vod}.jsonl"
    t0 = time.time()
    n = 0
    seen = set()
    offset = 0
    # FINDING (2026-09-12): paging by `cursor` returns
    # {"errors":[{"extensions":{"code":"IntegrityCheckFailed"}}]} without a
    # Client-Integrity token, but paging by `contentOffsetSeconds` does not.
    # Twitch returns a fixed ~60-message chunk containing that second (it may
    # start before the offset), so we walk with offset = last_t + 1 and
    # de-duplicate by message id.
    with open(out, "w") as f:
        while True:
            c = page(vod, None, offset)
            if c is None:
                # FINDING: asking for an offset past `video.lengthSeconds` returns
                # {"errors":[{"message":"service error"}]} with comments == null,
                # not hasNextPage == false. Treat it as end-of-VOD once we have data.
                if n:
                    break
                raise SystemExit("comments == null on first page (integrity check?)")
            new = 0
            for edge in c["edges"]:
                node = edge["node"]
                if node["id"] in seen:
                    continue
                seen.add(node["id"])
                new += 1
                msg = node["message"]
                text = "".join(fr.get("text", "") for fr in msg["fragments"])
                emotes = [fr["text"] for fr in msg["fragments"] if fr.get("emote")]
                badges = [b["setID"] for b in msg.get("userBadges", []) if b.get("setID")]
                f.write(json.dumps({
                    "t": node["contentOffsetSeconds"],
                    "u": anon((node.get("commenter") or {}).get("login")),
                    "m": text, "e": emotes, "b": badges,
                }, ensure_ascii=False) + "\n")
                n += 1
            if not c["edges"] or not c["pageInfo"]["hasNextPage"]:
                break
            last_t = c["edges"][-1]["node"]["contentOffsetSeconds"]
            if new == 0:
                # a whole chunk of duplicates: a second with >60 messages; skip ahead
                offset = last_t + 1 if last_t + 1 > offset else offset + 1
            else:
                offset = last_t + 1
            if n % 5000 < new:
                print(f"  {n} messages, {time.time() - t0:.0f}s, at {last_t}s", file=sys.stderr)
    print(f"done: {n} messages in {time.time() - t0:.0f}s -> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
