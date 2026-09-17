/**
 * Chat replay fetcher: walks a VOD by time offset with N parallel lanes,
 * de-duplicates by comment id, and reports progress as it goes.
 * Framework-free so it can run in a Worker later.
 */
import { fetchCommentsAtOffset, type RawComment } from './gql';
import type { ChatMessage } from './types';

export interface LaneProgress {
  /** The lane's time range (VOD seconds) and how far into it the fetch has reached. */
  start: number;
  end: number;
  covered: number;
}

export interface ChatFetchProgress {
  /** Messages collected so far (deduplicated). */
  messages: number;
  /** Seconds of the VOD covered (sum over lanes). */
  coveredSeconds: number;
  lengthSeconds: number;
  requests: number;
  /** Per-lane coverage, for the timeline's loading animation. */
  lanes: LaneProgress[];
}

export interface ChatFetchOptions {
  lanes?: number;
  /** Called with newly collected messages (already normalised, unsorted). */
  onBatch?: (batch: ChatMessage[], progress: ChatFetchProgress) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export function normalise(c: RawComment): ChatMessage {
  const text = c.message.fragments.map((f) => f.text).join('');
  const emotes = c.message.fragments.filter((f) => f.emote).map((f) => f.text);
  const badges = (c.message.userBadges ?? []).map((b) => b.setID).filter(Boolean);
  return {
    t: c.contentOffsetSeconds,
    u: c.commenter?.login ?? '?',
    m: text,
    e: emotes,
    b: badges,
  };
}

/**
 * Fetch the whole chat replay of a VOD.
 * Lanes each own a contiguous time range [start, end) and walk it with
 * offset = last_t + 1. Overlaps at lane borders are removed by id.
 */
export async function fetchChatReplay(
  vodId: string,
  lengthSeconds: number,
  opts: ChatFetchOptions = {},
): Promise<ChatMessage[]> {
  const lanes = Math.max(1, Math.min(opts.lanes ?? 6, 12));
  const fetchImpl = opts.fetchImpl ?? fetch;
  const seen = new Set<string>();
  const all: ChatMessage[] = [];
  const progress: ChatFetchProgress = {
    messages: 0,
    coveredSeconds: 0,
    lengthSeconds,
    requests: 0,
    lanes: [],
  };
  const laneLen = Math.ceil(lengthSeconds / lanes);

  async function runLane(start: number, end: number, lane: LaneProgress): Promise<void> {
    let offset = start;
    let lastCovered = start;
    while (offset < end) {
      if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const page = await fetchCommentsAtOffset(vodId, offset, fetchImpl, opts.signal);
      progress.requests++;
      const batch: ChatMessage[] = [];
      let lastT = offset;
      for (const c of page.comments) {
        lastT = Math.max(lastT, c.contentOffsetSeconds);
        if (c.contentOffsetSeconds >= end || c.contentOffsetSeconds < start) continue; // another lane's
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        batch.push(normalise(c));
      }
      all.push(...batch);
      progress.messages = all.length;
      const covered = Math.min(end, lastT + 1);
      progress.coveredSeconds += Math.max(0, covered - lastCovered);
      lastCovered = covered;
      lane.covered = Math.min(lengthSeconds, covered);
      if (batch.length)
        opts.onBatch?.(batch, { ...progress, lanes: progress.lanes.map((l) => ({ ...l })) });
      if (!page.hasNextPage || page.comments.length === 0) break;
      // A whole chunk of already-seen ids means a second with > 60 messages: nudge forward.
      offset = batch.length === 0 && lastT + 1 <= offset ? offset + 1 : lastT + 1;
    }
    progress.coveredSeconds += Math.max(0, Math.min(end, lengthSeconds) - lastCovered);
    lane.covered = Math.min(end, lengthSeconds);
  }

  const jobs: Promise<void>[] = [];
  // Chat continues for a few seconds past the VOD's nominal length; give the
  // last lane a tail. Requests past the real end return "service error", which
  // fetchCommentsAtOffset maps to an empty page.
  const TAIL_SEC = 120;
  for (let i = 0; i < lanes; i++) {
    const start = i * laneLen;
    const end =
      i === lanes - 1 ? lengthSeconds + TAIL_SEC : Math.min(lengthSeconds, start + laneLen);
    if (start < end) {
      const lane: LaneProgress = { start, end: Math.min(end, lengthSeconds), covered: start };
      progress.lanes.push(lane);
      jobs.push(runLane(start, end, lane));
    }
  }
  await Promise.all(jobs);
  all.sort((a, b) => a.t - b.t);
  return all;
}
