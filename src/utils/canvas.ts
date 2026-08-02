export type CanvasTransformLike = { x: number; y: number; scale: number };

export type CanvasRect = { x: number; y: number; width: number; height: number };

export type CanvasObstacle = {
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
};

/** Default shell size for notes / AI cards when width/height are unset. */
export const DEFAULT_NODE_SIZE = { width: 320, height: 200 };

/** Matches BOOK_NODE_SIZE in file.ts when book width/height are unset. */
export const BOOK_NODE_FALLBACK_SIZE = { width: 380, height: 520 };

/** Conservative size used when placing a fresh toolbar AI card. */
export const NEW_AI_NODE_SIZE = { width: 320, height: 240 };

const DEFAULT_GAP = 28;

/**
 * Calculate a position near the center of the viewport in canvas coordinates.
 * Used when creating new nodes so they appear near the visible center.
 */
export function getCanvasCenterPosition(transform: CanvasTransformLike) {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  return {
    x: (cx - transform.x) / transform.scale - 150 + Math.random() * 50,
    y: (cy - transform.y) / transform.scale - 100 + Math.random() * 50,
  };
}

export function estimateNodeRect(node: CanvasObstacle): CanvasRect {
  const fallback = node.type === 'book' ? BOOK_NODE_FALLBACK_SIZE : DEFAULT_NODE_SIZE;
  return {
    x: node.x,
    y: node.y,
    width: node.width && node.width > 0 ? node.width : fallback.width,
    height: node.height && node.height > 0 ? node.height : fallback.height,
  };
}

export function rectsOverlap(a: CanvasRect, b: CanvasRect, gap = 0): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

function isFree(candidate: CanvasRect, obstacles: CanvasRect[], gap: number): boolean {
  return !obstacles.some((o) => rectsOverlap(candidate, o, gap));
}

/** Prefer the open lane to the right of an anchor (same idea as book-expand hub). */
export function positionBesideRect(
  anchor: CanvasRect,
  size: { width: number; height: number },
  gap = DEFAULT_GAP,
): { x: number; y: number } {
  return {
    x: anchor.x + anchor.width + gap,
    y: anchor.y + Math.max(0, anchor.height / 2 - size.height / 2),
  };
}

/**
 * Find a non-overlapping canvas position for a new node.
 * Starts beside `preferBeside` (if given) or at viewport center, then walks a square spiral.
 */
export function findOpenCanvasPosition(options: {
  transform: CanvasTransformLike;
  obstacles: CanvasObstacle[];
  size?: { width: number; height: number };
  gap?: number;
  preferBeside?: CanvasObstacle | null;
  maxRings?: number;
}): { x: number; y: number } {
  const size = options.size ?? NEW_AI_NODE_SIZE;
  const gap = options.gap ?? DEFAULT_GAP;
  const maxRings = options.maxRings ?? 12;
  const obstacleRects = options.obstacles.map(estimateNodeRect);

  const seeds: { x: number; y: number }[] = [];
  if (options.preferBeside) {
    seeds.push(positionBesideRect(estimateNodeRect(options.preferBeside), size, gap));
  }
  seeds.push(getCanvasCenterPosition(options.transform));

  const stepX = size.width + gap;
  const stepY = size.height + gap;

  for (const seed of seeds) {
    for (let ring = 0; ring <= maxRings; ring++) {
      if (ring === 0) {
        const candidate = { x: seed.x, y: seed.y, width: size.width, height: size.height };
        if (isFree(candidate, obstacleRects, gap)) {
          return { x: seed.x, y: seed.y };
        }
        continue;
      }

      for (let dx = -ring; dx <= ring; dx++) {
        for (const dy of [-ring, ring] as const) {
          const x = seed.x + dx * stepX;
          const y = seed.y + dy * stepY;
          const candidate = { x, y, width: size.width, height: size.height };
          if (isFree(candidate, obstacleRects, gap)) return { x, y };
        }
      }
      for (let dy = -ring + 1; dy <= ring - 1; dy++) {
        for (const dx of [-ring, ring] as const) {
          const x = seed.x + dx * stepX;
          const y = seed.y + dy * stepY;
          const candidate = { x, y, width: size.width, height: size.height };
          if (isFree(candidate, obstacleRects, gap)) return { x, y };
        }
      }
    }
  }

  const fallback = seeds[0]!;
  return {
    x: fallback.x + stepX * (maxRings + 1),
    y: fallback.y,
  };
}
