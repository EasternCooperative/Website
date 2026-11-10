// Minimal React test helpers (no @testing-library): mount into jsdom, fire real DOM
// events inside act(), and clean up. Use from files marked `@vitest-environment jsdom`.
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; el: HTMLElement }[] = [];

export async function render(ui: ReactElement) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(ui);
  });
  mounted.push({ root, el });
  return { container: el };
}

export async function cleanup() {
  while (mounted.length) {
    const { root, el } = mounted.pop()!;
    await act(async () => root.unmount());
    el.remove();
  }
}

/**
 * Let lazy imports, Suspense boundaries, and effects settle. Lazy chunks load
 * on a real import(), which is slower the first time (and on a busy machine),
 * so after a few turns of the event loop this keeps waiting while a
 * "Loading…" fallback is still on screen.
 */
export async function settle(times = 3) {
  const turn = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  for (let i = 0; i < times; i++) await turn();
  for (let i = 0; i < 300 && document.body.textContent?.includes('Loading…'); i++) await turn();
}

export async function click(el: Element | null) {
  if (!el) throw new Error('click: element not found');
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** Sets a controlled input's value the way a user typing would. */
export async function type(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error('type: input not found');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export async function blur(el: Element | null) {
  if (!el) throw new Error('blur: element not found');
  await act(async () => {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

export function buttonWithText(root: ParentNode, text: string | RegExp): HTMLButtonElement | null {
  const match = (t: string) => (typeof text === 'string' ? t.trim() === text : text.test(t));
  return [...root.querySelectorAll('button')].find((b) => match(b.textContent ?? '')) ?? null;
}

export function textOf(root: ParentNode): string {
  return (root.textContent ?? '').replace(/\s+/g, ' ').trim();
}
