#!/usr/bin/env node
/**
 * Turn a raw photo (usually from ~/Downloads) into a site headshot at
 * public/images/headshots/<slug>.jpg.
 *
 *   node scripts/process-headshot.mjs <source-image> <slug> [--y=0.4] [--x=0.5] [--zoom=2] [--trim] [--no-crop]
 *
 * By default it square-crops with Sharp's attention strategy and resizes to at
 * most 600x600, never upscaling. Attention often lands too low on selfies, so
 * --y=<0..1> instead centres the crop at that fraction of the image height
 * (0.35-0.45 suits most portraits); --x does the same horizontally, and
 * --zoom=<n> shrinks the square to 1/n of the short side for photos where the
 * person is small in the frame. --trim strips solid letterbox bars (phone
 * screenshots) first. --no-crop keeps the original aspect ratio.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SIZE = 600;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const noCrop = args.includes('--no-crop');
const trim = args.includes('--trim');
const flag = (name) => {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? Number(arg.slice(name.length + 3)) : null;
};
const focusX = flag('x');
const focusY = flag('y');
const zoom = flag('zoom') ?? 1;
const manual = focusX !== null || focusY !== null || zoom !== 1;
const [src, slug] = args.filter((a) => !a.startsWith('--'));

if (!src || !slug) {
  console.error(
    'Usage: node scripts/process-headshot.mjs <source-image> <slug> [--y=0.4] [--x=0.5] [--zoom=2] [--trim] [--no-crop]'
  );
  process.exit(1);
}
if (!fs.existsSync(src)) {
  console.error(`Source not found: ${src}`);
  process.exit(1);
}

const out = path.join(root, 'public/images/headshots', `${slug}.jpg`);
const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;

// Bake EXIF orientation in first so metadata dimensions match what we see.
let oriented = await sharp(src).rotate().toBuffer();
if (trim) oriented = await sharp(oriented).trim({ threshold: 20 }).toBuffer();
const { width, height } = await sharp(oriented).metadata();

const pipeline = noCrop
  ? sharp(oriented).resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true })
  : manual
    ? (() => {
        const side = Math.round(Math.min(width, height) / zoom);
        const clamp = (v, max) => Math.round(Math.min(Math.max(v, 0), max));
        const top = clamp((focusY ?? 0.5) * height - side / 2, height - side);
        const left = clamp((focusX ?? 0.5) * width - side / 2, width - side);
        const dim = Math.min(side, SIZE);
        return sharp(oriented).extract({ left, top, width: side, height: side }).resize(dim, dim);
      })()
    : (() => {
        const side = Math.min(width, height, SIZE);
        return sharp(oriented).resize(side, side, { fit: 'cover', position: sharp.strategy.attention });
      })();

const existed = fs.existsSync(out);
const info = await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 85, mozjpeg: true }).toFile(out);

console.log(`${path.basename(src)}  ${width}x${height}${trim ? ' (after trim)' : ''}  ${kb(fs.statSync(src).size)}`);
console.log(
  `-> ${path.relative(root, out)}  ${info.width}x${info.height}  ${kb(info.size)}${existed ? '  (replaced existing)' : ''}`
);
