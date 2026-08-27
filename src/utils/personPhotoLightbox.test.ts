// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// jsdom implements neither the Popover API nor <dialog>.showModal()/close(), nor
// window.matchMedia — stub minimal versions so the module under test can run.
//
// initPersonPhotoLightbox() registers persistent listeners on the shared jsdom
// `document`. Without removing them, listeners from earlier tests would keep
// firing (and re-guard against re-init via the module-level window flag) —
// contaminating later tests' call counts.
let popoverOpenState: WeakSet<Element>;
let hoverMatches: boolean;
let addedListeners: [string, EventListenerOrEventListenerObject][] = [];

beforeEach(() => {
  document.body.innerHTML = '';
  vi.resetModules();
  delete (window as unknown as { __personPhotoLightboxInit?: boolean }).__personPhotoLightboxInit;

  addedListeners = [];
  const originalAddEventListener = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    addedListeners.push([type, listener as EventListenerOrEventListenerObject]);
    return originalAddEventListener(type, listener, options);
  });

  hoverMatches = true;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: hoverMatches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;

  popoverOpenState = new WeakSet<Element>();
  HTMLElement.prototype.showPopover = vi.fn(function (this: HTMLElement) {
    popoverOpenState.add(this);
  });
  HTMLElement.prototype.hidePopover = vi.fn(function (this: HTMLElement) {
    popoverOpenState.delete(this);
  });
  const originalMatches = Element.prototype.matches;
  Element.prototype.matches = function (this: Element, selector: string) {
    if (selector === ':popover-open') return popoverOpenState.has(this);
    return originalMatches.call(this, selector);
  } as unknown as typeof Element.prototype.matches;

  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

afterEach(() => {
  addedListeners.forEach(([type, listener]) => document.removeEventListener(type, listener));
  vi.restoreAllMocks();
});

function makeTriggerAndDialog(opts: { imgComplete?: boolean; withImg?: boolean } = {}) {
  const { imgComplete = true, withImg = true } = opts;
  const trigger = document.createElement('button');
  trigger.dataset.photoTrigger = '';
  trigger.dataset.dialogId = 'dlg-1';

  const dialog = document.createElement('dialog');
  dialog.id = 'dlg-1';
  dialog.setAttribute('data-photo-dialog', '');

  const closeBtn = document.createElement('button');
  closeBtn.setAttribute('data-dialog-close', '');
  dialog.appendChild(closeBtn);

  if (withImg) {
    const img = document.createElement('img');
    Object.defineProperty(img, 'complete', { value: imgComplete, configurable: true });
    Object.defineProperty(img, 'naturalWidth', { value: imgComplete ? 400 : 0, configurable: true });
    Object.defineProperty(img, 'currentSrc', { value: 'photo.jpg', configurable: true });
    dialog.appendChild(img);
  }

  document.body.append(trigger, dialog);
  return { trigger, dialog };
}

describe('initPersonPhotoLightbox — idempotency', () => {
  it('only wires listeners once even if called multiple times', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');

    initPersonPhotoLightbox();
    const callsAfterFirst = addSpy.mock.calls.length;
    initPersonPhotoLightbox();

    expect(addSpy.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe('initPersonPhotoLightbox — click to open/close the dialog', () => {
  it('opens the dialog via showModal when the trigger is clicked', async () => {
    const { trigger, dialog } = makeTriggerAndDialog();
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(dialog.showModal).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the trigger has no matching dialog', async () => {
    const trigger = document.createElement('button');
    trigger.dataset.photoTrigger = '';
    trigger.dataset.dialogId = 'missing';
    document.body.appendChild(trigger);

    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    expect(() => trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow();
  });

  it('closes the dialog when the close button is clicked', async () => {
    const { dialog } = makeTriggerAndDialog();
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    const closeBtn = dialog.querySelector('[data-dialog-close]')!;
    closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(dialog.close).toHaveBeenCalledTimes(1);
  });

  it('does nothing when a trigger is clicked without a dialog id', async () => {
    const trigger = document.createElement('button');
    trigger.dataset.photoTrigger = '';
    document.body.appendChild(trigger);
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    expect(() => trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow();
  });

  it('closes the dialog when the backdrop (the dialog element itself) is clicked', async () => {
    const { dialog } = makeTriggerAndDialog();
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(dialog.close).toHaveBeenCalledTimes(1);
  });
});

describe('initPersonPhotoLightbox — hover preview', () => {
  it('does not attach hover listeners on devices without real hover', async () => {
    hoverMatches = false;
    const { trigger } = makeTriggerAndDialog();
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));

    expect(document.querySelector('.person-photo-preview')).toBeNull();
  });

  it('shows a preview on pointerover using an already-loaded source image', async () => {
    const { trigger } = makeTriggerAndDialog({ imgComplete: true });
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 100, clientY: 100 }));

    const preview = document.querySelector('.person-photo-preview') as HTMLElement;
    expect(preview).not.toBeNull();
    expect(preview.classList.contains('is-visible')).toBe(true);
    expect(preview.classList.contains('is-loaded')).toBe(true);
    expect(preview.getAttribute('popover')).toBe('manual');
    expect(preview.showPopover).toHaveBeenCalled();

    const previewImg = preview.querySelector('img') as HTMLImageElement;
    expect(previewImg.src).toContain('photo.jpg');
  });

  it('positions the preview near the cursor with an offset', async () => {
    const { trigger } = makeTriggerAndDialog();
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 50, clientY: 60 }));

    const preview = document.querySelector('.person-photo-preview') as HTMLElement;
    expect(preview.style.left).toBe('68px');
    expect(preview.style.top).toBe('78px');
  });

  it('flips to the other side of the cursor when it would overflow the viewport', async () => {
    const { trigger } = makeTriggerAndDialog();
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    trigger.dispatchEvent(
      new PointerEvent('pointerover', {
        bubbles: true,
        clientX: window.innerWidth - 5,
        clientY: window.innerHeight - 5,
      })
    );

    const preview = document.querySelector('.person-photo-preview') as HTMLElement;
    const left = parseFloat(preview.style.left);
    const top = parseFloat(preview.style.top);
    expect(left).toBeLessThan(window.innerWidth - 5);
    expect(top).toBeLessThan(window.innerHeight - 5);
  });

  it('re-promotes an already-open preview (hide then show) rather than erroring', async () => {
    const { trigger } = makeTriggerAndDialog();
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 10, clientY: 10 }));
    const preview = document.querySelector('.person-photo-preview') as HTMLElement;
    expect(preview.showPopover).toHaveBeenCalledTimes(1);

    // Move within the same trigger, then re-enter — showPreviewFor only re-fires
    // on a genuinely new trigger, so hover a second trigger to exercise the
    // hide-then-show-again path against an already-open preview.
    const { trigger: trigger2 } = makeTriggerAndDialog({ withImg: true });
    trigger2.dataset.dialogId = 'dlg-1'; // same dialog/image, different trigger element
    trigger.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: trigger2 }));
    trigger2.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 20, clientY: 20 }));

    expect(preview.hidePopover).toHaveBeenCalled();
    expect(preview.showPopover).toHaveBeenCalledTimes(2);
  });

  it('does not reload the image when hovering the same trigger again', async () => {
    const { trigger } = makeTriggerAndDialog();
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 10, clientY: 10 }));
    const preview = document.querySelector('.person-photo-preview') as HTMLElement;
    preview.classList.remove('is-loaded');

    trigger.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 11, clientY: 11 }));

    // Still not re-marked as freshly loaded since the same dialogId is already cached.
    expect(preview.querySelector('img')!.dataset.forId).toBe('dlg-1');
  });

  it('lazily loads the source image and applies it once loaded', async () => {
    const { trigger } = makeTriggerAndDialog({ imgComplete: false });
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 10, clientY: 10 }));

    const dialog = document.getElementById('dlg-1')!;
    const sourceImg = dialog.querySelector('img') as HTMLImageElement;
    expect(sourceImg.loading).toBe('eager');

    const preview = document.querySelector('.person-photo-preview') as HTMLElement;
    expect(preview.classList.contains('is-loaded')).toBe(false);

    Object.defineProperty(sourceImg, 'currentSrc', { value: 'loaded.jpg', configurable: true });
    sourceImg.dispatchEvent(new Event('load'));

    expect(preview.classList.contains('is-loaded')).toBe(true);
    expect(preview.querySelector('img')!.src).toContain('loaded.jpg');
  });

  it('copies the srcset onto the preview image when the source has one', async () => {
    const { trigger, dialog } = makeTriggerAndDialog();
    const sourceImg = dialog.querySelector('img') as HTMLImageElement;
    sourceImg.srcset = 'photo.jpg 1x, photo@2x.jpg 2x';
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 10, clientY: 10 }));

    const previewImg = document.querySelector('.person-photo-preview img') as HTMLImageElement;
    expect(previewImg.srcset).toBe('photo.jpg 1x, photo@2x.jpg 2x');
  });

  it('skips applying a lazily-loaded image if a different trigger became active first', async () => {
    const { trigger } = makeTriggerAndDialog({ imgComplete: false });
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 10, clientY: 10 }));
    const sourceImg = document.getElementById('dlg-1')!.querySelector('img') as HTMLImageElement;

    // Move to a different trigger/dialog before the first image's load event fires.
    const { trigger: trigger2, dialog: dialog2 } = makeTriggerAndDialog({ imgComplete: true });
    dialog2.id = 'dlg-2';
    trigger2.dataset.dialogId = 'dlg-2';
    trigger.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: trigger2 }));
    trigger2.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 20, clientY: 20 }));

    const preview = document.querySelector('.person-photo-preview') as HTMLElement;
    const previewImg = preview.querySelector('img') as HTMLImageElement;
    const forIdBeforeLoad = previewImg.dataset.forId;

    Object.defineProperty(sourceImg, 'currentSrc', { value: 'stale.jpg', configurable: true });
    sourceImg.dispatchEvent(new Event('load'));

    // The stale trigger's image load must not overwrite the now-active preview.
    expect(previewImg.dataset.forId).toBe(forIdBeforeLoad);
    expect(previewImg.src).not.toContain('stale.jpg');
  });

  it('does not re-fire showPreviewFor when hovering the same trigger again without leaving', async () => {
    const { trigger } = makeTriggerAndDialog();
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 10, clientY: 10 }));
    const preview = document.querySelector('.person-photo-preview') as HTMLElement;
    expect(preview.showPopover).toHaveBeenCalledTimes(1);

    trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 12, clientY: 12 }));

    expect(preview.showPopover).toHaveBeenCalledTimes(1);
  });

  it('does nothing on pointermove when no trigger is active', async () => {
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    expect(() =>
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 5, clientY: 5 }))
    ).not.toThrow();
    expect(document.querySelector('.person-photo-preview')).toBeNull();
  });

  it('does nothing on pointerout when no trigger is active', async () => {
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    expect(() => document.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }))).not.toThrow();
  });

  it('keeps the preview visible when the pointer moves to a child element within the trigger', async () => {
    const { trigger } = makeTriggerAndDialog();
    const child = document.createElement('span');
    trigger.appendChild(child);
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 10, clientY: 10 }));
    const preview = document.querySelector('.person-photo-preview') as HTMLElement;
    expect(preview.classList.contains('is-visible')).toBe(true);

    trigger.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: child }));

    expect(preview.classList.contains('is-visible')).toBe(true);
  });

  it('does not hide the preview on pointerout from a trigger that is not the active one', async () => {
    const { trigger: triggerA } = makeTriggerAndDialog();
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    triggerA.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 10, clientY: 10 }));
    const preview = document.querySelector('.person-photo-preview') as HTMLElement;
    expect(preview.classList.contains('is-visible')).toBe(true);

    const triggerB = document.createElement('button');
    triggerB.dataset.photoTrigger = '';
    document.body.appendChild(triggerB);
    triggerB.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));

    // triggerB was never the active trigger, so this pointerout must not hide the preview.
    expect(preview.classList.contains('is-visible')).toBe(true);
  });

  it('closes the dialog on click when the target is a dialog without the photo-dialog attribute', async () => {
    const plainDialog = document.createElement('dialog');
    document.body.appendChild(plainDialog);
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    plainDialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(plainDialog.close).not.toHaveBeenCalled();
  });

  it('hides the preview on pointerout when leaving the trigger', async () => {
    const { trigger } = makeTriggerAndDialog();
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 10, clientY: 10 }));
    const preview = document.querySelector('.person-photo-preview') as HTMLElement;
    expect(preview.classList.contains('is-visible')).toBe(true);

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    trigger.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: outside }));

    expect(preview.classList.contains('is-visible')).toBe(false);
  });

  it('falls back to the image src when currentSrc is empty', async () => {
    const { trigger, dialog } = makeTriggerAndDialog();
    const sourceImg = dialog.querySelector('img') as HTMLImageElement;
    Object.defineProperty(sourceImg, 'currentSrc', { value: '', configurable: true });
    sourceImg.src = 'fallback.jpg';
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 10, clientY: 10 }));

    const previewImg = document.querySelector('.person-photo-preview img') as HTMLImageElement;
    expect(previewImg.src).toContain('fallback.jpg');
  });

  it('does not show a preview when hovering a trigger with no dialog id', async () => {
    const trigger = document.createElement('button');
    trigger.dataset.photoTrigger = '';
    document.body.appendChild(trigger);
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 10, clientY: 10 }));

    expect(document.querySelector('.person-photo-preview')).toBeNull();
  });

  it('ignores a trigger with no image inside its dialog', async () => {
    const { trigger } = makeTriggerAndDialog({ withImg: false });
    const { initPersonPhotoLightbox } = await import('./personPhotoLightbox');
    initPersonPhotoLightbox();

    trigger.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 10, clientY: 10 }));

    expect(document.querySelector('.person-photo-preview')).toBeNull();
  });
});
