import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The responsive contract for Historiku, pinned at the stylesheet level.
 *
 * Real layout was measured in a browser across 320/360/390/768/1024/1440 —
 * 1 column on phones, 2 from tablet up, no horizontal overflow and no clipped
 * text at any width. jsdom has no layout engine, so what these tests can
 * usefully guard is that the rules producing that behaviour are still present.
 */
const css = readFileSync('src/styles/global.css', 'utf8');

describe('history layout contract', () => {
  test('the grid is a single column by default — safe at 320px', () => {
    expect(css).toMatch(/\.history-grid\s*{[^}]*grid-template-columns:\s*1fr/);
  });

  test('it becomes multi-column only above the phone range', () => {
    expect(css).toMatch(/@media \(min-width: 700px\)[\s\S]*?\.history-grid/);
  });

  test('columns use an auto-fit floor rather than a fixed count', () => {
    // minmax() is what keeps a narrow tablet from getting squeezed columns.
    expect(css).toMatch(/repeat\(auto-fit,\s*minmax\(/);
  });

  test('cards can shrink inside the grid', () => {
    // Without min-width:0 a long title forces the track wider and overflows.
    expect(css).toMatch(/\.history-card\s*{[^}]*min-width:\s*0/);
  });

  test('long titles ellipsize instead of overflowing', () => {
    expect(css).toMatch(/\.history-card__title\s*{[^}]*text-overflow:\s*ellipsis/);
  });

  test('descriptions are clamped so cards in a row stay level', () => {
    expect(css).toMatch(/\.history-card__desc\s*{[^}]*-webkit-line-clamp:\s*2/);
  });

  test('the page itself never scrolls horizontally', () => {
    expect(css).toMatch(/body\s*{[^}]*overflow-x:\s*hidden/);
  });
});
