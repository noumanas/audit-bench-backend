/** Why a file's review failed, in words a user can act on (never the provider's raw response). */
export function reviewFailureReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/insufficient_quota|credit_balance_exhausted|no credits remaining|billing/i.test(message)) {
    return 'the AI provider account has run out of credits. Add credits (or switch provider) and run the review again.';
  }
  if (/RESOURCE_EXHAUSTED.*(quota|billing)|exceeded your current quota/i.test(message)) {
    return 'the AI provider account has used up its quota. Raise the quota or enable billing, then run the review again.';
  }
  if (/\(401\)|invalid.*api key|incorrect api key|API_KEY_INVALID|API key not valid/i.test(message)) {
    return "the AI provider rejected the API key. Check the key in the server's settings.";
  }
  if (/\(429\)|rate limit/i.test(message)) return 'the AI provider is rate limiting requests. Try again in a minute.';
  if (/\(5\d\d\)|timeout|timed out|ECONNRESET|fetch failed/i.test(message)) {
    return 'the AI provider was unavailable. Try again shortly.';
  }
  return 'the AI provider returned an error.';
}
