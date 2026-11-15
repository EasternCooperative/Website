// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { initBookSidebar, toggleSections } from './bookSidebar';

const markup = `
  <button data-opp-toggle aria-controls="opp-nav-games" aria-expanded="true"><span>chevron</span></button>
  <ul id="opp-nav-games"><li>Wink</li></ul>
  <button data-opp-toggle aria-controls="nowhere" aria-expanded="false"></button>
  <button data-opp-toggle id="bare" aria-expanded="false"></button>`;

describe('book sidebar toggles', () => {
  it('collapses and expands a chapter section list, from a click anywhere in the button', () => {
    document.body.innerHTML = markup;
    initBookSidebar();
    initBookSidebar(); // a second call (another page load) adds no second listener
    const button = document.querySelector<HTMLElement>('[aria-controls="opp-nav-games"]')!;
    const list = document.getElementById('opp-nav-games')!;

    button.querySelector('span')!.click();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(list.hidden).toBe(true);

    button.click();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(list.hidden).toBe(false);
  });

  it('ignores a button whose list is missing, and clicks elsewhere', () => {
    document.body.innerHTML = markup;
    const orphan = document.querySelector<HTMLElement>('[aria-controls="nowhere"]')!;
    toggleSections(orphan);
    expect(orphan.getAttribute('aria-expanded')).toBe('false');
    toggleSections(document.getElementById('bare')!);
    expect(document.getElementById('bare')!.getAttribute('aria-expanded')).toBe('false');
    document.dispatchEvent(new MouseEvent('click'));
    document.getElementById('opp-nav-games')!.click();
    expect(document.getElementById('opp-nav-games')!.hidden).toBe(false);
  });
});
