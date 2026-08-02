import type { MetasoMediaItem } from './search';

/** Cap for note-search video + podcast cards combined (images are not limited by this). */
export const NOTE_SEARCH_AV_MAX = 3;

export type NoteSearchAvHit =
  | { kind: 'video'; item: MetasoMediaItem }
  | { kind: 'podcast'; item: MetasoMediaItem };

/**
 * Round-robin video / podcast hits for note search.
 * Combined count is capped (default 3); images are handled separately.
 */
export function pickNoteSearchAvHits(
  videos: MetasoMediaItem[],
  podcasts: MetasoMediaItem[],
  max = NOTE_SEARCH_AV_MAX,
): NoteSearchAvHit[] {
  const queues: NoteSearchAvHit[][] = [
    videos.map((item) => ({ kind: 'video', item })),
    podcasts.map((item) => ({ kind: 'podcast', item })),
  ];
  const out: NoteSearchAvHit[] = [];
  let depth = 0;
  while (out.length < max) {
    let added = false;
    for (const q of queues) {
      if (out.length >= max) break;
      const hit = q[depth];
      if (hit) {
        out.push(hit);
        added = true;
      }
    }
    if (!added) break;
    depth += 1;
  }
  return out;
}
