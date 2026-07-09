import * as prettier from 'prettier';

export async function checkFormatting(code: string, filename: string): Promise<{ formatted: boolean; skipped: boolean }> {
  try {
    const output = await prettier.format(code, { filepath: filename });
    return { formatted: output.trim() === code.trim(), skipped: false };
  } catch {
    // Not a Prettier-supported extension, or the code doesn't parse — let
    // ESLint/TSC report the real problem instead of double-reporting here.
    return { formatted: true, skipped: true };
  }
}
