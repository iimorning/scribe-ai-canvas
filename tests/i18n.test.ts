import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage for i18n init
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  get length() { return Object.keys(store).length; },
  key: (index: number) => Object.keys(store)[index] ?? null,
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

import i18n from '../src/i18n';

describe('i18n 国际化模块', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  // --- 初始化 ---
  describe('初始化', () => {
    it('i18n 实例已正确初始化', () => {
      expect(i18n).toBeDefined();
      expect(typeof i18n.t).toBe('function');
    });

    it('支持 en 和 zh 两种语言', () => {
      expect(i18n.hasResourceBundle('en', 'translation')).toBe(true);
      expect(i18n.hasResourceBundle('zh', 'translation')).toBe(true);
    });

    it('默认语言为 en（当 localStorage 中无记录时）', () => {
      expect(i18n.language).toBe('en');
    });
  });

  // --- 英文翻译完整性 ---
  describe('英文翻译 (en)', () => {
    beforeEach(() => {
      i18n.changeLanguage('en');
    });

    it('app.name 翻译正确', () => {
      expect(i18n.t('app.name')).toBe('The Memory Architect');
    });

    it('sidebar 翻译完整', () => {
      expect(i18n.t('sidebar.personal')).toBe('Canvas');
      expect(i18n.t('sidebar.reference')).toBe('Essays');
      expect(i18n.t('sidebar.lab')).toBe('Lab');
      expect(i18n.t('sidebar.agents')).toBe('Agents');
      expect(i18n.t('sidebar.new_note')).toBe('New Note');
      expect(i18n.t('sidebar.new_theme_card')).toBe('New Theme Card');
      expect(i18n.t('sidebar.publish')).toBe('Synthesize');
      expect(i18n.t('sidebar.settings')).toBe('Settings');
    });

    it('canvas 翻译完整', () => {
      expect(i18n.t('canvas.zoom')).toBe('Zoom');
      expect(i18n.t('canvas.new_canvas')).toBe('New Canvas');
      expect(i18n.t('canvas.rename')).toBe('Rename');
      expect(i18n.t('canvas.delete_note')).toBe('Delete note');
      expect(i18n.t('canvas.cycle_layout')).toBe('Cycle Layout');
    });

    it('nodes 翻译完整', () => {
      expect(i18n.t('nodes.theme')).toBe('Core Theme');
      expect(i18n.t('nodes.new_theme_title')).toBe('Untitled theme');
      expect(i18n.t('nodes.note')).toBe('Note');
      expect(i18n.t('nodes.ai_refinement')).toBe('AI Refinement');
      expect(i18n.t('nodes.ai_loading')).toBe('Synthesizing...');
    });

    it('settings 翻译完整', () => {
      expect(i18n.t('settings.title')).toBe('Settings');
      expect(i18n.t('settings.api_key')).toBe('API Key');
      expect(i18n.t('settings.save')).toBe('Save Configuration');
      expect(i18n.t('settings.language')).toBe('Language');
      expect(i18n.t('settings.docs_heading')).toContain('Configuration');
      expect(i18n.t('settings.docs_blurb_gemini')).toContain('Google');
      expect(i18n.t('settings.docs_link_gemini_console_key')).toContain('API');
    });

    it('agents 翻译完整', () => {
      expect(i18n.t('agents.personas')).toBe('Personas');
      expect(i18n.t('agents.new_persona')).toBe('New Persona');
      expect(i18n.t('agents.test_sandbox')).toBe('Test Sandbox');
      expect(i18n.t('agents.delete_confirm')).toBe('Are you sure you want to delete this persona?');
      expect(i18n.t('agents.delete_persona')).toBe('Delete persona');
      expect(i18n.t('agents.sandbox_clear')).toBe('Clear chat');
      expect(i18n.t('agents.sandbox_clear_confirm')).toContain('cannot be undone');
    });

    it('lab 翻译完整', () => {
      expect(i18n.t('lab.investigate')).toBe('What would you like to investigate?');
      expect(i18n.t('lab.approve')).toBe('Approve & Execute');
      expect(i18n.t('lab.report')).toBe('Synthesized Report');
      expect(i18n.t('lab.plan_edit_hint').length).toBeGreaterThan(10);
      expect(i18n.t('lab.plan_revision_apply')).toContain('AI');
      expect(i18n.t('lab.ai_revise_decompose', { query: 'Q', plan: '[]', instruction: 'X' })).toContain('Q');
    });

    it('reference 翻译完整', () => {
      expect(i18n.t('reference.index_title')).toBe('Archive Index');
      expect(i18n.t('reference.citation')).toBe('Copy Citation');
      expect(i18n.t('reference.tags')).toBe('Tags');
    });

    it('ai 翻译完整', () => {
      expect(i18n.t('ai.loading')).toBe('AI is thinking...');
      expect(i18n.t('ai.prompts.localeDirective')).toContain('English');
      expect(
        i18n.t('ai.prompts.agentThreadFollowUp', {
          initialContext: 'IC',
          dialogueHistory: 'DH',
          request: 'RQ',
        }),
      ).toContain('IC');
      expect(
        i18n.t('ai.prompts.agentThreadFollowUp', {
          initialContext: 'IC',
          dialogueHistory: 'DH',
          request: 'RQ',
        }),
      ).toContain('RQ');
    });

    it('内置 Agent 系统提示词有英文文案', () => {
      expect(i18n.t('agents.defaults.interviewer.name')).toBe('The Mirror of Insight');
      expect(i18n.t('agents.defaults.stylist.prompt')).toContain('stacking blocks');
    });
  });

  // --- 中文翻译完整性 ---
  describe('中文翻译 (zh)', () => {
    beforeEach(() => {
      i18n.changeLanguage('zh');
    });

    it('app.name 翻译正确', () => {
      expect(i18n.t('app.name')).toBe('记忆建筑师');
    });

    it('sidebar 翻译完整', () => {
      expect(i18n.t('sidebar.personal')).toBe('画布');
      expect(i18n.t('sidebar.reference')).toBe('长文');
      expect(i18n.t('sidebar.lab')).toBe('研究');
      expect(i18n.t('sidebar.agents')).toBe('角色');
      expect(i18n.t('sidebar.new_note')).toBe('新建便签');
      expect(i18n.t('sidebar.new_theme_card')).toBe('新建主题卡');
      expect(i18n.t('sidebar.settings')).toBe('设置');
    });

    it('canvas 翻译完整', () => {
      expect(i18n.t('canvas.zoom')).toBe('缩放');
      expect(i18n.t('canvas.new_canvas')).toBe('新建画布');
      expect(i18n.t('canvas.rename')).toBe('重命名');
      expect(i18n.t('canvas.delete_note')).toBe('删除便签');
    });

    it('nodes 翻译完整', () => {
      expect(i18n.t('nodes.theme')).toBe('核心主题');
      expect(i18n.t('nodes.new_theme_title')).toBe('未命名主题');
      expect(i18n.t('nodes.note')).toBe('笔记');
      expect(i18n.t('nodes.ai_refinement')).toBe('AI 优化');
    });

    it('settings 翻译完整', () => {
      expect(i18n.t('settings.title')).toBe('设置');
      expect(i18n.t('settings.api_key')).toBe('API 密钥');
      expect(i18n.t('settings.save')).toBe('保存配置');
      expect(i18n.t('settings.docs_heading')).toContain('配置');
      expect(i18n.t('settings.docs_blurb_mimo')).toContain('MiMo');
    });

    it('agents 翻译完整', () => {
      expect(i18n.t('agents.personas')).toBe('人格设定');
      expect(i18n.t('agents.new_persona')).toBe('新建人格');
      expect(i18n.t('agents.delete_confirm')).toBe('您确定要删除此人格设定吗？');
      expect(i18n.t('agents.delete_persona')).toBe('删除人格');
      expect(i18n.t('agents.sandbox_clear')).toBe('清空对话');
      expect(i18n.t('agents.sandbox_clear_confirm')).toContain('不可恢复');
    });

    it('ai 翻译完整', () => {
      expect(i18n.t('ai.loading')).toBe('AI 思考中...');
      expect(i18n.t('ai.prompts.localeDirective')).toContain('简体中文');
      expect(
        i18n.t('ai.prompts.agentThreadFollowUp', {
          initialContext: '原文',
          dialogueHistory: '对话',
          request: '问',
        }),
      ).toContain('原文');
    });

    it('内置 Agent 系统提示词有中文文案', () => {
      expect(i18n.t('agents.defaults.interviewer.name')).toBe('真知镜');
      expect(i18n.t('agents.defaults.stylist.prompt')).toContain('文字积木');
    });

    it('lab 翻译完整', () => {
      expect(i18n.t('lab.investigate')).toBe('您想调查什么？');
      expect(i18n.t('lab.idle_intro')).toContain('智能体');
      expect(i18n.t('lab.suggested_tag_1')).toContain('空间编码');
      expect(i18n.t('lab.approve')).toBe('批准并执行');
      expect(i18n.t('lab.plan_revision_apply')).toContain('AI');
      expect(i18n.t('lab.ai_revise_decompose', { query: '问题', plan: '[]', instruction: '改' })).toContain('问题');
    });

    it('reference 翻译完整', () => {
      expect(i18n.t('reference.index_title')).toBe('档案索引');
      expect(i18n.t('reference.citation')).toBe('引用文献');
    });
  });

  // --- 插值 (interpolation) ---
  describe('插值功能', () => {
    it('英文插值正常工作', () => {
      i18n.changeLanguage('en');
      expect(i18n.t('canvas.default_name', { number: 3 })).toBe('Canvas 3');
    });

    it('中文插值正常工作', () => {
      i18n.changeLanguage('zh');
      expect(i18n.t('canvas.default_name', { number: 5 })).toBe('画布 5');
    });

    it('agents 沙盒标题插值正常', () => {
      i18n.changeLanguage('en');
      expect(i18n.t('agents.sandbox_title', { name: 'Weaver' })).toBe('Sandbox: Weaver');
    });

    it('agents 沙盒空消息插值正常', () => {
      i18n.changeLanguage('zh');
      expect(i18n.t('agents.sandbox_empty', { name: '真知镜' })).toBe(
        '正在测试 真知镜 的沙盒。发送消息以查看其根据当前系统提示词的响应。'
      );
    });
  });

  // --- 语言切换 ---
  describe('语言切换', () => {
    it('能在 en 和 zh 之间切换', async () => {
      await i18n.changeLanguage('en');
      expect(i18n.t('app.name')).toBe('The Memory Architect');

      await i18n.changeLanguage('zh');
      expect(i18n.t('app.name')).toBe('记忆建筑师');
    });

    it('未知翻译 key 返回 key 本身', () => {
      i18n.changeLanguage('en');
      expect(i18n.t('nonexistent.key')).toBe('nonexistent.key');
    });
  });
});
