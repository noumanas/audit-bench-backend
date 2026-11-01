# Review engine

How AuditBench reviews code, and the rules that keep it to fewer, more accurate findings. Read this before changing prompts, Stage 1 rules, calibration or the PR publishing path.

## Pipeline

```
PR / scan file
  │
  ├─ Stage 1, local and free (src/audit/stage1)
  │    lint, type check, risky patterns, secret scan, complexity + nesting depth
  │    → deterministic findings
  │    → risky functions to send to the AI (risk-scorer.ts)
  │
  ├─ Context (PR reviews, src/analysis/related-context.ts)
  │    relatedContextFor: callers elsewhere in the repo that could break
  │    testContextFor:    test cases that exercise the changed functions,
  │                       or "no test mentions X"
  │
  ├─ Stage 2, one AI call per file (src/audit/stage2/focused-prompt.ts)
  │    PR: changed hunks + context.  Scan: risky functions only.
  │    The model returns findings with evidence, failure scenario, test evidence.
  │
  ├─ Calibration (src/audit/stage2/calibrate.ts), deterministic
  │    withhold < 0.4 confidence · cap critical/high under 0.6 at medium ·
  │    cap Maintainability/Architecture at medium · merge same-kind overlaps
  │
  ├─ Team rules: learned suppressions drop matching fingerprints
  │
  └─ Publish (GitHub: src/github/github.service.ts)
       filterRepeatFindings: skip findings already on the PR (open or dismissed),
       repost ones that came back after a fix or survived a change to their lines
            │
            └─ Contributor replies → recheck (src/webhooks/thread-reply.ts)
                 judged against current code + tests when the reply mentions tests
                 → resolved / confirmed / dismissed / downgraded / under review
                 → FindingFeedback → learned rules + review-quality metrics
```

One orchestrator with specialised rules, not one agent per category: a single structured call per file keeps cost predictable and lets calibration and dedup run on one list.

## Rules and where they live

| Concern | Rule | Where |
|---|---|---|
| Complexity | Branch count alone is never a finding. Stage 1 reports only nesting ≥ 4 levels, or ≥ 25 paths, and describes the evidence. Flat functions aren't sent to the AI for complexity alone. | `stage1/complexity.ts` (`maxNestingDepth`, thresholds), `stage1/to-findings.ts` (`complexityFinding`), `stage1/risk-scorer.ts` |
| Maintainability (AI) | Report unrelated jobs, duplicated logic, deep nesting or risky untested logic, never "split it" for flat branches. | `REVIEW_RULES` in `focused-prompt.ts` |
| Semantic accuracy | Flag model output, predictions or unverified data stated as fact when a user could be misled. Category `Semantic Accuracy`. | `REVIEW_RULES` |
| Test quality | Flag assertions that can pass for the wrong reason, with the failure scenario. Category `Testing`. | `REVIEW_RULES` |
| Evidence | Report only what the code shown proves; fill `evidence`, `failureScenario`, `testEvidence`. | `REVIEW_RULES`, `RESPONSE_SHAPE`, `common/finding.schema.ts` |
| Severity vs confidence | Set independently by the model, then capped by calibration. | `REVIEW_RULES`, `calibrate.ts` |
| Duplicates within a review | Same fingerprint, overlapping lines → keep the more confident. | `calibrate.ts` |
| Duplicates across commits | Match by file + fingerprint, never line numbers. | `pr-feedback/repeat-findings.ts` |
| Contributor replies | Judge claims by evidence; withdraw when right, hold when not; can downgrade. | `webhooks/thread-reply.ts` |

## Categories

Stored names are unchanged for the original six, so old reports, analytics and learned suppressions still match:

| Category | Stored as |
|---|---|
| Functional correctness | `Logic` |
| Test quality | `Testing` |
| Security, Performance, Architecture, Maintainability | as named |
| New | `Semantic Accuracy`, `Reliability`, `Data Integrity`, `API Design`, `Concurrency`, `Resource Management` |

Severity is `critical | high | medium | low | info`. `info` is an optional suggestion, and only PR reviews produce it (the scan prompt doesn't offer it, and the pipeline drops any outside a PR review). It is listed in a collapsed "Optional suggestions" section of the PR summary, never posted as a comment, and never changes the verdict. Keeping it out of audits and scans means clients that predate it (the VS Code extension, the CLI) never receive one. Teams can switch it off.

## Discussion lifecycle

| Recheck status | Lifecycle state | Thread on GitHub | Stored signal |
|---|---|---|---|
| `resolved` | Resolved | resolved | `resolved` (trains rules) |
| `not_an_issue` | Dismissed | resolved | `not_an_issue` (trains rules) |
| `still_applies` | Confirmed | open | `confirmed` (metrics only) |
| `downgraded` | Downgraded | open | `downgraded` (metrics only) |
| `needs_info` | Under review | open | none |

"Confirmed" and "downgraded" are the reviewer's judgment, not the team's, so they never train a suppression. "Open" is a finding with no reply yet. **Acknowledged** is a 👀 reaction or a human reply in the thread, recorded as the `acknowledged` signal (metrics only) when the PR closes, with the other reactions.

## Team strictness

`ReviewSettings` (one row per team or personal account, edited on the Rules page by owners/admins) sets `minConfidence`, `severeMinConfidence`, `deepNesting`, `veryHighComplexity` and `optionalSuggestions`; defaults and allowed ranges are in `common/review-thresholds.ts`. They load with the team's rules (`ReviewRulesService.rulesFor`), so non-default values change the rules key and the AI cache key. They apply to repository scans and PR reviews, where team rules apply; single-file audits use the defaults.

## Measuring quality

- `GET /review-rules/quality`: one team or user. `GET /admin/review-quality?days=90`: everyone.
- `precision` = accepted ÷ (accepted + dismissed) on closed PRs. Also acceptance, dismissal and ignored rates.
- `discussion.withdrawnRate`: share of disputed findings the recheck withdrew (high means first reviews overreach). `severityOverstatedRate`: share downgraded.
- `acknowledgedRate`: findings someone reacted 👀 to or replied on.
- `duplicates.duplicateRate`: of findings a review raised that were already on the PR, the share held back. Each publisher returns `{ posted, open, dismissed }`, stored on the scan as `prRepeatStats`.
- `volume`: reviews, findings per review, tokens per review and per finding.
- Shown on the Rules page (Review quality) and in the admin console (Review quality tab).

## Evaluation

- `npx jest src/audit/review-engine.spec.ts`: the deterministic scenarios (complexity judgment, calibration, test evidence, dedup across commits, recheck contract, metrics, schema compatibility). Runs in CI with no AI calls.
- `npm run benchmark -- --dry`: validates every benchmark case, no AI calls.
- `npm run benchmark`: real AI calls, about 28 (25 review cases + 3 contributor replies). Reports catch rate on seeded bugs, false alarms on clean controls, and whether replies were judged correctly, in `benchmark/results/<date>-<time>.md`. The JSON keeps every finding at any severity, so a miss can be diagnosed.
- `npm run benchmark -- --only id1,id2`: just those cases, one AI call each (report suffixed `-partial`).

First run (2026-11-01, Gemini): 15/16 seeded bugs caught, 0/9 false alarms on clean changes, 3/3 contributor replies judged correctly. The miss was `semantic-unattributed`; the semantic-accuracy rule now says a model judgment shown to users as fact is at least medium.

Benchmark cases added for this engine (`benchmark/cases.ts`):

| Case | Expected |
|---|---|
| `flat-mapper` | Clean: no medium+ finding |
| `mixed-responsibilities` | Catch: receipt tax differs from the tax charged |
| `semantic-unattributed` / `semantic-attributed` | Catch / clean |
| `doc-assertion-whole-doc` / `doc-assertion-section` | Catch / clean |
| `covered-edge-case` | Clean: tests shown cover it |
| `insufficient-evidence` | Clean: input goes through a helper the review can't see |
| `weak-test-regression` | Catch: assertion can't detect the wrong discount |
| recheck `valid-explanation` | `not_an_issue` |
| recheck `incorrect-explanation` | `still_applies` |
| recheck `unsupported-test-claim` | `still_applies` or `needs_info` |

## Cost

The rules add about 700 input tokens to each AI call (measured: PR prompt ~1,360 → ~2,100, scan prompt ~1,380 → ~2,070). The evidence fields add a few dozen output tokens per finding. Offsetting that: functions that are complex but flat no longer get an AI call in scans. Test evidence for a recheck downloads the repository (≤ 50 MB, as PR context already does) only when the contributor's reply mentions tests.

Changing prompts, calibration or Stage 1 findings: bump `REVIEW_ENGINE_VERSION` in `audit/cache.service.ts`, so cached results from the old rules aren't served. Bumping it costs one fresh AI call per previously cached file.

## Known limits

- No re-posting works on GitHub, GitLab and Bitbucket. GitLab doesn't expose outdated positions in its discussions API, so "still present after a change" is GitHub and Bitbucket only; GitLab findings posted as MR-level notes (outside the diff) have no file path and can't be matched.
- Test evidence is a text search for the changed function's name in test files. A test that reaches the code indirectly isn't found, and a common name can over-match.
- Repos over 50 MB get no caller or test context (unchanged from before).
- Default thresholds (0.4, 0.6) are a starting point. Tune them against `precision` and `withdrawnRate` once there's data; teams can tune their own.
- Acknowledgement and reactions are read from GitHub only.
