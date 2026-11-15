import { getImage } from 'astro:assets';
import { findImage } from '~/utils/images';

/**
 * The book's images go through Sharp like the rest of the site's: findImage
 * maps /images/… to the copy the prebuild step mirrors into src/assets, and
 * getImage turns it into WebP at its original size (these are small scans, so
 * there is nothing larger to offer). In `astro dev` there is no mirror, and the
 * original /images/ path is served unchanged.
 */
export async function optimizeBookImage(src: string): Promise<string> {
  const resolved = await findImage(src);
  if (!resolved || typeof resolved === 'string') return src;
  return (await getImage({ src: resolved, format: 'webp' })).src;
}
