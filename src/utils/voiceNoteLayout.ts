import { VOICE_NOTE_OFFSET_X, VOICE_NOTE_OFFSET_Y } from '../constants/voiceWriting';

export type VoiceNoteAnchor = { x: number; y: number };

/** Place the next voice-turn note relative to the previous one. */
export function nextVoiceNotePosition(anchor: VoiceNoteAnchor, turnIndex: number): VoiceNoteAnchor {
  const zig = turnIndex % 2 === 0 ? 1 : -1;
  return {
    x: anchor.x + VOICE_NOTE_OFFSET_X,
    y: anchor.y + zig * VOICE_NOTE_OFFSET_Y,
  };
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
