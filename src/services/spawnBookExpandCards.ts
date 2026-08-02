import { db, type CanvasNode, type Edge } from '../db';
import { parseLenientLlmJson } from '../utils/llmJson';

export interface BookExpandBranch {
  title: string;
  content: string;
}

export interface BookExpandPlan {
  hub: string;
  branches: BookExpandBranch[];
}

export const BOOK_EXPAND_HUB_OFFSET_X = 420;
export const BOOK_EXPAND_CHILD_OFFSET_X = 340;
export const BOOK_EXPAND_CHILD_GAP_Y = 200;
export const BOOK_EXPAND_HUB_WIDTH = 280;
export const BOOK_EXPAND_HUB_HEIGHT = 160;
export const BOOK_EXPAND_CHILD_WIDTH = 280;
export const BOOK_EXPAND_CHILD_HEIGHT = 180;
export const BOOK_EXPAND_STACK_STEP = 5;
const DEFAULT_STAGGER_MS = 220;

function asNonEmptyString(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.slice(0, maxLen);
}

/** Normalize LLM JSON into a hub + 3–6 branch cards. */
export function normalizeBookExpandPlan(raw: unknown): BookExpandPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const hub =
    asNonEmptyString(obj.hub, 80) ||
    asNonEmptyString(obj.title, 80) ||
    asNonEmptyString(obj.theme, 80);
  const list = Array.isArray(obj.branches)
    ? obj.branches
    : Array.isArray(obj.cards)
      ? obj.cards
      : Array.isArray(obj.children)
        ? obj.children
        : null;
  if (!hub || !list) return null;

  const branches: BookExpandBranch[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const title =
      asNonEmptyString(row.title, 60) ||
      asNonEmptyString(row.name, 60) ||
      asNonEmptyString(row.label, 60);
    const content =
      asNonEmptyString(row.content, 600) ||
      asNonEmptyString(row.body, 600) ||
      asNonEmptyString(row.desc, 600) ||
      asNonEmptyString(row.description, 600) ||
      title;
    if (!title || !content) continue;
    branches.push({ title, content });
    if (branches.length >= 6) break;
  }
  if (branches.length < 2) return null;
  return { hub, branches };
}

export function parseBookExpandPlan(text: string): BookExpandPlan | null {
  try {
    return normalizeBookExpandPlan(parseLenientLlmJson(text));
  } catch {
    return null;
  }
}

export function bookExpandBranchIndex(node: CanvasNode): number {
  if (typeof node.bookExpandIndex === 'number') return node.bookExpandIndex;
  return 0;
}

/** Prefer tagged branches; if none tagged yet, use edged text/note children (legacy expand). */
export function resolveBookExpandBranches(
  hubId: string,
  nodes: CanvasNode[],
  edges: Pick<Edge, 'from' | 'to'>[],
): CanvasNode[] {
  const childIds = new Set(edges.filter((e) => e.from === hubId).map((e) => e.to));
  const tagged = nodes
    .filter((n) => n.bookExpandParentId === hubId && (n.type === 'text' || n.type === 'note'))
    .sort((a, b) => bookExpandBranchIndex(a) - bookExpandBranchIndex(b));
  if (tagged.length > 0) return tagged;

  return nodes
    .filter((n) => childIds.has(n.id) && (n.type === 'text' || n.type === 'note'))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export function bookExpandBranchLaneY(
  hubY: number,
  index: number,
  count: number,
  hubHeight = BOOK_EXPAND_HUB_HEIGHT,
): number {
  const stackHeight = (count - 1) * BOOK_EXPAND_CHILD_GAP_Y + BOOK_EXPAND_CHILD_HEIGHT;
  const centerY = hubY + Math.max(hubHeight, 1) / 2;
  const firstY = centerY - stackHeight / 2;
  return firstY + index * BOOK_EXPAND_CHILD_GAP_Y;
}

export function bookExpandBranchStackPos(
  hub: { x: number; y: number },
  index: number,
  hubHeight = BOOK_EXPAND_HUB_HEIGHT,
): { x: number; y: number } {
  const centerY = hub.y + Math.max(hubHeight, 1) / 2;
  return {
    x: hub.x + BOOK_EXPAND_CHILD_OFFSET_X + index * BOOK_EXPAND_STACK_STEP,
    y: centerY - BOOK_EXPAND_CHILD_HEIGHT / 2 + index * BOOK_EXPAND_STACK_STEP,
  };
}

/** Higher z for earlier branches so #1 sits on top of the neat deck. */
export function bookExpandStackZIndex(index: number): number {
  return 420 - index;
}

/**
 * Collapse book-expand branches into a photo stack beside the hub, or expand back to the lane.
 */
export async function setBookExpandBranchesCollapsed(
  hubId: string,
  collapsed: boolean,
  options?: {
    nodes?: CanvasNode[];
    edges?: Pick<Edge, 'from' | 'to'>[];
    hubHeight?: number;
  },
): Promise<number> {
  const hub = await db.nodes.get(hubId);
  if (!hub || hub.type !== 'theme') return 0;

  const nodes = options?.nodes ?? (await db.nodes.toArray());
  const edges = options?.edges ?? (await db.edges.toArray());
  const branches = resolveBookExpandBranches(hubId, nodes, edges);
  if (branches.length === 0) return 0;

  const hubHeight = options?.hubHeight ?? hub.height ?? BOOK_EXPAND_HUB_HEIGHT;

  await db.transaction('rw', db.nodes, async () => {
    await db.nodes.update(hubId, { bookExpandBranchesCollapsed: collapsed });
    for (let i = 0; i < branches.length; i++) {
      const pos = collapsed
        ? bookExpandBranchStackPos({ x: hub.x, y: hub.y }, i, hubHeight)
        : {
            x: hub.x + BOOK_EXPAND_CHILD_OFFSET_X,
            y: bookExpandBranchLaneY(hub.y, i, branches.length, hubHeight),
          };
      await db.nodes.update(branches[i]!.id, {
        ...pos,
        bookExpandParentId: hubId,
        bookExpandIndex: i,
      });
    }
  });
  return branches.length;
}

/**
 * Spawn a theme hub + linked note cards to the right of a book node.
 * Edges: book → hub → each branch.
 */
export async function spawnBookExpandCards(options: {
  bookNodeId: string;
  canvasId: string;
  bookPos: { x: number; y: number; width?: number; height?: number };
  plan: BookExpandPlan;
  staggerMs?: number;
}): Promise<{ hubId: string; branchIds: string[] }> {
  const { bookNodeId, canvasId, bookPos, plan } = options;
  const staggerMs = options.staggerMs ?? DEFAULT_STAGGER_MS;
  const bookW = bookPos.width ?? 380;
  const bookH = bookPos.height ?? 520;

  const hubId = crypto.randomUUID();
  const hubX = bookPos.x + bookW + 48;
  const hubY = bookPos.y + Math.max(0, bookH / 2 - BOOK_EXPAND_HUB_HEIGHT / 2);

  await db.nodes.add({
    id: hubId,
    canvasId,
    type: 'theme',
    content: plan.hub,
    x: hubX,
    y: hubY,
    width: BOOK_EXPAND_HUB_WIDTH,
    height: BOOK_EXPAND_HUB_HEIGHT,
    bookExpandBranchesCollapsed: false,
  });
  await db.edges.add({
    id: crypto.randomUUID(),
    canvasId,
    from: bookNodeId,
    to: hubId,
  });

  const branchIds: string[] = [];
  for (let i = 0; i < plan.branches.length; i++) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, staggerMs));
    }
    const branch = plan.branches[i]!;
    const id = crypto.randomUUID();
    const markdown = `**${branch.title}**\n\n${branch.content}`;
    await db.nodes.add({
      id,
      canvasId,
      type: 'text',
      content: markdown,
      x: hubX + BOOK_EXPAND_CHILD_OFFSET_X,
      y: bookExpandBranchLaneY(hubY, i, plan.branches.length, BOOK_EXPAND_HUB_HEIGHT),
      width: BOOK_EXPAND_CHILD_WIDTH,
      height: BOOK_EXPAND_CHILD_HEIGHT,
      bookExpandParentId: hubId,
      bookExpandIndex: i,
    });
    await db.edges.add({
      id: crypto.randomUUID(),
      canvasId,
      from: hubId,
      to: id,
    });
    branchIds.push(id);
  }

  return { hubId, branchIds };
}
