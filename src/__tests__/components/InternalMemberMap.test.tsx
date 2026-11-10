// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import InternalMemberMap from '~/components/widgets/InternalMemberMap';
import { buttonWithText, cleanup, click, render, settle, textOf } from '../react';

const { ingest, finalise } = vi.hoisted(() => ({ ingest: vi.fn(), finalise: vi.fn() }));
vi.mock('~/components/widgets/memberLocationsParser', () => ({
  MemberLocationAccumulator: class {
    ingest = ingest;
    ingestCsv = vi.fn();
    finalise = finalise;
  },
}));

const committed = [{ name: 'Philadelphia, PA', country: 'US', state: 'PA', lat: 39.95, lng: -75.16, count: 30 }];
const sites = [{ id: 'pendle-hill', name: 'Pendle Hill', address: 'Wallingford, PA', lat: 39.9, lng: -75.37 }];

afterEach(async () => {
  await cleanup();
  document.body.innerHTML = '';
});

async function mount() {
  const { container } = await render(
    <InternalMemberMap committedCities={committed} committedAt="2026-08-19T17:40:38.481Z" knownSites={sites} />
  );
  await settle();
  return container;
}

describe('InternalMemberMap', () => {
  it('shows the committed data with its date, the map, and the site evaluator', async () => {
    const container = await mount();

    expect(textOf(container)).toContain('committed data · August 19, 2026');
    expect(container.querySelectorAll('.rsm-geographies path')).toHaveLength(64);
    expect(textOf(container)).toContain('Site Evaluation');
  });

  it('shows and hides the uploader', async () => {
    const container = await mount();
    expect(container.querySelector('input[type=file]')).toBeNull();

    await click(buttonWithText(container, 'Upload new data'));
    expect(container.querySelector('input[type=file]')).not.toBeNull();
    expect(textOf(container)).toContain('Upload Cognito Forms event exports');

    await click(buttonWithText(container, 'Hide uploader'));
    expect(container.querySelector('input[type=file]')).toBeNull();
  });

  it('replaces the committed data with an upload and says where it came from', async () => {
    finalise.mockReturnValue({
      generatedAt: '2026-11-10T00:00:00Z',
      cities: [
        { name: 'Boston, MA', country: 'US', state: 'MA', lat: 42.36, lng: -71.06, count: 5 },
        { name: 'Albany, NY', country: 'US', state: 'NY', lat: 42.65, lng: -73.75, count: 2 },
      ],
      stats: { uniqueEmails: 7, skipped: 0 },
    });
    const container = await mount();
    await click(buttonWithText(container, 'Upload new data'));
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'wa.xlsx')], configurable: true });

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();

    expect(textOf(container)).toContain('uploaded · 7 attendees · 2 locations');
  });

  it('pins the chosen site on the map', async () => {
    const container = await mount();
    expect(container.querySelector('.rsm-marker')).toBeNull();

    const select = container.querySelector<HTMLSelectElement>('select')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'pendle-hill');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();

    expect(container.querySelector('.rsm-marker')).not.toBeNull();
    expect(textOf(container)).toContain('Reach from: Pendle Hill');
  });
});
