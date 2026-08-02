import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// Polyfill crypto.randomUUID for test environment
if (!globalThis.crypto) {
  (globalThis as any).crypto = {
    randomUUID: () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
  };
}

// Polyfill DOMMatrix for pdfjs-dist in jsdom (used transitively via parsePdfBook → file → useNodeActions)
if (typeof (globalThis as any).DOMMatrix === 'undefined') {
  (globalThis as any).DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    is2D = true;
    isIdentity = true;
    constructor(_init?: unknown) {}
    translate() { return this; }
    scale() { return this; }
    rotate() { return this; }
    multiply() { return this; }
    inverse() { return this; }
    setMatrixValue() { return this; }
    transformPoint() { return { x: 0, y: 0, z: 0, w: 1 }; }
    toFloat32Array() { return new Float32Array(16); }
    toString() { return 'matrix(1, 0, 0, 1, 0, 0)'; }
  };
}

// Suppress Dexie console warnings during tests
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const msg = String(args[0] ?? '');
  if (msg.includes('[Dexie]') || msg.includes('IndexedDB')) return;
  originalWarn(...args);
};

// Suppress window.matchMedia not available in jsdom
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Mock window.confirm and window.alert to prevent test interruptions
window.confirm = () => true;
window.alert = () => {};

// Mock requestFullscreen / exitFullscreen (not available in jsdom)
Element.prototype.requestFullscreen = Element.prototype.requestFullscreen || (async () => {});
document.exitFullscreen = document.exitFullscreen || (async () => {});
