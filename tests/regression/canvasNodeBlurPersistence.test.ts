import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * 源码契约：画布节点内联编辑须在 onBlur 中写 IndexedDB。
 * 若重构 ThemeNode / NoteBody / AiNode，请同步更新本文件中的断言。
 */
const root = join(__dirname, '../..');

function readSrc(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('画布节点 blur 写库源码契约', () => {
  it('ThemeNode：三处字段失焦写库，且聚焦时不被 props 回写（无 onInput 防抖）', () => {
    const src = readSrc('src/components/nodes/ThemeNode.tsx');
    expect(src).toContain('db.nodes.update(node.id, patch)');
    expect(src).toContain("persistField('content')");
    expect(src).toContain("persistField('description')");
    expect(src).toContain("persistField('themeTag')");
    expect(src).toContain('isFocusedRef.current');
    expect(src).not.toContain('onInput');
    expect(src).not.toContain('schedulePersist');
    expect(src).not.toContain('createDebouncedThemePersist');
  });

  it('NoteBody：编辑区 onBlur 写入 content', () => {
    const src = readSrc('src/components/nodes/note/NoteBody.tsx');
    expect(src).toContain('db.nodes.update(node.id, { content: next');
    expect(src).toContain('isContentBlurPersistenceDisabled()');
  });

  it('AiNode：AI 回复编辑区 onBlur 写入 content', () => {
    const src = readSrc('src/components/nodes/AiNode.tsx');
    expect(src).toContain('db.nodes.update(node.id, { content: e.currentTarget.innerText');
    expect(src).toContain('isContentBlurPersistenceDisabled()');
  });

  it('commitCanvasInlineEditing：主题卡无 editingNodeId 时仍 blur 焦点元素', () => {
    const src = readSrc('src/utils/commitCanvasInlineEditing.ts');
    expect(src).not.toMatch(/if\s*\(\s*!editingNodeId\s*\)\s*return/);
    expect(src).toContain('主题卡等始终 contentEditable');
  });

  it('App：通过 registerCanvasUnloadFlush 注册卸载前 flush', () => {
    const appSrc = readSrc('src/App.tsx');
    expect(appSrc).toContain('registerCanvasUnloadFlush');
    expect(appSrc).not.toContain('blurActiveContentEditable');
    const regSrc = readSrc('src/utils/registerCanvasUnloadFlush.ts');
    expect(regSrc).toContain('pagehide');
    expect(regSrc).toContain('beforeunload');
    expect(regSrc).toContain('blurActiveContentEditable');
  });

  it('CanvasToolbar：提交钮为 Wand2、输入条旁无多余 Wand2', () => {
    const src = readSrc('src/components/CanvasToolbar.tsx');
    expect(src).not.toContain('Send');
    expect(src).toMatch(/isToolbarAiLoading \? <Loader2[\s\S]*?: <Wand2/);
    const wandCount = (src.match(/<Wand2/g) ?? []).length;
    // 1× 提交钮 + 1× 折叠态圆形手柄，均合法。
    expect(wandCount).toBe(2);
  });
});
