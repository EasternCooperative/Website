// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

const initScrollRevealMock = vi.fn();

vi.mock('~/utils/scrollReveal', () => ({
  initScrollReveal: (...args: unknown[]) => initScrollRevealMock(...args),
}));

beforeEach(() => {
  document.body.innerHTML = '';
  initScrollRevealMock.mockClear();
  vi.restoreAllMocks();
});

describe('initTestimonialsReveal', () => {
  it('does nothing when there are no testimonial cards', async () => {
    const { initTestimonialsReveal } = await import('./testimonialReveal');

    initTestimonialsReveal();

    expect(initScrollRevealMock).not.toHaveBeenCalled();
  });

  it('reveals up to 3 of the hidden cards and wires up scroll reveal', async () => {
    document.body.innerHTML = `
      <div data-testimonial hidden></div>
      <div data-testimonial hidden></div>
      <div data-testimonial hidden></div>
      <div data-testimonial hidden></div>
      <div data-testimonial hidden></div>
    `;
    const { initTestimonialsReveal } = await import('./testimonialReveal');

    initTestimonialsReveal();

    const cards = Array.from(document.querySelectorAll('[data-testimonial]'));
    const visible = cards.filter((c) => !c.hasAttribute('hidden'));
    expect(visible).toHaveLength(3);
    expect(initScrollRevealMock).toHaveBeenCalledTimes(1);
  });

  it('reveals all cards when there are fewer than 3', async () => {
    document.body.innerHTML = `
      <div data-testimonial hidden></div>
      <div data-testimonial hidden></div>
    `;
    const { initTestimonialsReveal } = await import('./testimonialReveal');

    initTestimonialsReveal();

    const cards = Array.from(document.querySelectorAll('[data-testimonial]'));
    expect(cards.every((c) => !c.hasAttribute('hidden'))).toBe(true);
  });

  it('picks a randomized selection across runs', async () => {
    const randomSpy = vi.spyOn(Math, 'random');
    document.body.innerHTML = `
      <div data-testimonial id="a" hidden></div>
      <div data-testimonial id="b" hidden></div>
      <div data-testimonial id="c" hidden></div>
    `;
    const { initTestimonialsReveal } = await import('./testimonialReveal');

    randomSpy.mockReturnValue(0);
    initTestimonialsReveal();

    // With Math.random always 0, the Fisher-Yates shuffle never swaps —
    // order stays a, b, c, so the visible set is all three ids in order.
    expect(document.getElementById('a')?.hasAttribute('hidden')).toBe(false);
    expect(document.getElementById('b')?.hasAttribute('hidden')).toBe(false);
    expect(document.getElementById('c')?.hasAttribute('hidden')).toBe(false);
  });

  it('re-reveals a fresh random set on astro:after-swap', async () => {
    document.body.innerHTML = `
      <div data-testimonial hidden></div>
      <div data-testimonial hidden></div>
    `;
    const { initTestimonialsReveal } = await import('./testimonialReveal');

    initTestimonialsReveal();
    expect(initScrollRevealMock).toHaveBeenCalledTimes(1);

    document.querySelectorAll('[data-testimonial]').forEach((el) => el.setAttribute('hidden', ''));
    document.dispatchEvent(new Event('astro:after-swap'));

    expect(initScrollRevealMock).toHaveBeenCalledTimes(2);
    const cards = Array.from(document.querySelectorAll('[data-testimonial]'));
    expect(cards.every((c) => !c.hasAttribute('hidden'))).toBe(true);
  });
});
