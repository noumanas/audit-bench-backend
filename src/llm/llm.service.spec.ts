import { z } from 'zod';
import { LlmService } from './llm.service';
import { CompleteOptions, CompleteResult, LlmProvider } from './llm-provider.interface';

function fakeProvider(respond: (prompt: string, opts?: CompleteOptions) => CompleteResult): LlmProvider {
  return {
    name: 'fake',
    complete: jest.fn(async (prompt: string, opts?: CompleteOptions) => respond(prompt, opts)),
  };
}

const SCHEMA = z.object({ answer: z.string() });

/**
 * This is what stood between "works locally against Anthropic" and a live
 * 400 against OpenAI (see the "'messages' must contain the word 'json'"
 * error this was written to fix) — completeStructured has to guarantee the
 * literal word "json" reaches the provider whenever it turns jsonMode on,
 * regardless of whether the caller's own prompt happened to mention it.
 */
describe('LlmService.completeStructured', () => {
  function buildService(provider: LlmProvider) {
    const config = { get: () => undefined } as never;
    const service = new LlmService(
      config,
      provider as never,
      provider as never,
      provider as never,
      provider as never,
      provider as never,
      provider as never,
      provider as never,
      provider as never,
      provider as never,
      provider as never,
    );
    return service;
  }

  it('appends a JSON reminder when the prompt does not already mention json', async () => {
    let seenPrompt = '';
    const provider = fakeProvider((prompt) => {
      seenPrompt = prompt;
      return { text: JSON.stringify({ answer: 'ok' }), usage: { inputTokens: 1, outputTokens: 1 } };
    });
    const service = buildService(provider);

    await service.completeStructured('anthropic', 'Describe the bug you found.', SCHEMA);

    expect(seenPrompt).toMatch(/json/i);
    expect(seenPrompt).toContain('Respond with a JSON object.');
  });

  it('does not duplicate the reminder when the prompt already mentions json', async () => {
    let seenPrompt = '';
    const provider = fakeProvider((prompt) => {
      seenPrompt = prompt;
      return { text: JSON.stringify({ answer: 'ok' }), usage: { inputTokens: 1, outputTokens: 1 } };
    });
    const service = buildService(provider);

    await service.completeStructured('anthropic', 'Return ONLY a JSON object with your answer.', SCHEMA);

    expect(seenPrompt).not.toContain('Respond with a JSON object.');
  });

  it('always sets jsonMode on the provider call, never left to the caller', async () => {
    const provider = fakeProvider(() => ({
      text: JSON.stringify({ answer: 'ok' }),
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    const service = buildService(provider);

    await service.completeStructured('anthropic', 'Return json.', SCHEMA);

    expect(provider.complete).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ jsonMode: true }));
  });
});
