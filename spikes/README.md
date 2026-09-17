# Spikes

Throwaway experiments. Nothing here is production code and nothing here is
imported by `src/`. When a spike answers a question, write the answer (with
date) in `docs/05-research.md` and tick the box in `docs/02-roadmap.md`.

| Spike | Question | How to run |
|---|---|---|
| `s1-cors/` | Can the browser call Twitch GQL / usher / CDN / NanoGPT directly? | `npx serve spikes/s1-cors`, open, enter a VOD id, run. **Done** — see research doc. |
| `s1b-shim/` | Does a stateless Cloudflare Worker unlock playlists/segments, and what does 60 s cost? | `wrangler deploy`, then paste the Worker URL into the Shim field of `s1-cors/index.html` and run; see step (f). |
| `s1c-embed/` | Can the official Twitch embed be seeked from JS and read back? | `npx serve spikes/s1c-embed`, Load, click the seek buttons. |
| `s2-chat-dump/` | Dump a VOD's full chat replay to JSONL (offset paging, hashed users) | `python3 dump_chat.py <vodId> out.jsonl` — no deps. Fixtures: tokyosims (5.6k msgs), popkreep_ (2.3k), caseoh_ (103k, gzipped). |
| `s3-hype-scoring/` | Does chat find the moments? | `python3 score.py ../s2-chat-dump/fixture_2871164819.jsonl --top 12 --json rows.json`. `heatmap_2871164819.html` is a rendered result. |

Notes for S1: the persisted-query hashes in `index.html` were written from
memory of what TwitchDownloader / streamlink use and **may be stale**. If (a)
or (b) fail with a GraphQL "PersistedQueryNotFound" error rather than a CORS
error, refresh the hashes from the current TwitchDownloader source
(`TwitchDownloaderCore/TwitchHelper.cs`) — that's a drift failure, not a CORS
failure, and is itself a useful finding.
