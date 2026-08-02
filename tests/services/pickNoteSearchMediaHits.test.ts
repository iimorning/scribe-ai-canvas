import { describe, it, expect } from 'vitest';
import { pickNoteSearchAvHits } from '../../src/services/pickNoteSearchMediaHits';

describe('pickNoteSearchAvHits', () => {
  it('round-robins video/podcast and caps at 3 (images not involved)', () => {
    const picked = pickNoteSearchAvHits(
      [
        { title: 'v1', link: 'https://v/1' },
        { title: 'v2', link: 'https://v/2' },
        { title: 'v3', link: 'https://v/3' },
      ],
      [
        { title: 'p1', link: 'https://p/1' },
        { title: 'p2', link: 'https://p/2' },
      ],
    );
    expect(picked).toHaveLength(3);
    expect(picked.map((h) => h.kind)).toEqual(['video', 'podcast', 'video']);
    expect(picked[0]).toMatchObject({ kind: 'video', item: { title: 'v1' } });
    expect(picked[1]).toMatchObject({ kind: 'podcast', item: { title: 'p1' } });
    expect(picked[2]).toMatchObject({ kind: 'video', item: { title: 'v2' } });
  });

  it('fills from the other kind when one is empty', () => {
    const picked = pickNoteSearchAvHits(
      [],
      [
        { title: 'p1', link: 'https://p/1' },
        { title: 'p2', link: 'https://p/2' },
        { title: 'p3', link: 'https://p/3' },
        { title: 'p4', link: 'https://p/4' },
      ],
    );
    expect(picked).toHaveLength(3);
    expect(picked.every((h) => h.kind === 'podcast')).toBe(true);
  });

  it('returns empty when both empty', () => {
    expect(pickNoteSearchAvHits([], [])).toEqual([]);
  });
});
