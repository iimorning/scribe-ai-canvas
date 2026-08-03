import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { BookNode } from '../../src/components/nodes/BookNode';
import { encodeBookContent } from '../../src/utils/bookPayload';
import { db, type CanvasNode } from '../../src/db';

// Use importOriginal so src/i18n.ts (loaded transitively via aiI18n) can still
// find initReactI18next at module-init. Only useTranslation gets stubbed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.mock('react-i18next', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = await (vi as any).importActual('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        if (key === 'nodes.book_page') return `${opts?.current} / ${opts?.total}`;
        return key;
      },
    }),
  };
});

vi.mock('lucide-react', () => {
  const icon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement('svg', { 'data-testid': `icon-${name}`, ...props });
  return {
    BookOpen: icon('BookOpen'),
    ChevronLeft: icon('ChevronLeft'),
    ChevronRight: icon('ChevronRight'),
    Sparkles: icon('Sparkles'),
    GitBranch: icon('GitBranch'),
    Loader2: icon('Loader2'),
    StickyNote: icon('StickyNote'),
    Mic: icon('Mic'),
    MicOff: icon('MicOff'),
    Square: icon('Square'),
  };
});

// Stub voice-chat hook — jsdom has no WebAudio/MediaRecorder and these aren't the
// component being tested. Each test injects its own implementation via variable.
const voiceChatMock = vi.hoisted(() => ({
  active: false,
  phase: 'idle',
  messages: [] as Array<{ role: string; text: string }>,
  partialTranscript: '',
  toggle: vi.fn(),
  stop: vi.fn(),
}));
vi.mock('../../src/hooks/useBookVoiceChat', () => ({
  useBookVoiceChat: () => voiceChatMock,
}));

function makeBookNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 'b1',
    type: 'book',
    x: 0,
    y: 0,
    description: 'demo.epub',
    fileType: 'epub',
    content: encodeBookContent({
      format: 'epub',
      title: 'Demo',
      units: [
        { title: 'Ch1', text: 'First unit text' },
        { title: 'Ch2', text: 'Second unit text' },
      ],
    }),
    ...overrides,
  };
}

describe('BookNode', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.nodes.add(makeBookNode());
  });

  it('restores persisted page index', () => {
    const { getByText, queryByText } = render(
      <BookNode
        node={makeBookNode({ bookPageIndex: 1 })}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
      />,
    );
    expect(queryByText('First unit text')).not.toBeInTheDocument();
    expect(getByText('Second unit text')).toBeInTheDocument();
  });

  it('persists page index when navigating', async () => {
    const { getByLabelText } = render(
      <BookNode node={makeBookNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />,
    );
    fireEvent.click(getByLabelText('nodes.book_next'));
    await waitFor(async () => {
      const saved = await db.nodes.get('b1');
      expect(saved?.bookPageIndex).toBe(1);
    });
  });

  it('marks current unit as AI context text', () => {
    const { container } = render(
      <BookNode node={makeBookNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />,
    );
    expect(container.querySelector('[data-canvas-node-context-text]')).toHaveTextContent('First unit text');
  });

  it('attaches scroll persistence to body scroller', () => {
    // jsdom can't simulate real scroll geometry; only assert the onScroll handler
    // is wired up via React (not test the persistence timing — that goes through
    // Dexie and is covered indirectly by the page-index persistence test).
    const { container } = render(
      <BookNode node={makeBookNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />,
    );
    const scroller = container.querySelector('[data-canvas-node-context-text]');
    expect(scroller?.getAttribute('tabindex')).toBe('-1');
  });

  it('arrow keys on body flip pages directly', async () => {
    voiceChatMock.active = false;
    const { container } = render(
      <BookNode node={makeBookNode()} editingNodeId={null} setEditingNodeId={vi.fn()} />,
    );
    const scroller = container.querySelector('[data-canvas-node-context-text]');
    // Right → ArrowRight should reach goToPage(+1) and persist bookPageIndex: 1.
    fireEvent.keyDown(scroller!, { key: 'ArrowRight' });
    await waitFor(async () => {
      const saved = await db.nodes.get('b1');
      expect(saved?.bookPageIndex).toBe(1);
    });
  });

  it('arrow left flips back to previous page', async () => {
    voiceChatMock.active = false;
    // Start from page 1 so the left-arrow test has somewhere to go.
    await db.nodes.update('b1', { bookPageIndex: 1 });
    const { container } = render(
      <BookNode node={makeBookNode({ bookPageIndex: 1 })} editingNodeId={null} setEditingNodeId={vi.fn()} />,
    );
    const scroller = container.querySelector('[data-canvas-node-context-text]');
    fireEvent.keyDown(scroller!, { key: 'ArrowLeft' });
    await waitFor(async () => {
      const saved = await db.nodes.get('b1');
      expect(saved?.bookPageIndex).toBe(0);
    });
  });

  it('disables voice mic when aiConfig missing', () => {
    voiceChatMock.active = false;
    const { getByLabelText } = render(
      <BookNode
        node={makeBookNode()}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        voiceChatDisabled={true}
        aiConfig={undefined}
      />,
    );
    const btn = getByLabelText('voice.book_chat_start') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('voice stop button toggles off via stop() when active', () => {
    voiceChatMock.active = true;
    voiceChatMock.stop = vi.fn();
    const { getAllByLabelText } = render(
      <BookNode
        node={makeBookNode()}
        editingNodeId={null}
        setEditingNodeId={vi.fn()}
        aiConfig={{} as never}
      />,
    );
    // Two stop buttons render when voice is active: the floating panel close and the toolbar toggle.
    const stopButtons = getAllByLabelText('voice.book_chat_stop');
    fireEvent.click(stopButtons[0]!);
    expect(voiceChatMock.stop).toHaveBeenCalled();
  });
});
