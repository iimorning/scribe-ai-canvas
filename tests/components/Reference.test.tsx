import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Reference } from '../../src/components/Reference';
import { db } from '../../src/db';
import type { Article } from '../../src/db';
import { withAppDialogProvider } from '../testUtils';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => {
    const { createElement, Fragment } = require('react');
    const text = String(children ?? '');
    const nodes = text.split('\n').map((line: string, i: number) => {
      const h2 = line.match(/^##\s+(.+)$/);
      if (h2) return createElement('h2', { key: i }, h2[1]);
      if (line.trim()) return createElement('p', { key: i }, line);
      return null;
    });
    return createElement('div', { 'data-testid': 'reference-markdown' }, createElement(Fragment, null, ...nodes));
  },
}));

vi.mock('remark-breaks', () => ({ default: () => null }));

vi.mock('lucide-react', () => {
  const iconNames = [
    'Library', 'Plus', 'Search', 'ChevronLeft', 'Minimize2', 'Maximize2', 'Link2', 'BookOpen', 'X', 'Trash2',
  ];
  const icons: Record<string, React.FC> = {};
  for (const name of iconNames) {
    icons[name] = (props: Record<string, unknown>) => {
      const { createElement } = require('react');
      return createElement('svg', { 'data-testid': `icon-${name}`, ...props });
    };
  }
  return icons;
});

const articleA: Article = {
  id: 'a-alpha',
  title: 'Alpha Unique Title',
  content: 'Some body for alpha',
  date: '2024',
  type: 'REF-A',
  tags: ['memo'],
};

const articleB: Article = {
  id: 'b-beta',
  title: 'Beta Other Piece',
  content: 'Different content',
  date: '2025',
  type: 'REF-B',
};

const renderReference = (
  ui: React.ReactElement,
  options?: Parameters<typeof render>[1],
) => render(withAppDialogProvider(ui), options);

describe('Reference', () => {
  beforeEach(async () => {
    await db.articles.clear();
    await db.canvases.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('搜索框按标题过滤侧栏列表项', async () => {
    const user = userEvent.setup();
    await db.articles.bulkAdd([articleA, articleB]);
    const setId = vi.fn();

    renderReference(
      <Reference articles={[articleA, articleB]} activeReferenceId="a-alpha" setActiveReferenceId={setId} />,
    );

    expect(screen.getByTestId('reference-list-item-a-alpha')).toBeInTheDocument();
    expect(screen.getByTestId('reference-list-item-b-beta')).toBeInTheDocument();

    const search = screen.getByPlaceholderText('reference.search_refs');
    await user.type(search, 'Beta');

    await waitFor(() => {
      expect(screen.queryByTestId('reference-list-item-a-alpha')).toBeNull();
    });
    expect(screen.getByTestId('reference-list-item-b-beta')).toBeInTheDocument();
  });

  it('点击 + 新建文献并写入 IndexedDB', async () => {
    const user = userEvent.setup();
    const setId = vi.fn();
    await db.articles.add(articleA);

    renderReference(<Reference articles={[articleA]} activeReferenceId="a-alpha" setActiveReferenceId={setId} />);

    const addBtn = screen.getByRole('button', { name: 'reference.add_article' });
    await user.click(addBtn);

    await waitFor(async () => {
      expect(await db.articles.count()).toBe(2);
    });
    const rows = await db.articles.toArray();
    const created = rows.find((r) => r.id !== 'a-alpha');
    expect(created?.title).toBe('reference.new_article_title');
    expect(created?.tags).toEqual([]);
    expect(created?.linkedCanvasIds).toEqual([]);
    expect(setId).toHaveBeenCalledWith(expect.stringMatching(/.+/));
  });

  it('引用文献按钮写入剪贴板', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard);

    const withAuthor = { ...articleA, author: 'Jane' };
    await db.articles.add(withAuthor);

    renderReference(<Reference articles={[withAuthor]} activeReferenceId="a-alpha" setActiveReferenceId={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'reference.citation' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    expect(String(writeText.mock.calls[0][0])).toContain('Alpha Unique Title');
    expect(String(writeText.mock.calls[0][0])).toContain('Jane');
  });

  it('关联画布名称点击调用 onOpenCanvas', async () => {
    const user = userEvent.setup();
    await db.canvases.add({
      id: 'cv-test',
      name: 'Linked Canvas X',
      createdAt: 1,
      updatedAt: 1,
    });
    const linked: Article = {
      ...articleA,
      linkedCanvasIds: ['cv-test'],
    };
    const onOpen = vi.fn();

    renderReference(
      <Reference articles={[linked]} activeReferenceId="a-alpha" setActiveReferenceId={vi.fn()} onOpenCanvas={onOpen} />,
    );

    const canvasBtn = await waitFor(() =>
      screen.getByRole('button', { name: 'Linked Canvas X' }),
    );
    await user.click(canvasBtn);

    expect(onOpen).toHaveBeenCalledWith('cv-test');
  });

  it('引用文献使用草稿作者与日期（未保存到 DB 前）', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard);

    await db.articles.add(articleA);

    renderReference(<Reference articles={[articleA]} activeReferenceId="a-alpha" setActiveReferenceId={vi.fn()} />);

    await user.clear(screen.getByTestId('reference-meta-author'));
    await user.type(screen.getByTestId('reference-meta-author'), 'Draft Author');
    await user.clear(screen.getByTestId('reference-meta-date'));
    await user.type(screen.getByTestId('reference-meta-date'), '2099');

    await user.click(screen.getByRole('button', { name: 'reference.citation' }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const line = String(writeText.mock.calls[0][0]);
    expect(line).toContain('Draft Author');
    expect(line).toContain('2099');
    expect(line).toContain('Alpha Unique Title');
  });

  it('作者元数据防抖写入 IndexedDB', async () => {
    const user = userEvent.setup();
    await db.articles.add(articleA);

    renderReference(<Reference articles={[articleA]} activeReferenceId="a-alpha" setActiveReferenceId={vi.fn()} />);

    await user.clear(screen.getByTestId('reference-meta-author'));
    await user.type(screen.getByTestId('reference-meta-author'), 'Debounced Name');

    await waitFor(
      async () => {
        const row = await db.articles.get('a-alpha');
        expect(row?.author).toBe('Debounced Name');
      },
      { timeout: 3000 },
    );
  });

  it('正文以 Markdown 预览渲染（不裸露 ## 符号）', () => {
    const withMd: Article = {
      ...articleA,
      content: '## 用不确定性交换可能性\n\n段落正文。',
    };
    renderReference(
      <Reference articles={[withMd]} activeReferenceId="a-alpha" setActiveReferenceId={vi.fn()} />,
    );
    expect(screen.getByRole('heading', { level: 2, name: '用不确定性交换可能性' })).toBeInTheDocument();
    expect(screen.getByText('段落正文。')).toBeInTheDocument();
  });

  it('含 Markdown 标题的正文显示目录并可点击', async () => {
    const user = userEvent.setup();
    const withHeadings: Article = {
      ...articleA,
      content: '# Intro Title\n\nBody paragraph.\n\n## Section Two\n\nMore text.',
    };
    await db.articles.add(withHeadings);

    renderReference(
      <Reference articles={[withHeadings]} activeReferenceId="a-alpha" setActiveReferenceId={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'reference.contents' }));
    expect(screen.getByRole('button', { name: 'Intro Title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Section Two' })).toBeInTheDocument();
  });

  it('侧栏删除按钮经确认后从 IndexedDB 移除文献', async () => {
    const user = userEvent.setup();
    await db.articles.bulkAdd([articleA, articleB]);
    const setId = vi.fn();

    renderReference(
      <Reference articles={[articleA, articleB]} activeReferenceId="a-alpha" setActiveReferenceId={setId} />,
    );

    await user.click(screen.getByTestId('reference-delete-a-alpha'));
    await user.click(screen.getByRole('button', { name: 'dialog.confirm' }));

    await waitFor(async () => {
      expect(await db.articles.count()).toBe(1);
    });
    expect((await db.articles.get('b-beta'))).toBeDefined();
    expect(setId).toHaveBeenCalledWith('b-beta');
  });

  it('取消删除确认时不移除文献', async () => {
    const user = userEvent.setup();
    await db.articles.add(articleA);

    renderReference(
      <Reference articles={[articleA]} activeReferenceId="a-alpha" setActiveReferenceId={vi.fn()} />,
    );

    await user.click(screen.getByTestId('reference-delete-a-alpha'));
    await user.click(screen.getByRole('button', { name: 'dialog.cancel' }));
    expect(await db.articles.count()).toBe(1);
  });

  it('不显示分类选择控件', async () => {
    await db.articles.bulkAdd([articleA, articleB]);

    renderReference(
      <Reference articles={[articleA, articleB]} activeReferenceId="a-alpha" setActiveReferenceId={vi.fn()} />,
    );

    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
