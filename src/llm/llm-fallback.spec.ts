import { z } from 'zod';
import { LlmService } from './llm.service';

describe('LlmService backup provider', () => {
  const make = (env: Record<string, string>, openai: jest.Mock, gemini: jest.Mock) => {
    const other = { complete: jest.fn() };
    return new LlmService(
      { get: (k: string) => env[k] } as never,
      other as never,
      { complete: openai } as never,
      { complete: gemini } as never,
      other as never,
      other as never,
      other as never,
      other as never,
      other as never,
      other as never,
      other as never,
    );
  };
  const outOfCredits = () => jest.fn().mockRejectedValue(new Error('OpenAI API error (429): credit_balance_exhausted'));
  const ok = () => jest.fn().mockResolvedValue({ text: '{"ok":true}', usage: { inputTokens: 1, outputTokens: 1 } });

  it('uses LLM_FALLBACK_PROVIDER when the default provider fails', async () => {
    const gemini = ok();
    const llm = make({ LLM_FALLBACK_PROVIDER: 'gemini' }, outOfCredits(), gemini);
    const { result } = await llm.completeStructured('openai', 'Return json', z.object({ ok: z.boolean() }));
    expect(result).toEqual({ ok: true });
    expect(gemini).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ jsonMode: true }));
  });

  it('fails as before when no backup is set', async () => {
    const llm = make({}, outOfCredits(), ok());
    await expect(llm.completeText('openai', 'hi')).rejects.toThrow(/credit_balance_exhausted/);
  });
});
