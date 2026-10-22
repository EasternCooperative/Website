declare global {
  interface Window {
    __photoLightboxInit?: boolean;
  }
}

// Wires up every `[data-photo-trigger]` button on the page to a cursor-following
// preview (RES-style hover popover, real-hover + precise-pointer devices only)
// and a click-to-open `<dialog data-photo-dialog>`. Delegated at the document
// level and guarded so calling this from multiple components (PersonCard,
// ZoomablePhoto) on the same page only wires listeners once.
//
// The preview is square by default; a trigger with `data-preview-aspect`
// (width / height, e.g. a landscape room photo) gets a preview of that shape.
const PREVIEW_SIZE = 220;
const PREVIEW_MAX_WIDTH = 400;
// A preview has to be noticeably bigger than the thumbnail it zooms, so larger
// thumbnails (room and venue photos) scale their preview off their own width.
const PREVIEW_SCALE = 1.6;

export function initPhotoLightbox() {
  if (window.__photoLightboxInit) return;
  window.__photoLightboxInit = true;

  let activeTrigger: HTMLElement | null = null;
  let previewEl: HTMLDivElement | null = null;

  const ensurePreview = (): HTMLDivElement => {
    // Astro view-transition navigation swaps the page's <body> content, which
    // removes this element (it isn't part of the astro-managed page tree) —
    // but doesn't reset this closure's reference to it. Reusing a detached
    // element throws "Invalid on disconnected popover elements" on the next
    // showPopover() call, so check isConnected rather than just truthiness.
    if (previewEl?.isConnected) return previewEl;
    previewEl = document.createElement('div');
    previewEl.className = 'photo-preview';
    previewEl.setAttribute('aria-hidden', 'true');
    // A plain fixed-position element always renders behind a native popover
    // (e.g. the leader/staff bio popover) regardless of z-index, since popovers
    // are promoted to the browser's top layer. Making the preview a manual
    // popover too puts it in that same top layer, so re-showing it (see
    // showPreviewFor) can bring it above whatever popover is currently open.
    previewEl.setAttribute('popover', 'manual');
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    previewEl.appendChild(img);
    document.body.appendChild(previewEl);
    return previewEl;
  };

  const positionPreview = (x: number, y: number) => {
    if (!previewEl) return;
    const offset = 18;
    const width = previewEl.offsetWidth || PREVIEW_SIZE;
    const height = previewEl.offsetHeight || PREVIEW_SIZE;
    let left = x + offset;
    let top = y + offset;
    if (left + width > window.innerWidth) left = x - offset - width;
    if (top + height > window.innerHeight) top = y - offset - height;
    previewEl.style.left = `${Math.max(4, left)}px`;
    previewEl.style.top = `${Math.max(4, top)}px`;
  };

  const showPreviewFor = (trigger: HTMLElement) => {
    // Once we're past this guard, dialogId is a non-empty string for the rest
    // of the function — there's no separate "found the trigger but it had no
    // dialog id" case to handle below.
    const dialogId = trigger.dataset.dialogId;
    if (!dialogId) return;
    const dialog = document.getElementById(dialogId);
    const sourceImg = dialog?.querySelector('img');
    if (!(sourceImg instanceof HTMLImageElement)) return;

    const preview = ensurePreview();
    const previewImg = preview.querySelector('img') as HTMLImageElement;

    // Small thumbnails get a fixed-size preview: square, or for landscape photos
    // the same height budget widened (capped so it isn't banner-sized). Larger
    // thumbnails scale up from their rendered width instead. Either way the
    // preview stays within half the viewport width and 70% of its height.
    const aspect = Number(trigger.dataset.previewAspect) || 1;
    const baseWidth = Math.min(PREVIEW_SIZE * aspect, PREVIEW_MAX_WIDTH);
    const scaledWidth = trigger.getBoundingClientRect().width * PREVIEW_SCALE;
    const maxWidth = Math.min(window.innerWidth * 0.5, window.innerHeight * 0.7 * aspect);
    const width = Math.round(Math.min(Math.max(baseWidth, scaledWidth), maxWidth));
    preview.style.width = `${width}px`;
    preview.style.height = `${Math.round(width / aspect)}px`;

    if (previewImg.dataset.forId !== dialogId) {
      previewImg.dataset.forId = dialogId;
      preview.classList.remove('is-loaded');

      const applySrc = () => {
        previewImg.src = sourceImg.currentSrc || sourceImg.src;
        if (sourceImg.srcset) previewImg.srcset = sourceImg.srcset;
        preview.classList.add('is-loaded');
      };

      if (sourceImg.complete && sourceImg.naturalWidth > 0) {
        applySrc();
      } else {
        // The lightbox image is normally lazy-loaded; force it to start
        // fetching now so the preview (and a follow-up click) are fast.
        sourceImg.loading = 'eager';
        sourceImg.addEventListener(
          'load',
          () => {
            if (previewImg.dataset.forId === dialogId) applySrc();
          },
          { once: true }
        );
      }
    }

    // Re-promote to the top of the top-layer stack every time we (re)show it,
    // so it renders above any popover that's currently open — the top layer
    // stacks by most-recently-shown, not by z-index.
    if (preview.matches(':popover-open')) preview.hidePopover();
    preview.showPopover();

    preview.classList.add('is-visible');
  };

  const hidePreview = () => {
    previewEl?.classList.remove('is-visible');
  };

  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.addEventListener('pointerover', (event) => {
      const trigger = (event.target as HTMLElement).closest<HTMLElement>('[data-photo-trigger]');
      if (trigger && trigger !== activeTrigger) {
        activeTrigger = trigger;
        showPreviewFor(trigger);
        positionPreview(event.clientX, event.clientY);
      }
    });

    document.addEventListener('pointermove', (event) => {
      if (activeTrigger) positionPreview(event.clientX, event.clientY);
    });

    document.addEventListener('pointerout', (event) => {
      if (!activeTrigger) return;
      const trigger = (event.target as HTMLElement).closest<HTMLElement>('[data-photo-trigger]');
      if (trigger === activeTrigger && !trigger.contains(event.relatedTarget as Node)) {
        activeTrigger = null;
        hidePreview();
      }
    });
  }

  document.addEventListener('click', (event) => {
    const trigger = (event.target as HTMLElement).closest<HTMLElement>('[data-photo-trigger]');
    if (trigger) {
      activeTrigger = null;
      hidePreview();
      const dialogId = trigger.dataset.dialogId;
      const dialog = dialogId ? document.getElementById(dialogId) : null;
      if (dialog instanceof HTMLDialogElement) dialog.showModal();
      return;
    }

    const closeButton = (event.target as HTMLElement).closest<HTMLElement>('[data-dialog-close]');
    if (closeButton) {
      closeButton.closest('dialog')?.close();
      return;
    }

    // Click landed on the dialog element itself (i.e. the backdrop area, not
    // its content) — treat it the same as clicking outside to dismiss.
    if (event.target instanceof HTMLDialogElement && event.target.hasAttribute('data-photo-dialog')) {
      event.target.close();
    }
  });
}
