/**
 * Review benchmark: runs every case in cases.ts through the real review
 * pipeline (local checks + AI, scoped to the changed lines like a PR review)
 * and reports catch rate and false alarms.
 *
 *   npm run benchmark            # real AI calls: one per case (~16)
 *   npm run benchmark -- --dry   # validate the cases only, no AI
 *
 * Results are written to benchmark/results/<date>.md and .json.
 */
import { NestFactory } from '@nestjs/core';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { PipelineService } from '../src/audit/pipeline.service';
import { LlmService } from '../src/llm/llm.service';
import { CaseResult, lineOf, scoreCase, summarize } from '../src/benchmark/score';
import { BENCHMARK_CASES } from './cases';

async function main() {
  const dry = process.argv.includes('--dry');
  for (const c of BENCHMARK_CASES) for (const b of c.bugs) lineOf(c.code, b.at); // throws on a broken case
  if (dry) {
    const bugs = BENCHMARK_CASES.reduce((n, c) => n + c.bugs.length, 0);
    console.log(`${BENCHMARK_CASES.length} cases OK (${bugs} seeded bugs, ${BENCHMARK_CASES.filter((c) => !c.bugs.length).length} clean). No AI calls made.`);
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const pipeline = app.get(PipelineService);
  const provider = app.get(LlmService).resolveProvider();
  // A fresh cache key per run, so every case gets a real review rather than a cached one.
  const runKey = `benchmark-${Date.now()}`;

  const results: CaseResult[] = [];
  for (const c of BENCHMARK_CASES) {
    const { result } = await pipeline.run({
      filename: c.path,
      code: c.code,
      provider,
      changedLineRanges: c.changed,
      repoContext: 'Reviewing a pull request; only the changed lines are in scope.',
      rulesKey: runKey,
    });
    const r = scoreCase(c, result.findings);
    results.push(r);
    console.log(`${r.clean ? 'clean' : 'bug  '} ${c.id.padEnd(24)} caught ${r.caught.length}/${r.caught.length + r.missed.length}  false alarms ${r.falsePositives.length}`);
  }
  await app.close();

  const s = summarize(results);
  const date = new Date().toISOString().slice(0, 10);
  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${date}.json`), JSON.stringify({ date, provider, summary: s, results }, null, 2));
  const md = [
    `# Audit Bench Ai review benchmark, ${date}`,
    '',
    `Provider: ${provider}. ${BENCHMARK_CASES.length} pull request changes: ${s.bugs} seeded bugs and ${s.cleanCases} clean changes.`,
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
  ].join('\n');
  fs.writeFileSync(path.join(outDir, `${date}.md`), md);
  console.log(`\nCatch rate ${Math.round(s.catchRate * 100)}% · false alarms on clean changes ${Math.round(s.cleanFalseAlarmRate * 100)}% · report: benchmark/results/${date}.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
