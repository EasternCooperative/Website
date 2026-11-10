// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import UploadStep from '~/components/schedule/steps/UploadStep';
import { cleanup, click, render, settle, textOf } from '../react';

afterEach(async () => {
  await cleanup();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const zone = (root: ParentNode) => root.querySelector<HTMLElement>('.border-dashed')!;

describe('UploadStep: drag and drop', () => {
  it('highlights the drop zone while a file is dragged over it', async () => {
    const { container } = await render(<UploadStep onParsed={vi.fn()} onAttached={vi.fn()} />);

    await act(async () => {
      zone(container).dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    });
    expect(zone(container).className).toContain('border-primary bg-primary/5');

    await act(async () => {
      zone(container).dispatchEvent(new Event('dragleave', { bubbles: true }));
    });
    expect(zone(container).className).not.toContain('bg-primary/5');
  });

  it('reads a dropped file', async () => {
    const { container } = await render(<UploadStep onParsed={vi.fn()} onAttached={vi.fn()} />);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [new File(['x'], 'notes.txt')] } });

    await act(async () => {
      zone(container).dispatchEvent(drop);
    });
    await settle();

    expect(textOf(container)).toContain('Please upload an .xlsx file.');
  });

  it('ignores a drop with no file in it', async () => {
    const { container } = await render(<UploadStep onParsed={vi.fn()} onAttached={vi.fn()} />);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [] } });

    await act(async () => {
      zone(container).dispatchEvent(drop);
    });

    expect(textOf(container)).not.toContain('Please upload');
  });

  it('opens the file picker when the zone is clicked', async () => {
    const { container } = await render(<UploadStep onParsed={vi.fn()} onAttached={vi.fn()} />);
    const open = vi
      .spyOn(container.querySelector<HTMLInputElement>('input[type=file]')!, 'click')
      .mockImplementation(() => {});

    await click(zone(container));

    expect(open).toHaveBeenCalled();
  });

  it('shows a generic message when the file cannot be read at all', async () => {
    const { container } = await render(<UploadStep onParsed={vi.fn()} onAttached={vi.fn()} />);
    const broken = new File(['x'], 'a.xlsx');
    broken.arrayBuffer = () => Promise.reject(new Error('disk gone'));
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [broken] } });

    await act(async () => {
      zone(container).dispatchEvent(drop);
    });
    await settle();

    expect(textOf(container)).toContain('Unexpected error reading file.');
  });
});
