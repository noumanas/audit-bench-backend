/**
 * Review benchmark: runs every case in cases.ts through the real review
 * pipeline (local checks + AI, scoped to the changed lines like a PR review)
 * and reports catch rate and false alarms.
 *
 * It then replays contributor replies to findings (RECHECK_CASES) through the
 * thread recheck, scoring whether it withdraws a finding when the contributor
 * is right and holds it when not.
 *
 *   npm run benchmark            # real AI calls: one per case (~28)
 *   npm run benchmark -- --dry   # validate the cases only, no AI
 *   npm run benchmark -- --only semantic-unattributed,valid-explanation
 *                                # just these cases (review or recheck ids)
 *
 * Results are written to benchmark/results/<date>-<time>.md and .json, so
 * runs never overwrite each other (e.g. before and after a prompt change).
 */
import { NestFactory } from '@nestjs/core';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { PipelineService } from '../src/audit/pipeline.service';
import { LlmService } from '../src/llm/llm.service';
import { CaseResult, lineOf, scoreCase, scoreRecheck, summarize } from '../src/benchmark/score';
import { buildRecheckPrompt, codeWindow, recheckSchema } from '../src/webhooks/thread-reply';
import { BENCHMARK_CASES, RECHECK_CASES } from './cases';

function onlyIds(): Set<string> | null {
  const i = process.argv.indexOf('--only');
  if (i < 0) return null;
  const ids = (process.argv[i + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const known = new Set([...BENCHMARK_CASES.map((c) => c.id), ...RECHECK_CASES.map((c) => c.id)]);
  const unknown = ids.filter((id) => !known.has(id));
  if (!ids.length || unknown.length) throw new Error(`--only needs case ids. Unknown: ${unknown.join(', ') || '(none given)'}`);
  return new Set(ids);
}

async function main() {
  const dry = process.argv.includes('--dry');
  const only = onlyIds();
  const reviewCases = BENCHMARK_CASES.filter((c) => !only || only.has(c.id));
  const recheckCases = RECHECK_CASES.filter((c) => !only || only.has(c.id));
  for (const c of BENCHMARK_CASES) for (const b of c.bugs) lineOf(c.code, b.at); // throws on a broken case
  if (dry) {
    const bugs = BENCHMARK_CASES.reduce((n, c) => n + c.bugs.length, 0);
    console.log(
      `${BENCHMARK_CASES.length} cases OK (${bugs} seeded bugs, ${BENCHMARK_CASES.filter((c) => !c.bugs.length).length} clean), ${RECHECK_CASES.length} recheck cases. No AI calls made.`,
    );
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const pipeline = app.get(PipelineService);
  const provider = app.get(LlmService).resolveProvider();
  // A fresh cache key per run, so every case gets a real review rather than a cached one.
  const runKey = `benchmark-${Date.now()}`;

  const results: CaseResult[] = [];
  for (const c of reviewCases) {
    const { result } = await pipeline.run({
      filename: c.path,
      code: c.code,
      provider,
      changedLineRanges: c.changed,
      repoContext: 'Reviewing a pull request; only the changed lines are in scope.',
      relatedContext: c.context,
      rulesKey: runKey,
    });
    const r = scoreCase(c, result.findings);
    results.push(r);
    console.log(`${r.clean ? 'clean' : 'bug  '} ${c.id.padEnd(24)} caught ${r.caught.length}/${r.caught.length + r.missed.length}  false alarms ${r.falsePositives.length}`);
  }

  const llm = app.get(LlmService);
  const rechecks: ReturnType<typeof scoreRecheck>[] = [];
  for (const c of recheckCases) {
    const prompt = buildRecheckPrompt({
      path: c.path,
      start: c.start,
      end: c.end,
      outdated: false,
      headSha: 'benchmark',
      code: codeWindow(c.code, c.start, c.end, false),
      thread: [
        { author: 'auditbench', body: `<!-- audit-bench:finding -->\n${c.finding}`, fromAgent: true },
        { author: 'contributor', body: c.reply, fromAgent: false },
      ],
      tests: c.tests,
    });
    const { result } = await llm.completeStructured(provider, prompt, recheckSchema);
    const r = scoreRecheck(c, result.status);
    rechecks.push(r);
    console.log(`${r.passed ? 'pass ' : 'FAIL '} recheck ${c.id.padEnd(24)} got ${result.status}, expected ${c.expect.join(' or ')}`);
  }
  await app.close();

  const s = summarize(results);
  const date = new Date().toISOString().slice(0, 10);
  const file = `${date}-${new Date().toISOString().slice(11, 16).replace(':', '')}${only ? '-partial' : ''}`;
  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${file}.json`), JSON.stringify({ date, provider, summary: s, results, rechecks }, null, 2));
  const md = [
    `# Audit Bench Ai review benchmark, ${date}`,
    '',
    `Provider: ${provider}. ${reviewCases.length} pull request changes: ${s.bugs} seeded bugs and ${s.cleanCases} clean changes.`,
    '',
    `- **Catch rate:** ${s.caught}/${s.bugs} seeded bugs (${Math.round(s.catchRate * 100)}%)`,
    `- **False alarms on clean changes:** ${s.flaggedClean}/${s.cleanCases} (${Math.round(s.cleanFalseAlarmRate * 100)}%)`,
    `- **Medium-or-worse findings not matching a seeded bug:** ${s.falsePositives}`,
    '',
    'A bug counts as caught when a medium, high or critical finding lands within 3 lines of it.',
    '',
    '| Case | Result | Notes |',
    '| --- | --- | --- |',
    ...results.map(
      (r) =>
        `| ${r.title} | ${r.clean ? (r.falsePositives.length ? '⚠️ flagged' : '✅ clean') : r.missed.length ? '❌ missed' : '✅ caught'} | ${[...r.missed.map((m) => `missed: ${m}`), ...r.falsePositives.map((f) => `extra: ${f.title}`)].join('; ').replace(/\|/g, '\\|')} |`,
    ),
    '',
    `## Contributor replies: ${rechecks.filter((r) => r.passed).length}/${rechecks.length} judged correctly`,
    '',
    '| Case | Outcome | Expected |',
    '| --- | --- | --- |',
    ...rechecks.map((r) => `| ${r.title} | ${r.passed ? '✅' : '❌'} ${r.status} | ${r.expected.join(' or ')} |`),
  ].join('\n');
  fs.writeFileSync(path.join(outDir, `${file}.md`), md);
  console.log(`\nCatch rate ${Math.round(s.catchRate * 100)}% · false alarms on clean changes ${Math.round(s.cleanFalseAlarmRate * 100)}% · report: benchmark/results/${file}.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
