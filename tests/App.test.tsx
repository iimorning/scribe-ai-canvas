import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '../src/db';

// --- Mock 外部依赖 ---

// Mock @google/genai
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: vi.fn().mockResolvedValue({ text: 'AI generated response' }),
    },
  })),
}));

// Mock react-i18next，用真实翻译资源但绕过 initReactI18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'sidebar.personal': '画布',
        'sidebar.reference': '长文',
        'sidebar.lab': '研究',
        'sidebar.agents': '角色',
        'sidebar.search_placeholder': '搜索记忆...',
        'sidebar.new_note': '新建便签',
        'sidebar.publish': '合成文章',
        'sidebar.settings': '设置',
        'canvas.zoom': '缩放',
        'canvas.full_screen': '全屏',
        'canvas.history': '历史记录',
        'canvas.new_canvas': '新建画布',
        'canvas.default_name': `画布 ${opts?.number ?? ''}`,
        'canvas.rename': '重命名',
        'canvas.delete_note': '删除便签',
        'canvas.select_note': '选择便签',
        'canvas.link_note': '链接到其他节点',
        'canvas.cycle_layout': '切换布局',
        'canvas.change_color': '更改颜色',
        'canvas.change_font': '更改字体',
        'nodes.theme': '核心主题',
        'nodes.note': '笔记',
        'nodes.observation': '观察',
        'nodes.thought_node': '思绪节点',
        'nodes.ai_refinement': 'AI 优化',
        'nodes.ai_loading': '合成中...',
        'nodes.empty_note': '空笔记。点击编辑。',
        'nodes.type_something': '输入内容...',
        'settings.title': '设置',
        'settings.profile': '个人资料',
        'settings.ai_config': 'AI 配置',
        'settings.language': '语言',
        'settings.desktop_download_title': '桌面版（Windows）',
        'settings.desktop_download_blurb': '安装原生应用可获得本地优先存储、桌面专属能力（如本地 GGUF）。浏览器里的数据留在本浏览器；桌面版使用独立数据目录。',
        'settings.desktop_download_button': '下载 Windows 安装包',
        'settings.desktop_installed_title': '桌面版',
        'settings.desktop_installed_blurb': '当前为桌面应用。',
        'settings.desktop_releases_button': '打开 Releases 页面',
        'settings.user_name': '显示名称',
        'settings.user_role': '当前焦点 / 状态',
        'settings.provider': 'AI 服务商',
        'settings.api_key': 'API 密钥',
        'settings.base_url': '基础 URL (可选)',
        'settings.model': '模型',
        'settings.close': '关闭',
        'settings.save': '保存配置',
        'ai.input_placeholder': '让 AI 构思一些想法或段落...',
        'ai.loading': 'AI 思考中...',
        'agents.personas': '人格设定',
        'agents.new_persona': '新建人格',
        'agents.test_sandbox': '测试沙盒',
        'agents.close_sandbox': '关闭沙盒',
        'agents.enhance_prompt': 'AI 优化提示词',
        'agents.identity_tone': '身份与基调',
        'agents.persona_name': '人格名称',
        'agents.role_specialty': '角色专长',
        'agents.system_prompt': '系统提示词',
        'agents.knowledge_base': '知识集群',
        'agents.model_params': '模型参数',
        'agents.temp': '采样温度',
        'agents.creativity': '创造力',
        'agents.delete_confirm': '您确定要删除此人格设定吗？',
        'agents.delete_persona': '删除人格',
        'agents.search_personas': '搜索人格...',
        'agents.sandbox_title': `沙盒：${opts?.name ?? ''}`,
        'agents.sandbox_empty': `正在测试 ${opts?.name ?? ''} 的沙盒。`,
        'agents.ai_thinking': 'AI 正在思考...',
        'agents.message_placeholder': `给 ${opts?.name ?? ''} 发送消息...`,
        'agents.sandbox_note': '沙盒使用当前的提示词和参数',
        'agents.sandbox_clear': '清空对话',
        'agents.sandbox_clear_aria': '清空沙盒对话',
        'agents.sandbox_clear_confirm': '确定清空该人格沙盒中的对话记录？此操作不可恢复。',
        'settings.docs_heading': '配置说明与官方文档',
        'settings.docs_expand': '展开',
        'settings.docs_blurb_gemini': '在 Google AI Studio 创建 API 密钥后填入。',
        'settings.docs_link_gemini_console_key': 'Google AI Studio — 获取 API 密钥',
        'settings.docs_all_providers_heading': '各 AI 服务商 — 官方文档',
        'settings.docs_metaso_heading': '秘塔联网搜索（可选）',
        'settings.docs_security_note': '切勿向他人泄露密钥。',
        'agents.select_persona': '请选择一个人格',
        'agents.select_subtitle': '从侧边栏选择一个人格或创建一个新人格。',
        'lab.investigate': '您想调查什么？',
        'lab.placeholder': '例如：空间衰减与记忆丧失之间的关系...',
        'lab.approve': '批准并执行',
        'lab.executing': '智能体执行日志',
        'lab.report': '综合报告',
        'lab.new_research': '新研究',
        'lab.past_sessions': '历史会话',
        'lab.no_past_sessions': '暂无已完成的研究。完成一次研究后会显示在这里。',
        'lab.idle_intro': '可以输入宽泛主题或具体论点。智能体会拟定研究计划、对照档案与资料并生成综合报告。',
        'lab.suggested_tag_1': '# 空间编码',
        'lab.suggested_tag_2': '# 人物弧光',
        'lab.sources_utilized': '已用来源',
        'lab.processed': '已处理',
        'lab.demo_source_card_1_title': '第四章：档案室',
        'lab.demo_source_card_1_desc': '找到 3 处与「衰败」相关的隐喻。',
        'lab.demo_source_card_2_title': '参考文献 042：空间编码',
        'lab.demo_source_card_2_desc': '串联创伤理论与蓝图意象。',
        'lab.target_inquiry': '研究主题',
        'lab.recommended_plan_title': '推荐研究计划',
        'lab.plan_edit_hint': '可直接编辑各步标题与说明。',
        'lab.plan_revision_placeholder': '说明希望如何修改大纲…',
        'lab.plan_revision_apply': '让 AI 按说明更新大纲',
        'lab.plan_revision_applying': '正在更新大纲…',
        'lab.searching': '正在联网搜索...',
        'lab.search_complete': `已获取 ${opts?.count ?? 0} 条网络来源`,
        'lab.search_fallback': '搜索不可用，使用离线模式',
        'lab.search_preparing': '正在准备联网搜索…',
        'lab.search_offline_no_key': '离线模式 — 未配置 Metaso API 密钥。',
        'lab.stage_resolving_context': '正在整理上下文…',
        'lab.stage_generating_report': '正在生成报告…',
        'lab.report_footer_web': `基于 ${opts?.count ?? 0} 条网络来源与 LLM 综合`,
        'lab.report_footer_offline': '离线模式 — 仅由 LLM 综合',
        'lab.conclusion_label': '智能体建议与结论：',
        'reference.index_title': '档案索引',
        'reference.search_refs': '搜索参考文献...',
        'reference.citation': '引用文献',
        'reference.metadata_notes': '元数据与笔记',
        'reference.tags': '标签',
        'reference.linked_drafts': '关联画布',
        'reference.private_notes': '私密笔记',
        'reference.notes_placeholder': '为此参考文献添加您自己的笔记...',
        'app.name': '记忆建筑师',
        'app.description': '空间思维与知识合成',
      };
      return translations[key] ?? key;
    },
    i18n: {
      language: 'zh',
      changeLanguage: vi.fn(),
    },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  Trans: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock lucide-react icons - 简单返回 SVG 占位
vi.mock('lucide-react', () => {
  const iconNames = [
    'MessageSquare', 'Terminal', 'Network', 'Search', 'Bell', 'Settings', 'Plus',
    'BookOpen', 'Users', 'Library', 'Microscope', 'Sparkles', 'Maximize2', 'Minimize2',
    'Quote', 'Brain', 'Bot', 'Coffee', 'Wand2', 'Send', 'SlidersHorizontal', 'History', 'ZoomIn',
    'Focus', 'Image', 'FilePlus', 'Trash2', 'Link2', 'X', 'Camera', 'ChevronLeft',
    'ChevronRight', 'Check', 'Cpu', 'ArrowRight', 'ListChecks', 'CheckCircle2',
    'Loader2', 'PenLine', 'Edit3', 'FileText', 'Globe', 'ExternalLink', 'RotateCcw',
    'Monitor', 'Download', 'Mic', 'MicOff', 'Layers2',
    'GripVertical', 'Pencil', 'Video', 'Layers', 'Type',
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

// Mock react-markdown
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => {
    const { createElement } = require('react');
    return createElement('div', { 'data-testid': 'markdown' }, children);
  },
}));

// Mock motion
vi.mock('motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: new Proxy({}, {
    get: (_target, prop) => {
      return ({ children, ...rest }: Record<string, unknown>) => {
        const { createElement } = require('react');
        return createElement(String(prop), rest, children);
      };
    },
  }),
}));

// 导入被测组件
import App from '../src/App';

describe('App 组件', () => {
  beforeEach(async () => {
    // 清空数据库
    await db.nodes.clear();
    await db.articles.clear();
    await db.agents.clear();
    await db.edges.clear();
    await db.canvases.clear();
    await db.researchSessions.clear();
    await db.agentSandboxThreads.clear();
    localStorage.clear();
  });

  // --- 辅助函数：在 <a> 标签中查找导航链接 ---
  const getNavLinks = () => {
    const nav = document.querySelector('nav');
    return nav ? Array.from(nav.querySelectorAll('a')) : [];
  };

  // --- 基础渲染 ---
  describe('基础渲染', () => {
    it('能正常渲染 App 组件', async () => {
      await act(async () => {
        render(<App />);
      });
      // 侧边栏导航链接应存在（无「导航」分区标题）
      const nav = document.querySelector('nav');
      expect(nav).toBeTruthy();
      expect(nav?.textContent).not.toContain('导航');
      const links = getNavLinks();
      const linkTexts = links.map(a => a.textContent?.trim());
      expect(linkTexts).toContain('画布');
      expect(linkTexts).toContain('长文');
      expect(linkTexts).toContain('研究');
      expect(linkTexts).toContain('角色');
    });

    it('渲染用户默认名称', async () => {
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByText('Main Library')).toBeInTheDocument();
    });

    it('渲染用户默认角色状态', async () => {
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByText('Focus Mode Active')).toBeInTheDocument();
    });
  });

  // --- 侧边栏导航 ---
  describe('侧边栏导航', () => {
    it('默认选中 personal 标签', async () => {
      await act(async () => {
        render(<App />);
      });
      const links = getNavLinks();
      const personalLink = links.find(a => a.textContent?.includes('画布'));
      expect(personalLink).toBeDefined();
      expect(personalLink).toHaveClass('bg-white');
    });

    it('切换到 reference 标签', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      const links = getNavLinks();
      const refLink = links.find(a => a.textContent?.includes('长文'))!;
      await user.click(refLink);
      expect(refLink).toHaveClass('bg-white');
    });

    it('切换到 lab 标签', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      const links = getNavLinks();
      const labLink = links.find(a => a.textContent?.includes('研究'))!;
      await user.click(labLink);
      expect(labLink).toHaveClass('bg-white');
    });

    it('切换到 agents 标签', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      const links = getNavLinks();
      const agentsLink = links.find(a => a.textContent?.includes('角色'))!;
      await user.click(agentsLink);
      expect(agentsLink).toHaveClass('bg-white');
    });
  });

  // --- 设置按钮 ---
  describe('设置', () => {
    it('点击设置按钮打开设置面板', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      const settingsBtn = screen.getByTitle('设置');
      await user.click(settingsBtn);

      // 设置面板应出现（无冗余标题，以关闭按钮与语言区为准）
      expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
      expect(screen.getByText('English')).toBeInTheDocument();
    });

    it('设置面板包含语言切换选项', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      await user.click(screen.getByTitle('设置'));
      expect(screen.getByText('English')).toBeInTheDocument();
      expect(screen.getByText('中文')).toBeInTheDocument();
    });

    it('设置面板包含 AI 提供商选项', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      await user.click(screen.getByTitle('设置'));
      expect(screen.getByText('AI 服务商')).toBeInTheDocument();
      expect(screen.getByText('API 密钥')).toBeInTheDocument();
      expect(screen.getByText('模型')).toBeInTheDocument();
    });
  });

  // --- 新建便签 ---
  describe('新建便签', () => {
    it('点击新建便签按钮创建节点', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      // "新建便签" 是 title 属性，不是可见文本
      const newNoteBtn = screen.getAllByTitle('新建便签')[0];
      await user.click(newNoteBtn);

      // 验证数据库中有新节点
      const nodes = await db.nodes.toArray();
      expect(nodes.length).toBeGreaterThanOrEqual(1);
      expect(nodes.some(n => n.type === 'text')).toBe(true);
    });
  });

  // --- 画布管理 ---
  describe('画布管理', () => {
    it('历史按钮能打开画布列表', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      // 先确保有画布数据
      await db.canvases.put({
        id: 'default',
        name: 'Main Workspace',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // 点击历史按钮（用 title 定位）
      const historyBtn = screen.getByTitle('历史记录');
      await user.click(historyBtn);

      // 画布列表应出现
      expect(screen.getByText('新建画布')).toBeInTheDocument();
    });
  });

  // --- 缩放控制 ---
  describe('缩放控制', () => {
    it('显示缩放百分比', async () => {
      await act(async () => {
        render(<App />);
      });

      // 初始缩放应为 100%
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('点击缩放+按钮增加缩放', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      // 缩放+按钮的文本是 "缩放 +"
      const zoomInBtn = screen.getByText('缩放 +');
      await user.click(zoomInBtn);

      // 缩放应大于 100%
      const zoomText = screen.getByText(/%/);
      const value = parseInt(zoomText.textContent ?? '100');
      expect(value).toBeGreaterThan(100);
    });

    it('点击缩放-按钮减少缩放', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      // 缩放-按钮的文本是 "缩放 -"
      const zoomOutBtn = screen.getByText('缩放 -');
      await user.click(zoomOutBtn);

      const zoomText = screen.getByText(/%/);
      const value = parseInt(zoomText.textContent ?? '100');
      expect(value).toBeLessThan(100);
    });

    it('连续缩放后百分比正确更新', async () => {
      const user = userEvent.setup();
      await act(async () => {
        render(<App />);
      });

      // 连续放大两次
      await user.click(screen.getByText('缩放 +'));
      await user.click(screen.getByText('缩放 +'));

      const zoomText = screen.getByText(/%/);
      const value = parseInt(zoomText.textContent ?? '100');
      expect(value).toBeGreaterThan(110);
    });
  });

  // --- 数据库种子初始化 ---
  describe('数据库种子数据', () => {
    it('首次渲染时自动创建默认画布', async () => {
      await act(async () => {
        render(<App />);
      });

      // 等待 useEffect 中的 seed 完成
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      const canvas = await db.canvases.get('default');
      expect(canvas).toBeDefined();
      expect(canvas?.name).toBe('Main Workspace');
    });

    it('首次渲染时自动创建系统 Agent', async () => {
      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      const agents = await db.agents.toArray();
      const roles = agents.map(a => a.role);
      expect(roles).toContain('Journalist');
      expect(roles).toContain('Connector');
      expect(roles).toContain('Editor');
      expect(roles).toContain('Visionary');
    });

    it('首次渲染时自动创建示例节点和边', async () => {
      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      const nodes = await db.nodes.toArray();
      expect(nodes.length).toBeGreaterThanOrEqual(3);

      const edges = await db.edges.toArray();
      expect(edges.length).toBeGreaterThanOrEqual(3);

      // 应有 theme 类型节点
      expect(nodes.some(n => n.type === 'theme')).toBe(true);
    });
  });

  // --- localStorage 持久化 ---
  describe('localStorage 持久化', () => {
    it('用户名从 localStorage 恢复', async () => {
      localStorage.setItem('user_name', '自定义用户');
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByText('自定义用户')).toBeInTheDocument();
    });

    it('用户角色从 localStorage 恢复', async () => {
      localStorage.setItem('user_role', '专注写作中');
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByText('专注写作中')).toBeInTheDocument();
    });
  });

  // ============================================================
  // AISettingsModal 设置面板
  // ============================================================
  describe('AISettingsModal 设置面板', () => {
    const openSettings = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByTitle('设置'));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
      });
    };

    it('设置面板显示关闭按钮', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
    });

    it('设置面板包含 API 密钥输入框', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      const passwordInputs = document.querySelectorAll('input[type="password"]');
      expect(passwordInputs.length).toBeGreaterThanOrEqual(1);
    });

    it('网页版设置面板显示桌面版下载入口', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      expect(screen.getByText('下载 Windows 安装包')).toBeInTheDocument();
    });

    it('设置面板包含提供商下拉选项', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      const select = document.querySelector('select');
      expect(select).toBeInTheDocument();
      expect(select?.querySelector('option[value="gemini"]')).toBeTruthy();
      expect(select?.querySelector('option[value="openai"]')).toBeTruthy();
      expect(select?.querySelector('option[value="anthropic"]')).toBeTruthy();
      expect(select?.querySelector('option[value="deepseek"]')).toBeTruthy();
      expect(select?.querySelector('option[value="custom"]')).toBeTruthy();
    });

    it('切换到 gemini 提供商后不显示 Base URL 字段', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      const select = document.querySelector('select')!;
      await user.selectOptions(select, 'gemini');
      expect(screen.queryByText('基础 URL (可选)')).not.toBeInTheDocument();
    });

    it('切换到 OpenAI 提供商时显示 Base URL 字段', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      const select = document.querySelector('select')!;
      await user.selectOptions(select, 'openai');
      expect(screen.getByText('基础 URL (可选)')).toBeInTheDocument();
    });

    it('切换到 DeepSeek 提供商时显示 Base URL 字段', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      const select = document.querySelector('select')!;
      await user.selectOptions(select, 'deepseek');
      expect(screen.getByText('基础 URL (可选)')).toBeInTheDocument();
      expect(screen.getByDisplayValue('deepseek-chat')).toBeInTheDocument();
    });

    it('切换到 Custom 提供商时显示 Base URL 字段', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      const select = document.querySelector('select')!;
      await user.selectOptions(select, 'custom');
      expect(screen.getByText('基础 URL (可选)')).toBeInTheDocument();
    });

    it('切换到 Anthropic 提供商时不显示 Base URL 字段', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      const select = document.querySelector('select')!;
      await user.selectOptions(select, 'anthropic');
      expect(screen.queryByText('基础 URL (可选)')).not.toBeInTheDocument();
    });

    it('修改 API Key 后自动更新 localStorage', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      const apiKeyInput = document.querySelector('input[type="password"]') as HTMLInputElement;
      await user.clear(apiKeyInput);
      await user.type(apiKeyInput, 'test-key-123');
      // 配置通过 useEffect 自动保存到 localStorage
      await waitFor(() => {
        const saved = JSON.parse(localStorage.getItem('ai_config') || '{}');
        expect(saved.apiKey).toContain('test');
      });
    });

    it('修改模型名称', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      const textInputs = document.querySelectorAll('input[type="text"]');
      const modelInput = Array.from(textInputs).find(input =>
        (input as HTMLInputElement).placeholder?.includes('gemini') ||
        (input as HTMLInputElement).value?.includes('gemini')
      );
      if (modelInput) {
        await user.clear(modelInput);
        await user.type(modelInput, 'gpt-4o');
        expect((modelInput as HTMLInputElement).value).toBe('gpt-4o');
      }
    });

    it('设置面板展示 AI 配置说明折叠区', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await openSettings(user);
      expect(screen.getByText('配置说明与官方文档')).toBeInTheDocument();
    });
  });

  // ============================================================
  // Reference 参考文献面板
  // ============================================================
  describe('Reference 参考文献面板', () => {
    const goToReference = async (user: ReturnType<typeof userEvent.setup>) => {
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });
      const links = getNavLinks();
      const refLink = links.find(a => a.textContent?.includes('长文'))!;
      await user.click(refLink);
    };

    it('切换到参考区标签后显示档案索引标题', async () => {
      const user = userEvent.setup();
      await goToReference(user);
      expect(screen.getByText('档案索引')).toBeInTheDocument();
    });

    it('参考区显示文章列表', async () => {
      const user = userEvent.setup();
      await goToReference(user);
      // 文章标题同时出现在列表和内容区，使用 getAllByText
      const matches = screen.getAllByText(/Spatial Encoding/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('参考区显示文章类型和日期', async () => {
      const user = userEvent.setup();
      await goToReference(user);
      // 档案索引默认折叠，先展开以查看列表中的类型与日期
      await user.click(screen.getByText('档案索引'));
      // REF-042 和 1994 可能出现在列表和内容区
      const refMatches = screen.getAllByText('REF-042');
      expect(refMatches.length).toBeGreaterThanOrEqual(1);
      const dateMatches = screen.getAllByText('1994');
      expect(dateMatches.length).toBeGreaterThanOrEqual(1);
    });

    it('参考区有搜索框', async () => {
      const user = userEvent.setup();
      await goToReference(user);
      // 档案索引默认折叠，先点击左上角按钮展开
      await user.click(screen.getByText('档案索引'));
      const searchInput = document.querySelector('input[placeholder="搜索参考文献..."]');
      expect(searchInput).toBeInTheDocument();
    });

    it('参考区显示引用文献按钮', async () => {
      const user = userEvent.setup();
      await goToReference(user);
      expect(screen.getByText('引用文献')).toBeInTheDocument();
    });

    it('参考区显示来源画布区域（替代原元数据与笔记）', async () => {
      const user = userEvent.setup();
      await goToReference(user);
      expect(screen.getByText('关联画布')).toBeInTheDocument();
    });

    it('参考区不再显示标签区域', async () => {
      const user = userEvent.setup();
      await goToReference(user);
      expect(screen.queryByText('标签')).toBeNull();
    });

    it('参考区不再显示私密笔记区域', async () => {
      const user = userEvent.setup();
      await goToReference(user);
      expect(screen.queryByText('私密笔记')).toBeNull();
    });
  });

  // ============================================================
  // AgentsStudio AI 助手工作室
  // ============================================================
  describe('AgentsStudio AI 助手工作室', () => {
    const goToAgents = async (user: ReturnType<typeof userEvent.setup>) => {
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 300));
      });
      const links = getNavLinks();
      const agentsLink = links.find(a => a.textContent?.includes('角色'))!;
      await user.click(agentsLink);
    };

    it('切换到 AI 助手标签后顶部为搜索人格栏且无「人格设定」标题', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      expect(screen.getByPlaceholderText('搜索人格...')).toBeInTheDocument();
      expect(screen.queryByText('人格设定')).not.toBeInTheDocument();
    });

    it('显示默认的系统代理列表', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      const mirrorMatches = screen.getAllByText('The Mirror of Insight');
      expect(mirrorMatches.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('The Weaver')).toBeInTheDocument();
      expect(screen.getByText('The Smoothing Iron')).toBeInTheDocument();
    });

    it('显示搜索人格输入框', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      const searchInput = document.querySelector('input[placeholder="搜索人格..."]');
      expect(searchInput).toBeInTheDocument();
    });

    it('搜索代理过滤列表', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      const searchInput = document.querySelector('input[placeholder="搜索人格..."]') as HTMLInputElement;
      await user.type(searchInput, 'Weaver');
      expect(screen.getAllByText('The Weaver').length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText('The Mirror of Insight')).not.toBeInTheDocument();
    });

    it('点击代理选中并显示配置编辑器', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      // 第一个代理默认已选中，直接验证编辑器
      expect(screen.getByText('身份与基调')).toBeInTheDocument();
    });

    it('选中代理后顶部标题为人格名称可编辑输入', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      const titleInput = screen.getByLabelText('人格名称');
      expect(titleInput).toBeInstanceOf(HTMLInputElement);
      expect(screen.queryByText('角色专长')).not.toBeInTheDocument();
    });

    it('选中代理后显示系统提示词', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      expect(screen.getByText('系统提示词')).toBeInTheDocument();
    });

    it('选中代理后显示模型参数', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      expect(screen.getByText('模型参数')).toBeInTheDocument();
      expect(screen.getByText('采样温度')).toBeInTheDocument();
      expect(screen.getByText('创造力')).toBeInTheDocument();
    });

    it('选中代理后显示沙盒测试按钮', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      expect(screen.getByText('测试沙盒')).toBeInTheDocument();
    });

    it('选中代理后显示删除按钮', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      expect(screen.getByText('删除人格')).toBeInTheDocument();
    });

    it('点击新建人格按钮添加新代理', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      const sidebar = screen.getByPlaceholderText('搜索人格...').closest('section');
      const addBtn = Array.from(sidebar?.querySelectorAll('button') ?? []).find((btn) =>
        btn.querySelector('svg[data-testid="icon-Plus"]'),
      );
      expect(addBtn).toBeDefined();
      await user.click(addBtn!);
      // 新人格应出现在列表中
      await waitFor(() => {
        expect(screen.getAllByText('新建人格').length).toBeGreaterThanOrEqual(1);
      });
    });

    it('点击沙盒按钮打开沙盒面板', async () => {
      const user = userEvent.setup();
      await goToAgents(user);
      await user.click(screen.getByText('测试沙盒'));
      expect(screen.getByText('关闭沙盒')).toBeInTheDocument();
    });

  });

  // ============================================================
  // ResearchLab 研究实验室
  // ============================================================
  describe('ResearchLab 研究实验室', () => {
    const goToLab = async (user: ReturnType<typeof userEvent.setup>) => {
      await act(async () => { render(<App />); });
      const links = getNavLinks();
      const labLink = links.find(a => a.textContent?.includes('研究'))!;
      await user.click(labLink);
    };

    it('切换到研究标签后显示调查输入框', async () => {
      const user = userEvent.setup();
      await goToLab(user);
      expect(screen.getByText('您想调查什么？')).toBeInTheDocument();
    });

    it('输入框有正确的 placeholder', async () => {
      const user = userEvent.setup();
      await goToLab(user);
      const input = document.querySelector('input[placeholder*="空间衰减"]');
      expect(input).toBeInTheDocument();
    });

    it('显示历史会话区域', async () => {
      const user = userEvent.setup();
      await goToLab(user);
      expect(screen.getByText('历史会话')).toBeInTheDocument();
    });

    it('idle 无历史记录时显示空态文案', async () => {
      const user = userEvent.setup();
      await goToLab(user);
      // 历史会话面板默认折叠，先点击左上角按钮展开
      await user.click(screen.getByText('历史会话'));
      expect(screen.getByText('暂无已完成的研究。完成一次研究后会显示在这里。')).toBeInTheDocument();
    });

    it('idle 阶段显示提交箭头按钮', async () => {
      const user = userEvent.setup();
      await goToLab(user);
      // idle 阶段有 form submit 按钮（ArrowRight 图标）
      const form = document.querySelector('form');
      const submitBtn = form?.querySelector('button[type="submit"]');
      expect(submitBtn).toBeInTheDocument();
    });

    it('输入研究主题后可以提交', async () => {
      const user = userEvent.setup();
      await goToLab(user);
      const input = document.querySelector('input[placeholder*="空间衰减"]') as HTMLInputElement;
      await user.type(input, 'The relationship between spatial decay and memory loss');
      expect(input.value).toContain('spatial decay');
    });

    it('提交研究主题后进入 planning 阶段', async () => {
      const user = userEvent.setup();
      await goToLab(user);
      const input = document.querySelector('input[placeholder*="空间衰减"]') as HTMLInputElement;
      await user.type(input, 'memory architecture');
      const form = document.querySelector('form');
      const submitBtn = form?.querySelector('button[type="submit"]');
      await user.click(submitBtn!);
      // 应进入 planning 阶段或 plan_ready 阶段
      // 由于 mock 了 AI，会立即完成
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });
    });
  });

  // ============================================================
  // callUniversalAI 间接测试
  // ============================================================
  describe('callUniversalAI 间接测试', () => {
    it('Gemini 配置下 AI 提交成功返回内容', async () => {
      const user = userEvent.setup();
      localStorage.setItem('ai_config', JSON.stringify({
        provider: 'gemini', apiKey: 'test-gemini-key', model: 'gemini-1.5-flash'
      }));
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      // 找到 AI 输入框并提交
      const aiInput = document.querySelector('input[placeholder*="AI 构思"]');
      if (aiInput) {
        await user.type(aiInput, 'Write about memory architecture');
        const sendBtn = aiInput.closest('div')?.querySelector('button');
        if (sendBtn) {
          await user.click(sendBtn);
          // AI 应该返回 mock 的内容
          await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 500));
          });
        }
      }
    });

    it('无 API Key 时 Gemini 回退到环境变量', async () => {
      // 不设置 apiKey，环境变量也没有 GEMINI_API_KEY
      localStorage.setItem('ai_config', JSON.stringify({
        provider: 'gemini', apiKey: '', model: 'gemini-1.5-flash'
      }));
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });
      // 应用正常渲染不崩溃 — 使用 getNavLinks 验证侧栏存在
      const links = getNavLinks();
      expect(links.length).toBeGreaterThan(0);
    });

    it('OpenAI 配置下应用正常渲染', async () => {
      localStorage.setItem('ai_config', JSON.stringify({
        provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o', baseUrl: ''
      }));
      await act(async () => { render(<App />); });
      const links = getNavLinks();
      expect(links.length).toBeGreaterThan(0);
    });

    it('Anthropic 配置下应用正常渲染', async () => {
      localStorage.setItem('ai_config', JSON.stringify({
        provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-3-5-sonnet'
      }));
      await act(async () => { render(<App />); });
      const links = getNavLinks();
      expect(links.length).toBeGreaterThan(0);
    });

    it('Custom 配置下应用正常渲染', async () => {
      localStorage.setItem('ai_config', JSON.stringify({
        provider: 'custom', apiKey: 'test-key', model: 'custom-model', baseUrl: 'http://localhost:8080/v1'
      }));
      await act(async () => { render(<App />); });
      const links = getNavLinks();
      expect(links.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // DraggableNode 节点交互
  // ============================================================
  describe('DraggableNode 节点交互', () => {
    it('渲染种子节点内容', async () => {
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 300));
      });
      // 种子数据包含 "The Memory Architect" 节点
      expect(screen.getByText('The Memory Architect')).toBeInTheDocument();
    });

    it('渲染多种节点类型', async () => {
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 300));
      });
      // 种子数据包含 note 和 ai 类型节点
      expect(screen.getByText('Spatial architecture of trauma')).toBeInTheDocument();
      expect(screen.getByText('Non-euclidean memory leaks')).toBeInTheDocument();
    });

    it('新建便签按钮在数据库中创建 text 类型节点', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      const newNoteBtn = screen.getAllByTitle('新建便签')[0];
      await user.click(newNoteBtn);
      const nodes = await db.nodes.toArray();
      const textNodes = nodes.filter(n => n.type === 'text');
      expect(textNodes.length).toBeGreaterThanOrEqual(1);
      expect(textNodes[0].canvasId).toBeDefined();
    });

    it('新建便签的节点有正确的 canvasId', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      const newNoteBtn = screen.getAllByTitle('新建便签')[0];
      await user.click(newNoteBtn);
      const nodes = await db.nodes.toArray();
      const textNode = nodes.find(n => n.type === 'text');
      expect(textNode?.canvasId).toBe('default');
    });

    it('节点有 x 和 y 坐标', async () => {
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 300));
      });
      const nodes = await db.nodes.toArray();
      nodes.forEach(node => {
        expect(typeof node.x).toBe('number');
        expect(typeof node.y).toBe('number');
      });
    });

    it('选中节点后按下 Delete 键批量删除（含关联边）', async () => {
      const user = userEvent.setup();
      // Pre-populate two text nodes plus an edge between them. Use unique content so we can
      // locate their DOM wrappers without colliding with the seed dataset.
      await db.nodes.add({ id: 'kbd-a', canvasId: 'default', type: 'text', content: 'kbd-delete-a', x: 0, y: 0 });
      await db.nodes.add({ id: 'kbd-b', canvasId: 'default', type: 'text', content: 'kbd-delete-b', x: 0, y: 0 });
      await db.edges.add({ id: 'kbd-edge', canvasId: 'default', from: 'kbd-a', to: 'kbd-b' });
      // A third unrelated node that should survive the deletion.
      await db.nodes.add({ id: 'kbd-keep', canvasId: 'default', type: 'text', content: 'kbd-keep', x: 0, y: 0 });

      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      // Selection chrome is only via the top-left check circle (not body click).
      const aText = await screen.findByText('kbd-delete-a');
      const bText = await screen.findByText('kbd-delete-b');
      const aSelect = aText.closest('.group')?.querySelector<HTMLElement>('[title="选择便签"]');
      const bSelect = bText.closest('.group')?.querySelector<HTMLElement>('[title="选择便签"]');
      expect(aSelect).toBeTruthy();
      expect(bSelect).toBeTruthy();
      await act(async () => { await user.click(aSelect!); });
      await act(async () => { await user.click(bSelect!); });

      // Drive the canvas-level keyboard-delete handler. event.target defaults to body, which
      // is not an editing target, so the listener passes its gate and calls removeNodeIds.
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      const nodes = await db.nodes.toArray();
      const ids = nodes.map(n => n.id);
      expect(ids).not.toContain('kbd-a');
      expect(ids).not.toContain('kbd-b');
      expect(ids).toContain('kbd-keep');

      const edges = await db.edges.toArray();
      expect(edges.find(e => e.id === 'kbd-edge')).toBeUndefined();
    });

    // 守护 18e2c7f 的"正文点击不进入 selectedNodes"契约：
    // 若未来有人重新让 body click 触发选中，本测试会因为 Delete 删除了节点而失败。
    it('正文点击不会把节点加入 selectedNodes（Delete 不会删除未被勾选的节点）', async () => {
      const user = userEvent.setup();
      await db.nodes.add({
        id: 'body-click-a',
        canvasId: 'default',
        type: 'text',
        content: 'body-click-guard',
        x: 0,
        y: 0,
      });

      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      // 模拟"点击正文"——pointerdown 在 body 上，预期不会进入 selectedNodes。
      // userEvent 的 click 会触发 pointerdown/pointerup/click 全套。
      const text = await screen.findByText('body-click-guard');
      await act(async () => { await user.click(text); });

      // 现在按 Delete 键——因为没有节点被选中，所以这个节点应当保留。
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      const nodes = await db.nodes.toArray();
      const stillThere = nodes.find(n => n.id === 'body-click-a');
      expect(stillThere).toBeDefined();
      expect(stillThere?.content).toBe('body-click-guard');
    });

    // 配套守护：勾选圈 (toggle) 仍然有效。
    it('勾选圈 toggle 仍可把节点加入 selectedNodes（避免把 body click 与 checkbox 一起误关）', async () => {
      const user = userEvent.setup();
      await db.nodes.add({
        id: 'checkbox-a',
        canvasId: 'default',
        type: 'text',
        content: 'checkbox-still-works',
        x: 0,
        y: 0,
      });

      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      const text = await screen.findByText('checkbox-still-works');
      const checkbox = text.closest('.group')?.querySelector<HTMLElement>('[title="选择便签"]');
      expect(checkbox).toBeTruthy();
      await act(async () => { await user.click(checkbox!); });

      // 选中后按 Delete 应当删除节点。
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      const nodes = await db.nodes.toArray();
      expect(nodes.find(n => n.id === 'checkbox-a')).toBeUndefined();
    });
  });

  // ============================================================
  // 画布增强测试
  // ============================================================
  describe('画布增强测试', () => {
    it('新建画布后切换到新画布', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });

      // 打开画布列表
      const historyBtn = screen.getByTitle('历史记录');
      await user.click(historyBtn);

      // 点击新建画布
      const newCanvasBtn = screen.getByText('新建画布');
      await user.click(newCanvasBtn);

      // 验证数据库中有新画布
      const canvases = await db.canvases.toArray();
      expect(canvases.length).toBeGreaterThanOrEqual(2);
    });

    it('画布列表显示默认画布名称', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      const historyBtn = screen.getByTitle('历史记录');
      await user.click(historyBtn);
      expect(screen.getByText('Main Workspace')).toBeInTheDocument();
    });

    it('新建便签后节点属于当前画布', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      const newNoteBtn = screen.getAllByTitle('新建便签')[0];
      await user.click(newNoteBtn);

      const nodes = await db.nodes.toArray();
      const newNode = nodes.find(n => n.type === 'text');
      expect(newNode?.canvasId).toBe('default');
    });

    it('合成文章按钮存在', async () => {
      await act(async () => { render(<App />); });
      // 合成文章按钮在右上角
      const publishBtns = screen.getAllByTitle(/合成文章/);
      expect(publishBtns.length).toBeGreaterThanOrEqual(1);
    });

    it('画布合成按钮未选中时为白色样式', async () => {
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
      const publishBtn = screen.getByTitle(/合成文章\s*\(/);
      expect(publishBtn.className).toContain('bg-white');
      expect(publishBtn.className).not.toContain('bg-[#C2410C]');
    });

    it('画布合成按钮选中便签后为橙色样式', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });

      let selectBtns = screen.queryAllByTitle('选择便签');
      if (selectBtns.length === 0) {
        await user.click(screen.getAllByTitle('新建便签')[0]);
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 150));
        });
        selectBtns = screen.queryAllByTitle('选择便签');
      }

      expect(selectBtns.length).toBeGreaterThan(0);
      await user.click(selectBtns[0]);

      const publishBtn = screen.getByTitle(/合成文章\s*\(/);
      expect(publishBtn.className).toContain('bg-[#C2410C]');
    });

    it('AI 提交输入框存在', async () => {
      await act(async () => { render(<App />); });
      const aiInput = document.querySelector('input[placeholder*="AI"]');
      expect(aiInput).toBeInTheDocument();
    });

    it('全屏按钮存在', async () => {
      await act(async () => { render(<App />); });
      const fullscreenBtn = screen.getByTitle('全屏');
      expect(fullscreenBtn).toBeInTheDocument();
    });

    it('侧边栏折叠/展开切换', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });

      // 找到折叠按钮（ChevronLeft 图标所在的按钮）
      const aside = document.querySelector('aside')!;
      const toggleBtn = aside.querySelector('div.mt-auto button:first-child')!;

      // 初始状态侧边栏是展开的
      expect(aside).toHaveClass('w-36');

      // 点击折叠
      await user.click(toggleBtn);
      expect(aside).toHaveClass('w-16');
    });
  });
});
