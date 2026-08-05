import { initScrollReveal } from '~/utils/scrollReveal';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function revealRandomTestimonials() {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-testimonial]'));
  if (cards.length > 0) {
    const picked = shuffle(cards).slice(0, 3);
    picked.forEach((card) => card.removeAttribute('hidden'));
    // cards start [hidden], so the global scroll-reveal sweep in BasicScripts.astro
    // skips them; wire up just-revealed cards here instead.
    initScrollReveal();
  }
}

export function initTestimonialsReveal(): void {
  revealRandomTestimonials();
  document.addEventListener('astro:after-swap', revealRandomTestimonials);
}
