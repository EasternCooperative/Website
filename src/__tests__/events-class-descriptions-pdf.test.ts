import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('astro:content', () => ({
  getCollection: vi.fn(),
}));

import { getCollection } from 'astro:content';
import { GET, getStaticPaths } from '../pages/events/[id]/class-descriptions.pdf';

const makeEvent = (id: string, classes?: { name: string; description?: string; leaderId?: string }[]) => ({
  id,
  data: { title: 'Winter Adventure 2026', date: new Date('2026-12-27T00:00:00Z'), classes },
});

const leaders = [{ id: 'john-smith', data: { name: 'John Smith' } }];

beforeEach(() => {
  vi.mocked(getCollection).mockReset();
});

describe('getStaticPaths', () => {
  it('builds a PDF only for events with at least one class description', async () => {
    const withDescriptions = makeEvent('2026-winter-adventure', [{ name: 'Pottery', description: 'Throw a pot.' }]);
    vi.mocked(getCollection).mockResolvedValue([
      withDescriptions,
      makeEvent('names-only', [{ name: 'Dance' }]),
      makeEvent('no-classes'),
    ] as never);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paths = await (getStaticPaths as any)();
    expect(paths).toEqual([{ params: { id: '2026-winter-adventure' }, props: { event: withDescriptions } }]);
  });
});

describe('GET', () => {
  it('returns a PDF named after the event', async () => {
    vi.mocked(getCollection).mockResolvedValue(leaders as never);
    const event = makeEvent('2026-winter-adventure', [
      { name: 'Pottery', description: 'Throw a pot.', leaderId: 'john-smith' },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await GET({ props: { event } } as any);

    expect(getCollection).toHaveBeenCalledWith('leader');
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toBe(
      'inline; filename="2026-winter-adventure-class-descriptions.pdf"'
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    // The year already in the title is not repeated in the document title.
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).not.toContain('2026 2026');
  });
});
