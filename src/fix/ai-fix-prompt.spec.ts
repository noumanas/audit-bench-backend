import { buildAiFixPrompt, buildAiFixAllPrompt, aiFixResultSchema } from './ai-fix-prompt';
import { Finding } from '../common/finding.schema';

const FINDING: Finding = {
  severity: 'high',
  category: 'Security',
  title: 'Missing ownership check',
  line: 42,
  description: 'Any authenticated user can cancel any order.',
  rootCause: 'The handler never compares the order\'s owner to the requester.',
  suggestedFix: 'Compare order.ownerId to the session user before allowing the cancel.',
  examplePatch: null,
  confidence: 0.9,
};

describe('aiFixResultSchema', () => {
  it('requires reasoning alongside fixedCode and explanation', () => {
    expect(() => aiFixResultSchema.parse({ fixedCode: 'x', explanation: 'y' })).toThrow();
    expect(() =>
      aiFixResultSchema.parse({ reasoning: 'because...', fixedCode: 'x', explanation: 'y' }),
    ).not.toThrow();
  });
});

describe('buildAiFixPrompt', () => {
  const prompt = buildAiFixPrompt({ filename: 'orders.ts', language: 'typescript', code: 'const x = 1;', finding: FINDING });

  it('asks for reasoning before fixedCode in the response shape', () => {
    expect(prompt.indexOf('"reasoning"')).toBeGreaterThan(-1);
    expect(prompt.indexOf('"reasoning"')).toBeLessThan(prompt.indexOf('"fixedCode"'));
  });

  it('includes a self-verification step against the finding scenario', () => {
    expect(prompt).toMatch(/can still happen/i);
  });

  it('treats the suggested fix as a hint, not a literal recipe', () => {
    expect(prompt).toContain('not a literal recipe to copy verbatim');
  });
});

describe('buildAiFixAllPrompt', () => {
  const prompt = buildAiFixAllPrompt({
    filename: 'orders.ts',
    language: 'typescript',
    code: 'const x = 1;',
    findings: [FINDING, { ...FINDING, title: 'Second issue' }],
  });

  it('lists every finding and requires all of them resolved', () => {
    expect(prompt).toContain('Missing ownership check');
    expect(prompt).toContain('Second issue');
    expect(prompt).toContain('all 2 must be resolved');
  });

  it('asks for per-finding reasoning before committing to a final answer', () => {
    expect(prompt).toContain('go finding-by-finding');
    expect(prompt.indexOf('"reasoning"')).toBeLessThan(prompt.indexOf('"fixedCode"'));
  });
});
