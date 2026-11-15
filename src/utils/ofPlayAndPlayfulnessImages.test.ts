import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findImage, getImage } = vi.hoisted(() => ({ findImage: vi.fn(), getImage: vi.fn() }));
vi.mock('~/utils/images', () => ({ findImage }));
vi.mock('astro:assets', () => ({ getImage }));

import { optimizeBookImage } from './ofPlayAndPlayfulnessImages';

describe('optimizeBookImage', () => {
  beforeEach(() => {
    findImage.mockReset();
    getImage.mockReset();
  });

  it('returns the WebP URL Sharp produces for a mirrored image', async () => {
    const asset = { src: '/src/assets/images/of-play-and-playfulness/a.jpg', width: 10, height: 10, format: 'jpg' };
    findImage.mockResolvedValue(asset);
    getImage.mockResolvedValue({ src: '/_astro/a.hash.webp' });
    expect(await optimizeBookImage('/images/of-play-and-playfulness/a.jpg')).toBe('/_astro/a.hash.webp');
    expect(getImage).toHaveBeenCalledWith({ src: asset, format: 'webp' });
  });

  it('keeps the original path when there is no mirrored copy (astro dev)', async () => {
    findImage.mockResolvedValue('/images/of-play-and-playfulness/a.jpg');
    expect(await optimizeBookImage('/images/of-play-and-playfulness/a.jpg')).toBe(
      '/images/of-play-and-playfulness/a.jpg'
    );
    findImage.mockResolvedValue(undefined);
    expect(await optimizeBookImage('/images/x.jpg')).toBe('/images/x.jpg');
    expect(getImage).not.toHaveBeenCalled();
  });
});
