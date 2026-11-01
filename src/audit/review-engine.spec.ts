/**
 * Regression suite for the context-aware review engine (docs/review-engine.md):
 * the scenarios that can be checked without a model. The reasoning scenarios
 * (semantic accuracy, weak assertions, judging a contributor's explanation)
 * run against a real model in benchmark/run.ts.
 */
import { PipelineService } from './pipeline.service';
import { LlmService } from '../llm/llm.service';
import { AuditCacheService } from './cache.service';
import { Stage1Result } from './stage1/types';
import * as runStage1Module from './stage1/run-stage1';
import { splitFunctions } from './stage1/function-splitter';
import { complexityFinding } from './stage1/to-findings';
import { selectRiskyFunctions } from './stage1/risk-scorer';
import { calibrateFindings } from './stage2/calibrate';
import { buildDiffPrompt, buildFocusedPrompt } from './stage2/focused-prompt';
import { Finding } from '../common/types';
import { auditResultSchema } from '../common/finding.schema';
import { filterRepeatFindings, ExistingComment } from '../pr-feedback/repeat-findings';
import { inlineCommentBody, parseFindingComment } from '../pr-feedback/inline-comment';
import { PrFeedbackFinding } from '../pr-feedback/pr-feedback.types';
import { testContextFor } from '../analysis/related-context';
import { buildRecheckPrompt, formatAgentReply, recheckSchema } from '../webhooks/thread-reply';
import { reviewQuality } from '../review-rules/review-quality';
import { DEFAULT_THRESHOLDS } from '../common/review-thresholds';
import { withoutRepeatFindings } from '../pr-feedback/repeat-findings';
import { buildPlainSummary, buildSummaryBody } from '../pr-feedback/summary-comment';
import { pipelineRulesKey } from './pipeline.service';

jest.mock('./stage1/run-stage1', () => ({ runStage1: jest.fn() }));

const FLAT_MAPPER = `export function mapRow(row: any) {
  const story: any = { id: String(row.id) };
  if (row.subtitle) story.subtitle = row.subtitle.trim();
  if (row.author) story.author = row.author.trim();
  if (row.published_at) story.publishedAt = new Date(row.published_at);
  if (row.updated_at) story.updatedAt = new Date(row.updated_at);
  if (row.tags) story.tags = row.tags.split(',');
  if (row.image_url) story.imageUrl = row.image_url;
  if (row.word_count != null) story.wordCount = Number(row.word_count);
  if (row.section) story.section = row.section.toLowerCase();
  if (row.paywalled != null) story.paywalled = row.paywalled === 1;
  if (row.language) story.language = row.language;
  if (row.source_url) story.sourceUrl = row.source_url;
  return story;
}`;

const TANGLED = `export function settle(orders: any[], user: any) {
  for (const order of orders) {
    if (order.status === 'open') {
      if (user.balance > 0) {
        for (const line of order.lines) {
          if (line.refundable && line.qty > 0 && !line.locked) {
            if (line.price > user.balance) user.debt += line.price;
            else user.balance -= line.price;
          } else if (line.qty === 0 || !line.price) {
            order.flags.push('empty');
          }
        }
      }
    }
  }
}`;

const finding = (over: Partial<Finding> = {}): Finding => ({
  severity: 'medium',
  category: 'Logic',
  title: 'Refund can go negative',
  line: 10,
  endLine: null,
  description: 'd',
  rootCause: 'r',
  suggestedFix: 'f',
  examplePatch: null,
  confidence: 0.9,
  ...over,
});

describe('Scenario: complex function with justified branches', () => {
  const [fn] = splitFunctions(FLAT_MAPPER, 'map-row.ts');

  it('measures it as complex but flat', () => {
    expect(fn.complexity).toBeGreaterThan(10);
    expect(fn.maxNesting).toBe(1);
  });

  it('reports no maintainability finding and spends no AI call on it', () => {
    expect(complexityFinding(fn)).toBeNull();
    expect(selectRiskyFunctions([fn], [], 'src/narrator/map-row.ts')).toEqual([]);
  });
});

describe('Scenario: complex function that is genuinely hard to follow', () => {
  const [fn] = splitFunctions(TANGLED, 'settle.ts');

  it('reports deep nesting with the evidence, not a blanket "split it"', () => {
    const f = complexityFinding(fn);
    expect(fn.maxNesting).toBeGreaterThanOrEqual(4);
    expect(f).toMatchObject({ category: 'Maintainability', severity: 'low' });
    expect(f!.description).toContain(`${fn.maxNesting} levels deep`);
    expect(f!.suggestedFix).not.toMatch(/single responsibilit/i);
  });

  it('counts an else-if chain as one level, as a reader sees it', () => {
    const [chain] = splitFunctions(
      `function kind(x: number) { if (x < 0) return 'neg'; else if (x === 0) return 'zero'; else if (x < 10) return 'small'; else return 'big'; }`,
      'k.ts',
    );
    expect(chain.maxNesting).toBe(1);
  });
});

describe('Scenario: insufficient evidence (calibration)', () => {
  it('withholds a finding the model is guessing at', () => {
    const { findings, report } = calibrateFindings([finding({ confidence: 0.3 })]);
    expect(findings).toEqual([]);
    expect(report.unsupported).toBe(1);
  });

  it('keeps an unconfirmed security concern from becoming a high-severity defect', () => {
    const { findings } = calibrateFindings([finding({ category: 'Security', severity: 'critical', confidence: 0.5 })]);
    expect(findings[0].severity).toBe('medium');
  });

  it('never lets a maintainability point block a merge, however sure the model is', () => {
    const { findings } = calibrateFindings([finding({ category: 'Maintainability', severity: 'high', confidence: 0.95 })]);
    expect(findings[0].severity).toBe('medium');
  });

  it('leaves a confident, severe finding alone', () => {
    const f = finding({ category: 'Security', severity: 'critical', confidence: 0.92 });
    expect(calibrateFindings([f]).findings).toEqual([f]);
  });

  it('merges two findings of the same kind on overlapping lines, keeping the surer one', () => {
    const { findings, report } = calibrateFindings([
      finding({ line: 10, endLine: 14, confidence: 0.7 }),
      finding({ line: 12, confidence: 0.9 }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].confidence).toBe(0.9);
    expect(report.duplicates).toBe(1);
  });
});

describe('Pipeline applies calibration and recomputes the verdict', () => {
  const stage1: Stage1Result = {
    lint: [],
    python: [],
    tsDiagnostics: [],
    formatted: true,
    formattingSkipped: false,
    semgrep: { skipped: true, reason: 'n/a' },
    functions: [],
    riskyFunctions: [],
    clean: true,
  };

  it('a low-confidence critical no longer makes the verdict "do not ship"', async () => {
    (runStage1Module.runStage1 as jest.Mock).mockResolvedValue(stage1);
    const llm = {
      completeStructured: jest.fn().mockResolvedValue({
        result: {
          verdict: 'do_not_ship',
          summary: 's',
          findings: [finding({ category: 'Security', severity: 'critical', confidence: 0.5 })],
        },
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
      hasEscalationModel: jest.fn().mockReturnValue(false),
    };
    const cache = { hashFor: () => 'h', lookup: jest.fn().mockResolvedValue(null), store: jest.fn() };
    const pipeline = new PipelineService(llm as unknown as LlmService, cache as unknown as AuditCacheService);
    const { result } = await pipeline.run({
      filename: 'a.ts',
      code: 'const a = 1;',
      provider: 'gemini',
      changedLineRanges: [{ start: 1, end: 1 }],
    });
    expect(result.findings[0].severity).toBe('medium');
    expect(result.verdict).toBe('needs_work');
  });
});

describe('Scenario: existing tests cover the reported scenario (test evidence)', () => {
  const changed = {
    path: 'src/users/display-name.ts',
    content: 'export function displayName(u: any) {\n  return u.name || u.email || "Anonymous";\n}',
    changedRanges: [{ start: 2, end: 2 }],
  };

  it('lists the test cases that exercise the changed function', () => {
    const ctx = testContextFor(changed, [
      {
        path: 'src/users/display-name.test.ts',
        content: "describe('displayName', () => {\n  it('falls back to Anonymous', () => {\n    expect(displayName({})).toBe('Anonymous');\n  });\n});",
      },
    ]);
    expect(ctx).toContain('`displayName` is exercised by:');
    expect(ctx).toContain("src/users/display-name.test.ts:2 | it('falls back to Anonymous'");
  });

  it('says so when no test mentions the change, so coverage can be raised without guessing', () => {
    const ctx = testContextFor(changed, [{ path: 'src/other.test.ts', content: "it('x', () => {});" }]);
    expect(ctx).toBe('A text search of the repository\'s test files found no test mentioning: `displayName`.');
  });

  it('gives nothing for a change to a test file itself', () => {
    expect(testContextFor({ ...changed, path: 'src/users/display-name.test.ts' }, [])).toBe('');
  });
});

describe('Prompts carry the review rules', () => {
  const diff = buildDiffPrompt({
    filename: 'a.ts',
    code: 'const a = 1;',
    changedRanges: [{ start: 1, end: 1 }],
    relatedContext: 'Tests in the repository that exercise the changed code (test case titles):\n`a` is exercised by: x',
  });
  const focused = buildFocusedPrompt({ filename: 'a.ts', riskyFunctions: [], allFunctions: [] });

  it.each([
    ['evidence before every finding', /Evidence before every finding/],
    ['severity and confidence are independent', /Set them independently/],
    ['flat branches are not a maintainability problem', /branch count alone is not a problem/],
    ['semantic accuracy', /labelled favorable by the model/],
    ['test quality with a failure scenario', /what broken code would still pass/],
    ['new categories', /"Semantic Accuracy" \| "Reliability"/],
    ['evidence fields', /"failureScenario"/],
  ])('%s', (_name, re) => {
    expect(diff).toMatch(re);
    expect(focused).toMatch(re);
  });

  it('PR reviews use listed tests as evidence', () => {
    expect(diff).toContain('use them as evidence');
    expect(diff).toContain('`a` is exercised by');
  });
});

describe('Finding schema stays backward compatible', () => {
  it('accepts a result stored before the evidence fields existed', () => {
    const old = { verdict: 'pass', summary: 's', findings: [{ ...finding(), category: 'Testing' }] };
    expect(auditResultSchema.safeParse(old).success).toBe(true);
  });

  it('accepts the new categories and evidence', () => {
    const now = {
      verdict: 'needs_work',
      summary: 's',
      findings: [
        { ...finding(), category: 'Semantic Accuracy', evidence: 'line 7', failureScenario: 'x', testEvidence: null },
      ],
    };
    expect(auditResultSchema.safeParse(now).success).toBe(true);
  });
});

const prFinding = (over: Partial<PrFeedbackFinding> = {}): PrFeedbackFinding => ({
  path: 'src/a.ts',
  line: 10,
  severity: 'medium',
  title: 'Refund can go negative',
  description: 'd',
  category: 'Logic',
  ...over,
});

describe('PR comments show evidence and round-trip every category', () => {
  it('includes the failure scenario and test evidence', () => {
    const body = inlineCommentBody(prFinding({ failureScenario: 'paid 5, used 9 → -4', testEvidence: 'none shown' }));
    expect(body).toContain('**When it breaks:** paid 5, used 9 → -4');
    expect(body).toContain('**Tests:** none shown');
  });

  it.each(['Semantic Accuracy', 'Data Integrity', 'Resource Management', 'Logic'])(
    'reads %s back out of its own comment',
    (category) => {
      expect(parseFindingComment(inlineCommentBody(prFinding({ category })))).toEqual({
        category,
        title: 'Refund can go negative',
      });
    },
  );
});

describe('Scenario: same issue reported across multiple commits', () => {
  let nextId = 1;
  const root = (f: PrFeedbackFinding, over: Partial<ExistingComment> = {}): ExistingComment => ({
    id: nextId++,
    path: f.path,
    body: inlineCommentBody(f),
    ...over,
  });
  const reply = (to: ExistingComment, status: string): ExistingComment => ({
    id: nextId++,
    in_reply_to_id: to.id,
    path: to.path,
    body: `<!-- audit-bench:reply -->\n**${status}**\n\nok`,
  });
  const states = (entries: Array<[number, { resolved: boolean; outdated: boolean }]> = []) => new Map(entries);

  it('does not repost an open finding, even after its lines moved', () => {
    const earlier = root(prFinding({ line: 10 }));
    const r = filterRepeatFindings([prFinding({ line: 42 })], [earlier], states());
    expect(r.toPost).toEqual([]);
    expect(r.alreadyOpen).toBe(1);
  });

  it('matches by kind of finding, not exact wording of identifiers', () => {
    const earlier = root(prFinding({ title: '`userId` is never checked' }));
    const r = filterRepeatFindings([prFinding({ title: '`orgId` is never checked' })], [earlier], states());
    expect(r.toPost).toEqual([]);
  });

  it('never reposts what the team dismissed, by 👎 or by discussion', () => {
    const byReaction = root(prFinding(), { reactions: { '-1': 1 } });
    const other = prFinding({ path: 'src/b.ts' });
    const byThread = root(other);
    const r = filterRepeatFindings(
      [prFinding(), other],
      [byReaction, byThread, reply(byThread, '👍 Dismissed: agreed, not an issue here')],
      states(),
    );
    expect(r.toPost).toEqual([]);
    expect(r.dismissed).toBe(2);
  });

  it('posts a finding again, flagged, when it comes back after a fix', () => {
    const earlier = root(prFinding());
    const r = filterRepeatFindings(
      [prFinding()],
      [earlier, reply(earlier, '✅ Resolved: the fix is in')],
      states([[earlier.id, { resolved: true, outdated: true }]]),
    );
    expect(r.toPost).toEqual([expect.objectContaining({ repeat: 'reappeared' })]);
    expect(inlineCommentBody(r.toPost[0])).toContain('marked fixed earlier');
  });

  it('posts again when the lines changed but the issue is still there', () => {
    const earlier = root(prFinding());
    const r = filterRepeatFindings([prFinding()], [earlier], states([[earlier.id, { resolved: false, outdated: true }]]));
    expect(r.toPost).toEqual([expect.objectContaining({ repeat: 'still_present' })]);
  });

  it('posts new findings normally, including the same kind in another file', () => {
    const earlier = root(prFinding());
    const r = filterRepeatFindings([prFinding({ path: 'src/other.ts' })], [earlier], states());
    expect(r.toPost).toEqual([prFinding({ path: 'src/other.ts' })]);
  });
});

describe('Scenario: contributor explains (recheck contract)', () => {
  const prompt = buildRecheckPrompt({
    path: 'a.ts',
    start: 1,
    end: 3,
    outdated: false,
    headSha: 'abcdef1234',
    code: '1 | x',
    thread: [
      { author: 'bot', body: 'finding', fromAgent: true },
      { author: 'dev', body: 'covered by tests', fromAgent: false },
    ],
    tests: '`mapRow` is exercised by:\nmap-row.test.ts:8 | it(...)',
  });

  it('asks for an evidence-based judgment, not deference either way', () => {
    expect(prompt).toContain('Judge the explanation by evidence');
    expect(prompt).toContain("don't defend a mistaken finding");
    expect(prompt).toContain("Don't accept one the evidence contradicts");
  });

  it('shows the tests the contributor is talking about', () => {
    expect(prompt).toContain('`mapRow` is exercised by:');
  });

  it('supports downgrading a finding whose severity was overstated', () => {
    const parsed = recheckSchema.parse({ status: 'downgraded', reply: 'Real, but low impact.', severity: 'low' });
    expect(formatAgentReply(parsed, 'abcdef1234', false)).toContain('↘️ Downgraded: valid, but less serious than first reported (now Low)');
  });

  it('still accepts the original four outcomes', () => {
    for (const status of ['resolved', 'still_applies', 'not_an_issue', 'needs_info']) {
      expect(recheckSchema.safeParse({ status, reply: 'x' }).success).toBe(true);
    }
  });
});

describe('Review quality metrics', () => {
  it('measures precision and overstated severity, not finding count', () => {
    const q = reviewQuality(
      {
        outcome: { accepted: 6, dismissed: 2, ignored: 2 },
        thread: { not_an_issue: 1, confirmed: 2, downgraded: 1, resolved: 3 },
        reaction: { up: 4 },
      },
      { reviews: 4, findings: 20, inputTokens: 30_000, outputTokens: 10_000 },
    );
    expect(q.precision).toBe(0.75);
    expect(q.dismissalRate).toBe(0.2);
    expect(q.discussion).toMatchObject({ withdrawn: 1, upheld: 2, downgraded: 1, withdrawnRate: 0.25, severityOverstatedRate: 0.25 });
    expect(q.volume).toMatchObject({ findingsPerReview: 5, tokensPerReview: 10_000, tokensPerFinding: 2_000 });
  });

  it('reports null rates when there is nothing to measure yet', () => {
    const q = reviewQuality({}, { reviews: 0, findings: 0, inputTokens: 0, outputTokens: 0 });
    expect(q.precision).toBeNull();
    expect(q.volume.tokensPerReview).toBeNull();
  });
});

// ---------- Team thresholds, optional suggestions, all hosts, acknowledgement ----------


describe('Per-team thresholds', () => {
  it('a stricter team withholds findings the default would publish', () => {
    const f = finding({ confidence: 0.5 });
    expect(calibrateFindings([f]).findings).toHaveLength(1);
    expect(calibrateFindings([f], { ...DEFAULT_THRESHOLDS, minConfidence: 0.6 }).findings).toHaveLength(0);
  });

  it('a team can make Stage 1 flag shallower nesting', () => {
    const [fn] = splitFunctions(TANGLED.replace('&& !line.locked', '&& !line.locked && !line.void'), 'settle.ts');
    const shallow = { ...fn, maxNesting: 3 };
    expect(complexityFinding(shallow)).toBeNull();
    expect(complexityFinding(shallow, { ...DEFAULT_THRESHOLDS, deepNesting: 3 })).not.toBeNull();
  });

  it('changes the cache key only when a team departs from the defaults', () => {
    expect(pipelineRulesKey({ thresholds: DEFAULT_THRESHOLDS })).toBeUndefined();
    expect(pipelineRulesKey({ thresholds: { ...DEFAULT_THRESHOLDS, minConfidence: 0.5 } })).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('Optional ("info") suggestions', () => {
  const run = async (opts: { pr: boolean; optionalSuggestions?: boolean }) => {
    (runStage1Module.runStage1 as jest.Mock).mockResolvedValue({
      lint: [],
      python: [],
      tsDiagnostics: [],
      formatted: true,
      formattingSkipped: false,
      semgrep: { skipped: true, reason: 'n/a' },
      functions: [],
      riskyFunctions: [{ fn: { name: 'f', startLine: 1, endLine: 1, code: 'x', complexity: 1, callsInFile: [] }, score: 5, reasons: ['eval()'] }],
      clean: false,
    });
    const llm = {
      completeStructured: jest.fn().mockResolvedValue({
        result: { verdict: 'pass', summary: 's', findings: [finding({ severity: 'info', confidence: 0.9 })] },
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
      hasEscalationModel: () => false,
    };
    const cache = { hashFor: () => 'h', lookup: jest.fn().mockResolvedValue(null), store: jest.fn() };
    const pipeline = new PipelineService(llm as unknown as LlmService, cache as unknown as AuditCacheService);
    const { result } = await pipeline.run({
      filename: 'a.ts',
      code: 'x',
      provider: 'gemini',
      ...(opts.pr ? { changedLineRanges: [{ start: 1, end: 1 }] } : {}),
      thresholds: { ...DEFAULT_THRESHOLDS, optionalSuggestions: opts.optionalSuggestions ?? true },
    });
    return result;
  };

  it('are kept on PR reviews and never change the verdict', async () => {
    const result = await run({ pr: true });
    expect(result.findings.map((f) => f.severity)).toEqual(['info']);
    expect(result.verdict).toBe('pass');
  });

  it('never reach audits or scans, so older clients never see one', async () => {
    expect((await run({ pr: false })).findings).toEqual([]);
  });

  it('are dropped when the team turns them off', async () => {
    expect((await run({ pr: true, optionalSuggestions: false })).findings).toEqual([]);
  });

  it('appear in the summary, collapsed, and not as findings', () => {
    const feedback = {
      verdict: 'pass' as const,
      summary: 's',
      findings: [],
      suggestions: [prFinding({ severity: 'info', title: 'Name the magic number', suggestedFix: 'Use a constant.' })],
    };
    expect(buildSummaryBody(feedback)).toContain('💡 Optional suggestions (1)');
    expect(buildSummaryBody(feedback)).toContain('**Name the magic number**. Use a constant.');
    expect(buildPlainSummary(feedback)).toContain('**Optional suggestions** (no action needed)');
  });
});

describe('No re-posting on every host', () => {
  it('recognises our plain Bitbucket comments, which carry no hidden marker', () => {
    const body = inlineCommentBody(prFinding(), { plain: true, viaUserAccount: true });
    expect(body).not.toContain('<!--');
    expect(parseFindingComment(body)).toEqual({ category: 'Logic', title: 'Refund can go negative' });
    expect(parseFindingComment('**Some** | other | bot comment')).toBeNull();
  });

  it('reports what it held back, for the duplicate-rate metric, and says so in the summary', () => {
    const earlier = { id: 1, path: 'src/a.ts', body: inlineCommentBody(prFinding(), { plain: true, viaUserAccount: true }) };
    const { feedback, stats } = withoutRepeatFindings(
      { verdict: 'needs_work', summary: 's', findings: [prFinding(), prFinding({ path: 'src/b.ts' })] },
      [earlier],
      new Map([[1, { resolved: false, outdated: false }]]),
    );
    expect(stats).toEqual({ posted: 1, open: 1, dismissed: 0 });
    expect(buildPlainSummary(feedback)).toContain('_Not repeated: 1 still open from an earlier review._');
  });
});

describe('Quality metrics: acknowledgement and duplicates', () => {
  it('measures acknowledgement and how often repeats were held back', () => {
    const q = reviewQuality(
      { outcome: { accepted: 3, dismissed: 1 }, reaction: { acknowledged: 2 } },
      { reviews: 2, findings: 8, inputTokens: 0, outputTokens: 0, repeats: { posted: 6, open: 3, dismissed: 1 } },
    );
    expect(q.acknowledgedRate).toBe(0.5);
    expect(q.duplicates.duplicateRate).toBe(0.4);
  });
});
