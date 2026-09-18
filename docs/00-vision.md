# 00 — Vision

## One sentence

Hypeline is the free, open, install-anywhere tool that turns a Twitch VOD into
clips by listening to what chat already told us — and lets clippers bring their
own AI to do the rest.

## Why this can leave a mark

The clipping market (Opus Clip, Eklipse, Vizard, Powder, Twitch's own editor)
all sell the same loop: upload a VOD, get a batch of captioned verticals, pay a
monthly fee. Three things they share, and we invert:

| Everyone else                                                                    | Hypeline                                                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Treats a VOD as a generic video; only the transcript matters                     | Uses the **chat replay** as a free, real-time crowd signal for where the moments are |
| Uploads multi-GB VODs to their servers (slow, expensive, the reason they charge) | **Never uploads.** Fetches only the seconds it needs, in the browser                 |
| Closed, $20–40/month                                                             | **Free, MIT, runs locally** (PWA), BYOK AI via NanoGPT                               |

The analogy we're aiming for is OBS: became the default by being free, open,
and better at the specific thing streamers needed.

## Who it's for

Primary: **clippers** — people who clip streamers' VODs for views/payment
programs, often young, global, price-sensitive, running 5–20 clips a day.

Secondary: **streamers and their editors** who want to clip their own VODs.

## Core loop (v1)

1. Paste a Twitch VOD URL (or channel → pick VOD).
2. Hypeline loads the chat replay and draws a **hype heatmap** on the
   timeline (message rate, emote bursts, "clip it", subs/raids). Zero AI cost.
3. Click a spike → the player seeks there (HLS), and shows a ±60s window.
4. Optional, per-moment, with cost shown first: **transcribe** the window
   (Whisper via NanoGPT, ~$0.0005/min), then ask an LLM to **name the moment,
   write a hook/title, and suggest in/out points**.
5. Set in/out, choose 9:16 / 16:9 / 1:1 with a crop guide, optional captions,
   **export** in-browser (WebCodecs or ffmpeg.wasm). Download.
6. Optional: image model → thumbnail; video model → intro card / B-roll.

## The AI layer (why NanoGPT)

One key, many models (text, transcription, image, video), pay-as-you-go from
$1, and an OpenAI-compatible API we can call from the browser. Users create an
account through our referral link during onboarding; that's the entire
business model, so the app should make AI features **worth using often** —
not gate the basics behind them.

Under the hood the client is OpenAI-compatible, so the provider is swappable
(OpenAI, OpenRouter, local Ollama). NanoGPT is the default and the only one we
promote.

## The "explosive" bets (post-v1, in order)

1. **Natural-language search over a VOD / channel**: "find every time he blames
   his mouse" → timestamps. This is the feature that makes people run the LLM
   twenty times a day.
2. **Style clone**: learn a clipper's best-performing caption/pacing style from
   their own exports, apply it to new clips.
3. **Live moment feed**: watch chat on the top N live channels over IRC (no
   auth needed), publish "hype spike on X, 12s ago" in real time. A Bloomberg
   terminal for clippers. This is the one feature that likely needs a small
   server; it's also the one people will screenshot.
4. **Streamer clipping-program directory**: crowd-sourced list of who pays for
   clips, rates and rules. Traffic magnet, no AI required.

## Principles

- Free means free. No dark patterns, no "pro" tier. If we ever need money
  beyond referrals, it's an open discussion in `docs/03-decisions.md`.
- Local-first. Works offline for anything already fetched. Nothing leaves the
  browser except calls to Twitch and to the user's AI provider.
- Show the cost before every AI call, and the actual cost after.
- Be Twitch-native. The chat, emotes, subs, raids, clips API — all of it is
  signal. Generic tools can't follow us here without becoming us.
- Don't be a nuisance to Twitch. Respect rate limits, cache aggressively, use
  official APIs when they exist, and have fallbacks when unofficial ones break.

## Non-goals (v1)

Posting to TikTok/YouTube, payments, accounts, teams, non-Twitch sources,
an AI "auto-clipper agent" that posts on the user's behalf.
