import { describe, it, expect } from 'vitest';
import {
  deriveSearchQueryFromNoteText,
  sourceCardY,
} from '../../src/services/spawnWebSearchNoteCards';

describe('deriveSearchQueryFromNoteText', () => {
  it('returns empty for blank', () => {
    expect(deriveSearchQueryFromNoteText('')).toBe('');
    expect(deriveSearchQueryFromNoteText('  \n  ')).toBe('');
  });

  it('uses first non-empty line', () => {
    expect(deriveSearchQueryFromNoteText('\nfoo\nbar')).toBe('foo');
  });

  it('truncates long first line', () => {
    const long = 'a'.repeat(400);
    expect(deriveSearchQueryFromNoteText(long, 280)).toHaveLength(280);
  });
});

describe('sourceCardY', () => {
  it('centers a single card on the answer card mid-line', () => {
    // baseY=100, anchorH=280 → center 240; cardH=210 → firstY = 240 - 105 = 135
    expect(sourceCardY(100, 0, 1, 280)).toBe(135);
  });

  it('spreads a 3-card lane evenly above and below the answer mid-line', () => {
    const baseY = 100;
    const anchorH = 280;
    const y0 = sourceCardY(baseY, 0, 3, anchorH);
    const y1 = sourceCardY(baseY, 1, 3, anchorH);
    const y2 = sourceCardY(baseY, 2, 3, anchorH);
    expect(y1 - y0).toBe(240);
    expect(y2 - y1).toBe(240);
    // Midpoint of first-top → last-bottom aligns with answer center.
    const stackMid = (y0 + y2 + 210) / 2;
    expect(stackMid).toBe(baseY + anchorH / 2);
    // First card starts above the answer top (not flush with it).
    expect(y0).toBeLessThan(baseY);
  });
});
