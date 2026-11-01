import { findingFingerprint } from '../common/finding-fingerprint';
import { parseFindingComment } from './inline-comment';
import { PrFeedback, PrFeedbackFinding, RepeatStats } from './pr-feedback.types';

/** The parts of an existing pull request comment the filter needs. */
export interface ExistingComment {
  id: number;
  in_reply_to_id?: number;
  body: string;
  path: string;
  reactions?: { '+1'?: number; '-1'?: number };
}

/** open: still visible; changed: its lines changed but it wasn't settled; fixed / dismissed: settled. */
type PriorState = 'open' | 'changed' | 'dismissed' | 'fixed';

export interface RepeatFilterResult {
  /** Findings to post: new ones, plus repeats worth raising again (marked with `repeat`). */
  toPost: PrFeedbackFinding[];
  /** Findings already raised on this pull request that are still open, so not posted again. */
  alreadyOpen: number;
  /** Findings the team dismissed earlier on this pull request, so not posted again. */
  dismissed: number;
}

// Our own thread replies start with a status line (see thread-reply.ts formatAgentReply).
const REPLY_FIXED = /✅ Resolved/;
const REPLY_DISMISSED = /👍 (?:Dismissed|Agreed: not an issue)/;

/** "path|fingerprint": the same kind of finding in the same file, wherever its lines moved to. */
const keyOf = (path: string, f: { category?: string | null; title: string }) => `${path}|${findingFingerprint(f)}`;

/**
 * Keeps a re-review of an updated pull request from posting the same
 * findings again. Each finding is matched to earlier Audit Bench Ai comments
 * on the PR by file and fingerprint, never by line, because lines move
 * between commits. A match that is still open, or that the team dismissed
 * (👎, or a thread that ended "not an issue"), isn't posted again. Two kinds
 * are posted again, because there is new evidence: one marked fixed that is
 * detected again (a regression), and one whose lines changed in a later push
 * (GitHub collapses that comment as outdated) that is still detected.
 */
export function filterRepeatFindings(
  findings: PrFeedbackFinding[],
  comments: ExistingComment[],
  threadStates: Map<number, { resolved: boolean; outdated: boolean }>,
): RepeatFilterResult {
  const replies = new Map<number, string[]>();
  for (const c of comments) {
    if (c.in_reply_to_id) replies.set(c.in_reply_to_id, [...(replies.get(c.in_reply_to_id) ?? []), c.body]);
  }

  const prior = new Map<string, PriorState>();
  for (const c of comments) {
    if (c.in_reply_to_id) continue;
    const parsed = parseFindingComment(c.body);
    if (!parsed) continue;
    const ours = (replies.get(c.id) ?? []).filter((b) => b.includes('<!-- audit-bench:reply'));
    const lastStatus = ours[ours.length - 1] ?? '';
    const thread = threadStates.get(c.id);
    let state: PriorState = 'open';
    if ((c.reactions?.['-1'] ?? 0) > 0 || REPLY_DISMISSED.test(lastStatus)) state = 'dismissed';
    else if (REPLY_FIXED.test(lastStatus)) state = 'fixed';
    // Resolved by a person without a recheck: they settled it, so treat it as dismissed.
    else if (thread?.resolved) state = 'dismissed';
    else if (thread?.outdated) state = 'changed';
    const key = keyOf(c.path, parsed);
    // Several earlier comments of one kind: dismissal wins, then still-open.
    const rank: Record<PriorState, number> = { fixed: 0, changed: 1, open: 2, dismissed: 3 };
    const seen = prior.get(key);
    if (!seen || rank[state] > rank[seen]) prior.set(key, state);
  }

  const result: RepeatFilterResult = { toPost: [], alreadyOpen: 0, dismissed: 0 };
  for (const f of findings) {
    const state = prior.get(keyOf(f.path, f));
    if (state === 'open') result.alreadyOpen++;
    else if (state === 'dismissed') result.dismissed++;
    else if (state === 'fixed') result.toPost.push({ ...f, repeat: 'reappeared' });
    else if (state === 'changed') result.toPost.push({ ...f, repeat: 'still_present' });
    else result.toPost.push(f);
  }
  return result;
}

/**
 * The feedback to post once repeats are removed, with the counts every
 * publisher reports back (stored on the scan as prRepeatStats, for the
 * duplicate-rate metric).
 */
export function withoutRepeatFindings(
  feedback: PrFeedback,
  comments: ExistingComment[],
  threadStates: Map<number, { resolved: boolean; outdated: boolean }>,
): { feedback: PrFeedback; stats: RepeatStats } {
  const { toPost, alreadyOpen, dismissed } = filterRepeatFindings(feedback.findings, comments, threadStates);
  return {
    feedback: { ...feedback, findings: toPost, notRepeated: { open: alreadyOpen, dismissed } },
    stats: { posted: toPost.length, open: alreadyOpen, dismissed },
  };
}
