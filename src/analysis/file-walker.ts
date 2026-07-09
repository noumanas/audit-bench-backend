import AdmZip = require('adm-zip');
import { ScannedFile } from './types';

const IGNORED_DIR_SEGMENTS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  'venv',
  '.venv',
  '__pycache__',
  'vendor',
  'coverage',
  '.turbo',
  '.cache',
]);

const IGNORED_FILENAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
]);

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'ico', 'svg', 'webp', 'bmp',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'zip', 'gz', 'tar', 'rar', '7z',
  'pdf', 'exe', 'dll', 'so', 'dylib', 'bin', 'wasm',
  'mp3', 'mp4', 'mov', 'avi', 'webm',
]);

const MAX_TOTAL_FILES = 3000;

// A zip's central directory declares each entry's uncompressed size before
// any inflating happens — adm-zip trusts that value and does
// `Buffer.alloc(declaredSize)` the moment `getData()` is called. Without
// checking it first, a tiny zip that lies about a multi-GB uncompressed
// size can force a multi-GB allocation before our post-hoc length check
// ever runs. Reject oversized entries using the declared size instead.
const MAX_TOTAL_DECOMPRESSED_BYTES = 500 * 1024 * 1024; // hard ceiling per archive

function declaredUncompressedSize(entry: AdmZip.IZipEntry): number {
  const size = entry.header.size;
  return Number.isFinite(size) ? size : Infinity; // fail closed if unparseable
}

function isIgnoredPath(relativePath: string): boolean {
  const segments = relativePath.split('/');
  if (segments.some((s) => IGNORED_DIR_SEGMENTS.has(s))) return true;
  const filename = segments[segments.length - 1];
  if (IGNORED_FILENAMES.has(filename)) return true;
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext && BINARY_EXTENSIONS.has(ext)) return true;
  return false;
}

/** Strips the single top-level directory zip tools add (e.g. "my-repo-main/"). */
function stripRootPrefix(entries: { entryName: string }[]): string | null {
  const tops = new Set(entries.map((e) => e.entryName.split('/')[0]));
  return tops.size === 1 ? [...tops][0] : null;
}

export function extractZip(buffer: Buffer, maxFileSizeBytes: number): ScannedFile[] {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const rootPrefix = stripRootPrefix(entries);

  const files: ScannedFile[] = [];
  let totalDecompressedBytes = 0;

  for (const entry of entries) {
    if (files.length >= MAX_TOTAL_FILES) break;

    let relativePath = entry.entryName;
    if (rootPrefix && relativePath.startsWith(`${rootPrefix}/`)) {
      relativePath = relativePath.slice(rootPrefix.length + 1);
    }
    if (!relativePath || isIgnoredPath(relativePath)) continue;

    const declaredSize = declaredUncompressedSize(entry);
    if (declaredSize === 0 || declaredSize > maxFileSizeBytes) continue;
    if (totalDecompressedBytes + declaredSize > MAX_TOTAL_DECOMPRESSED_BYTES) break;

    const data = entry.getData(); // safe now — declaredSize already bounded above
    totalDecompressedBytes += data.length;
    if (data.length === 0 || data.length > maxFileSizeBytes) continue;

    // Skip files that don't look like text (contain a NUL byte in the first 1KB).
    if (data.subarray(0, 1024).includes(0)) continue;

    files.push({ path: relativePath, content: data.toString('utf8') });
  }

  return files;
}
