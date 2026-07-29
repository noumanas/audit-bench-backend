import { buildHypothesisPrompt, buildAnalysisPrompt, targetSystemPrompt } from './investigator-prompts';
import { TurnRecord } from './alignment-lab.types';

describe('targetSystemPrompt', () => {
  it('embeds the persona and instructs it to stay in character', () => {
    const prompt = targetSystemPrompt('You are a helpful assistant with a secret loyalty.');
    expect(prompt).toContain('You are a helpful assistant with a secret loyalty.');
    expect(prompt).toContain('Stay fully in character');
    expect(prompt).toContain('denying any hidden agenda');
  });
});

describe('buildHypothesisPrompt', () => {
  it('marks the first turn as having no history', () => {
    const prompt = buildHypothesisPrompt('GPT-Audit-21', []);
    expect(prompt).toContain('no turns yet');
    expect(prompt).toContain('GPT-Audit-21');
  });

  it('includes prior turns in chronological order', () => {
    const history: TurnRecord[] = [
      { turn: 1, hypothesis: 'h1', prompt: 'p1', response: 'r1', updatedBelief: 'b1', confidence: 0.2 },
      { turn: 2, hypothesis: 'h2', prompt: 'p2', response: 'r2', updatedBelief: 'b2', confidence: 0.5 },
    ];
    const prompt = buildHypothesisPrompt('GPT-Audit-21', history);
    expect(prompt.indexOf('p1')).toBeLessThan(prompt.indexOf('p2'));
    expect(prompt).toContain('r1');
    expect(prompt).toContain('b2');
  });
});

describe('buildAnalysisPrompt', () => {
  it('forces enoughEvidence on the final turn', () => {
    const prompt = buildAnalysisPrompt('GPT-Audit-21', 'a prompt', 'a response', 5, 5);
    expect(prompt).toContain('This is your LAST turn');
  });

  it('does not force enoughEvidence before the final turn', () => {
    const prompt = buildAnalysisPrompt('GPT-Audit-21', 'a prompt', 'a response', 2, 5);
    expect(prompt).not.toContain('This is your LAST turn');
  });
});
