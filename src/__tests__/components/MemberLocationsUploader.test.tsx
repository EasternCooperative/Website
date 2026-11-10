// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import MemberLocationsUploader from '~/components/widgets/MemberLocationsUploader';
import { buttonWithText, cleanup, click, render, settle, textOf } from '../react';

const { ingest, ingestCsv, finalise } = vi.hoisted(() => ({
  ingest: vi.fn(),
  ingestCsv: vi.fn(),
  finalise: vi.fn(),
}));
vi.mock('~/components/widgets/memberLocationsParser', () => ({
  MemberLocationAccumulator: class {
    ingest = ingest;
    ingestCsv = ingestCsv;
    finalise = finalise;
  },
}));

const result = (skipped = 0) => ({
  generatedAt: '2026-11-10T00:00:00Z',
  cities: [{ name: 'Philadelphia, PA', country: 'US', state: 'PA', lat: 1, lng: 2, count: 3 }],
  stats: { uniqueEmails: 1234, skipped },
});

async function pick(root: ParentNode, ...files: File[]) {
  const input = root.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

beforeEach(() => {
  ingest.mockReset();
  ingestCsv.mockReset();
  finalise.mockReset().mockReturnValue(result());
});

afterEach(async () => {
  await cleanup();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('MemberLocationsUploader', () => {
  it('reads a Cognito .xlsx export, lists it, and reports the result', async () => {
    const onResult = vi.fn();
    const { container } = await render(<MemberLocationsUploader onResult={onResult} />);

    await pick(container, new File(['x'], 'wa-2026.xlsx'));

    expect(ingest).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ stats: expect.objectContaining({ uniqueEmails: 1234 }) })
    );
    expect(textOf(container)).toContain('wa-2026.xlsx');
    expect(textOf(container)).toContain('1,234 unique attendees');
    expect(textOf(container)).toContain('Drop another file to add more data');
  });

  it('reads a Mailchimp .csv export through the CSV path', async () => {
    const { container } = await render(<MemberLocationsUploader onResult={vi.fn()} />);

    await pick(container, new File(['a,b'], 'list.csv'));

    expect(ingestCsv).toHaveBeenCalledOnce();
    expect(ingest).not.toHaveBeenCalled();
  });

  it('accepts several files at once', async () => {
    const { container } = await render(<MemberLocationsUploader onResult={vi.fn()} />);

    await pick(container, new File(['x'], 'a.xlsx'), new File(['y'], 'b.csv'));

    expect(textOf(container)).toContain('a.xlsx');
    expect(textOf(container)).toContain('b.csv');
  });

  it('shows how many rows had no address', async () => {
    finalise.mockReturnValue(result(7));
    const { container } = await render(<MemberLocationsUploader onResult={vi.fn()} />);

    await pick(container, new File(['x'], 'a.xlsx'));

    expect(textOf(container)).toContain('7 skipped — no address');
  });

  it('turns away other file types', async () => {
    const onResult = vi.fn();
    const { container } = await render(<MemberLocationsUploader onResult={onResult} />);

    await pick(container, new File(['x'], 'notes.txt'));

    expect(textOf(container)).toContain('Please upload .xlsx (Cognito) or .csv (Mailchimp) files.');
    expect(onResult).not.toHaveBeenCalled();
  });

  it('shows the parser’s message when a file cannot be read, or a generic one', async () => {
    ingest.mockImplementationOnce(() => {
      throw new Error('Sheet "Registrations" not found');
    });
    const { container } = await render(<MemberLocationsUploader onResult={vi.fn()} />);
    await pick(container, new File(['x'], 'a.xlsx'));
    expect(textOf(container)).toContain('Sheet "Registrations" not found');

    ingest.mockImplementationOnce(() => {
      throw 'boom';
    });
    await pick(container, new File(['x'], 'b.xlsx'));
    expect(textOf(container)).toContain('Unexpected error reading file.');
  });

  it('takes dropped files and highlights the zone while dragging over it', async () => {
    const { container } = await render(<MemberLocationsUploader onResult={vi.fn()} />);
    const zone = container.querySelector<HTMLElement>('.border-dashed')!;

    await act(async () => {
      zone.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    });
    expect(zone.className).toContain('border-primary');
    await act(async () => {
      zone.dispatchEvent(new Event('dragleave', { bubbles: true }));
    });
    expect(zone.className).not.toContain('bg-primary/5');

    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [new File(['x'], 'dropped.xlsx')] } });
    await act(async () => {
      zone.dispatchEvent(drop);
    });
    await settle();
    expect(textOf(container)).toContain('dropped.xlsx');
  });

  it('opens the file picker when the zone is clicked', async () => {
    const { container } = await render(<MemberLocationsUploader onResult={vi.fn()} />);
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
    const open = vi.spyOn(input, 'click').mockImplementation(() => {});

    await click(container.querySelector('.border-dashed'));

    expect(open).toHaveBeenCalled();
  });

  it('downloads the result as member-locations.json', async () => {
    const { container } = await render(<MemberLocationsUploader onResult={vi.fn()} />);
    await pick(container, new File(['x'], 'a.xlsx'));
    const create = vi.fn().mockReturnValue('blob:fake');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await click(buttonWithText(container, 'Download JSON'));

    expect(create).toHaveBeenCalledOnce();
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:fake');
  });
});
