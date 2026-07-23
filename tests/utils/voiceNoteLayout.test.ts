import { describe, it, expect, afterEach } from 'vitest';
import { nextVoiceNotePosition, transformToFocusNode } from '../../src/utils/voiceNoteLayout';
import { VOICE_NOTE_OFFSET_X, VOICE_NOTE_OFFSET_Y } from '../../src/constants/voiceWriting';

describe('voiceNoteLayout', () => {
  describe('nextVoiceNotePosition', () => {
    it('first reply (turnIndex=0) offsets +X, +Y', () => {
      const r = nextVoiceNotePosition({ x: 100, y: 200 }, 0);
      expect(r.x).toBe(100 + VOICE_NOTE_OFFSET_X);
      expect(r.y).toBe(200 + VOICE_NOTE_OFFSET_Y);
    });

    it('second reply zig-zags the other way (turnIndex=1)', () => {
      const r = nextVoiceNotePosition({ x: 100, y: 200 }, 1);
      expect(r.x).toBe(100 + VOICE_NOTE_OFFSET_X);
      expect(r.y).toBe(200 - VOICE_NOTE_OFFSET_Y);
    });

    it('zig-zag alternates on even/odd', () => {
      const even = nextVoiceNotePosition({ x: 0, y: 0 }, 2);
      const odd = nextVoiceNotePosition({ x: 0, y: 0 }, 3);
      expect(even.y).toBe(VOICE_NOTE_OFFSET_Y);
      expect(odd.y).toBe(-VOICE_NOTE_OFFSET_Y);
    });

    it('does not mutate the input anchor', () => {
      const anchor = { x: 10, y: 20 };
      nextVoiceNotePosition(anchor, 0);
      expect(anchor).toEqual({ x: 10, y: 20 });
    });
  });

  describe('transformToFocusNode', () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;

    afterEach(() => {
      Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true });
    });

    it('centers node on viewport when scale=1', () => {
      Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
      // For node at (100,100) with default note dims (320x200):
      // x = 400 - (100 + 160) * 1 = 140;  y = 300 - (100 + 100) * 1 = 100
      const r = transformToFocusNode(100, 100, 1);
      expect(r).toEqual({ x: 140, y: 100, scale: 1 });
    });

    it('applies scale to both axes', () => {
      Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
      const r = transformToFocusNode(100, 100, 2);
      // x = 400 - 260 * 2 = -120;  y = 300 - 200 * 2 = -100
      expect(r.scale).toBe(2);
      expect(r.x).toBe(400 - 260 * 2);
      expect(r.y).toBe(300 - 200 * 2);
    });

    it('honors custom note dimensions', () => {
      Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
      const r = transformToFocusNode(0, 0, 1, 100, 50);
      // x = 500 - 50 * 1 = 450;  y = 500 - 25 * 1 = 475
      expect(r.x).toBe(450);
      expect(r.y).toBe(475);
    });
  });
});
