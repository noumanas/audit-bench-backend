import { reviewFailureReason } from './review-failure';

describe('reviewFailureReason', () => {
  it('turns provider errors into something a user can act on', () => {
    expect(
      reviewFailureReason(
        new Error('OpenAI API error (429): {"error":{"type":"insufficient_quota","code":"credit_balance_exhausted"}}'),
      ),
    ).toMatch(/run out of credits/);
    expect(reviewFailureReason(new Error('OpenAI API error (401): Incorrect API key provided'))).toMatch(/API key/);
    expect(reviewFailureReason(new Error('OpenAI API error (429): Rate limit reached'))).toMatch(/rate limiting/);
    expect(reviewFailureReason(new Error('OpenAI API error (503): overloaded'))).toMatch(/unavailable/);
    expect(
      reviewFailureReason(
        new Error(
          'Gemini API error (429): {"status":"RESOURCE_EXHAUSTED","message":"You exceeded your current quota"}',
        ),
      ),
    ).toMatch(/used up its quota/);
    expect(reviewFailureReason(new Error('Gemini API error (400): API key not valid. API_KEY_INVALID'))).toMatch(
      /API key/,
    );
    expect(reviewFailureReason(new Error('something else entirely'))).toBe('the AI provider returned an error.');
  });
});
