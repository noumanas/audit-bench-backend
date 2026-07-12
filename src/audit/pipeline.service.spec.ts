import { PipelineService } from './pipeline.service';
import { LlmService } from '../llm/llm.service';
import { AuditCacheService } from './cache.service';
import { Stage1Result } from './stage1/types';
import * as runStage1Module from './stage1/run-stage1';

// An explicit factory (not bare `jest.mock(path)`) — auto-mocking would need
// to load the real module to derive its shape, and that module's transitive
// chain hits prettier's ESM-only dynamic import, which Jest's default CJS
// environment can't execute. Supplying the shape ourselves avoids ever
// loading the real thing.
jest.mock('./stage1/run-stage1', () => ({ runStage1: jest.fn() }));

function makeStage1(overrides: Partial<Stage1Result> = {}): Stage1Result {
  return {
    lint: [],
    tsDiagnostics: [],
    formatted: true,
    formattingSkipped: false,
    semgrep: { skipped: true, reason: 'not configured' },
    functions: [],
    riskyFunctions: [],
    clean: true,
    ...overrides,
  };
}

/**
 * This is the highest-blast-radius decision in the whole cost model: get it
 * wrong one way and every audit silently costs money it shouldn't; get it
 * wrong the other way and Stage 1-only findings quietly replace real AI
 * review. Neither failure mode is visible from the API response shape, so
 * it's exactly the kind of bug this product's own review is built to catch
 * in *other* people's code — worth covering in its own.
 */
describe('PipelineService — Stage 1 → AI escalation', () => {
  let llm: { completeStructured: jest.Mock; hasEscalationModel: jest.Mock };
  let cache: { hashFor: jest.Mock; lookup: jest.Mock; store: jest.Mock };
  let pipeline: PipelineService;

  beforeEach(() => {
    jest.clearAllMocks();
    llm = {
      completeStructured: jest.fn(),
      hasEscalationModel: jest.fn().mockReturnValue(false),
    };
    cache = {
      hashFor: jest.fn().mockReturnValue('hash123'),
      lookup: jest.fn().mockResolvedValue(null),
      store: jest.fn().mockResolvedValue(undefined),
    };
    pipeline = new PipelineService(llm as unknown as LlmService, cache as unknown as AuditCacheService);
  });

  it('skips the AI call (and the quota gate) entirely when Stage 1 comes back clean', async () => {
    (runStage1Module.runStage1 as jest.Mock).mockResolvedValue(makeStage1({ clean: true }));
    const beforeAiCall = jest.fn();

    const { result, fromCache } = await pipeline.run(
      { filename: 'a.ts', code: 'const x = 1;', provider: 'openai' },
      { beforeAiCall },
    );

    expect(llm.completeStructured).not.toHaveBeenCalled();
    expect(beforeAiCall).not.toHaveBeenCalled();
    expect(result.aiInvoked).toBe(false);
    expect(fromCache).toBe(false);
    expect(cache.store).toHaveBeenCalledTimes(1);
  });

  it('escalates to a real AI call when Stage 1 flags something risky', async () => {
    (runStage1Module.runStage1 as jest.Mock).mockResolvedValue(makeStage1({ clean: false }));
    llm.completeStructured.mockResolvedValue({ verdict: 'needs_work', summary: 'found stuff', findings: [] });
    const beforeAiCall = jest.fn().mockResolvedValue(undefined);

    const { result } = await pipeline.run(
      { filename: 'a.ts', code: 'const x = 1;', provider: 'openai' },
      { beforeAiCall },
    );

    expect(beforeAiCall).toHaveBeenCalledTimes(1);
    expect(llm.completeStructured).toHaveBeenCalledTimes(1);
    expect(result.aiInvoked).toBe(true);
  });

  it('never touches the AI or the quota gate on a cache hit, even when Stage 1 would otherwise flag it', async () => {
    (runStage1Module.runStage1 as jest.Mock).mockResolvedValue(makeStage1({ clean: false }));
    cache.lookup.mockResolvedValue({ verdict: 'pass', summary: 'cached', findings: [], stage1: null, aiInvoked: false });
    const beforeAiCall = jest.fn();

    const { fromCache } = await pipeline.run(
      { filename: 'a.ts', code: 'const x = 1;', provider: 'openai' },
      { beforeAiCall },
    );

    expect(fromCache).toBe(true);
    expect(llm.completeStructured).not.toHaveBeenCalled();
    expect(beforeAiCall).not.toHaveBeenCalled();
  });

  it('propagates a quota rejection from beforeAiCall instead of spending on the LLM call', async () => {
    (runStage1Module.runStage1 as jest.Mock).mockResolvedValue(makeStage1({ clean: false }));
    const beforeAiCall = jest.fn().mockRejectedValue(new Error('quota exceeded'));

    await expect(
      pipeline.run({ filename: 'a.ts', code: 'const x = 1;', provider: 'openai' }, { beforeAiCall }),
    ).rejects.toThrow('quota exceeded');

    expect(llm.completeStructured).not.toHaveBeenCalled();
  });
});
