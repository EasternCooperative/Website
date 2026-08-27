declare global {
  interface Window {
    __personPhotoLightboxInit?: boolean;
  }
}

// Wires up every `[data-photo-trigger]` button on the page to a cursor-following
// preview (RES-style hover popover, real-hover + precise-pointer devices only)
// and a click-to-open `<dialog data-photo-dialog>`. Delegated at the document
// level and guarded so calling this from multiple components (PersonCard,
// PersonPhoto) on the same page only wires listeners once.
export function initPersonPhotoLightbox() {
  if (window.__personPhotoLightboxInit) return;
  window.__personPhotoLightboxInit = true;

  let activeTrigger: HTMLElement | null = null;
  let previewEl: HTMLDivElement | null = null;

  const ensurePreview = (): HTMLDivElement => {
    if (previewEl) return previewEl;
    previewEl = document.createElement('div');
    previewEl.className = 'person-photo-preview';
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
    const size = previewEl.offsetWidth || 220;
    let left = x + offset;
    let top = y + offset;
    if (left + size > window.innerWidth) left = x - offset - size;
    if (top + size > window.innerHeight) top = y - offset - size;
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
