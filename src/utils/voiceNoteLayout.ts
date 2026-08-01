import { VOICE_NOTE_COLUMN_GAP_X, VOICE_NOTE_ROW_GAP_Y } from '../constants/voiceWriting';

export type VoiceNoteAnchor = { x: number; y: number };

/**
 * Two-column voice layout: user notes stack vertically in the left column, AI notes sit
 * in the right column aligned to the same row. `origin` is the first user note's position;
 * `row` is the 0-based turn index.
 */
export function voiceUserPosition(origin: VoiceNoteAnchor, row: number): VoiceNoteAnchor {
  return { x: origin.x, y: origin.y + row * VOICE_NOTE_ROW_GAP_Y };
}

export function voiceAiPosition(origin: VoiceNoteAnchor, row: number): VoiceNoteAnchor {
  return { x: origin.x + VOICE_NOTE_COLUMN_GAP_X, y: origin.y + row * VOICE_NOTE_ROW_GAP_Y };
}

/** Pan/zoom so a note near (nodeX, nodeY) sits near viewport center. */
export function transformToFocusNode(
  nodeX: number,
  nodeY: number,
  scale: number,
  noteWidth = 320,
  noteHeight = 200,
): { x: number; y: number; scale: number } {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  return {
    x: cx - (nodeX + noteWidth / 2) * scale,
    y: cy - (nodeY + noteHeight / 2) * scale,
    scale,
  };
}
