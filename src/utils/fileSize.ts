import { statSync } from 'node:fs';
import { join } from 'node:path';

/** "340 KB" or "2.4 MB". */
export function formatFileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/**
 * Size of a file served from public/, read at build time so a replaced file
 * can't leave a stale number behind. Undefined for an external URL or a file
 * that isn't there (yet).
 */
export function publicFileSize(href: string, root = join(process.cwd(), 'public')): string | undefined {
  if (!href.startsWith('/')) return undefined;
  try {
    return formatFileSize(statSync(join(root, decodeURIComponent(href))).size);
  } catch {
    return undefined;
  }
}
