import AdmZip = require('adm-zip');
import { extractZip, unsafeArchivePath } from './file-walker';

describe('unsafeArchivePath', () => {
  it('flags paths that climb out of the repository or are absolute', () => {
    for (const p of ['../x.ts', 'a/../../x.ts', '/etc/passwd', 'C:/Windows/x', '..\\x.ts', 'a\\..\\..\\x']) {
      expect(unsafeArchivePath(p)).toBe(true);
    }
    for (const p of ['src/a.ts', 'a..b/c.ts', '.github/workflows/ci.yml', 'docs/v1..v2.md']) {
      expect(unsafeArchivePath(p)).toBe(false);
    }
  });
});

describe('extractZip with a hostile archive', () => {
  it('skips an entry whose real size is larger than it declares, and keeps the rest', () => {
    const zip = new AdmZip();
    zip.addFile('repo/src/ok.ts', Buffer.from('export const ok = 1;\n'));
    zip.addFile('repo/src/bomb.ts', Buffer.from('a'.repeat(200_000)));
    const buffer = zip.toBuffer();

    // Rewrite the declared size of bomb.ts in its central directory record to 10 bytes.
    const cdName = Buffer.from('repo/src/bomb.ts');
    let at = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    while (at !== -1 && !buffer.subarray(at + 46, at + 46 + cdName.length).equals(cdName)) {
      at = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), at + 4);
    }
    expect(at).toBeGreaterThan(-1);
    buffer.writeUInt32LE(10, at + 24); // uncompressed size

    const skipped: Array<{ path: string; reason: string }> = [];
    const files = extractZip(buffer, 1024 * 1024, skipped as never);
    expect(files.map((f) => f.path)).toEqual(['src/ok.ts']);
    expect(skipped).toContainEqual({ path: 'src/bomb.ts', reason: 'too_large' });
  });
});
