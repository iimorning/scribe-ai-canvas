import Dexie, { type Table } from 'dexie';

export interface CanvasNode {
  id: string;
  canvasId?: string;
  type: string;
  content?: string;
  description?: string;
  /** Theme card footer label (editable); default differs by layout when unset/empty */
  themeTag?: string;
  agentConfigId?: string;
  fileType?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  layout?: number;
  /** 画布 AI 对话卡：本回合用户追问（上半区）；`content` 为 AI 回复（下半区） */
  userTurn?: string;
  /** 已从该卡成功发出过追问并生成下游 AI 卡后隐藏追问输入，保持卡片简洁 */
  followUpSent?: boolean;
  /** Agent 分析链：首张 AI 卡记录源便签 id；追问链上子卡从父卡复制 */
  threadRootContextNodeId?: string;
  /** Agent 分析链：首张 AI 卡记录 `AgentConfig.id`；子卡从父卡复制 */
  threadAgentConfigId?: string;
  /** Agent 分析链：首轮附带的多模态图片节点 id（便签/Agent 邻接 image）；子卡从父卡复制 */
  threadContextImageNodeIds?: string[];
  /** AI 卡：联网搜索来源卡是否叠放收起 */
  webSearchSourcesCollapsed?: boolean;
  /** 文本卡：所属联网搜索回答卡 id（来源卡标记） */
  webSearchParentId?: string;
  /** 文本卡：在来源列中的顺序（0-based） */
  webSearchIndex?: number;
  /** 主题卡：书籍展开分支是否叠放收起 */
  bookExpandBranchesCollapsed?: boolean;
  /** 文本卡：所属书籍展开主题卡 id */
  bookExpandParentId?: string;
  /** 文本卡：在书籍展开分支中的顺序（0-based） */
  bookExpandIndex?: number;
  /** 书籍卡：当前阅读页/章索引（0-based），刷新后恢复 */
  bookPageIndex?: number;
}

export interface Canvas {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface Article {
  id: string;
  title: string;
  content: string;
  date: string;
  type: string;
  author?: string;
  tags?: string[];
  privateNotes?: string;
  linkedCanvasIds?: string[];
}

/** Markdown 知识：文件内容持久化在 IndexedDB，调用模型时整段注入 system（非 RAG）。 */
export interface AgentMarkdownKnowledgeFile {
  name: string;
  content: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  prompt: string;
  temperature?: number;
  creativity?: number;
  color?: string;
  knowledgeMarkdownFiles?: AgentMarkdownKnowledgeFile[];
}

export interface Edge {
  id: string;
  canvasId?: string;
  from: string;
  to: string;
}

/** 深度研究实验室：一次已完成研究的本地快照（独立于 articles）。 */
export interface ResearchPlanStepRecord {
  title: string;
  desc: string;
}

export interface ResearchReportRecord {
  intro: string;
  points: { title: string; text: string }[];
  conclusion: string;
}

export type ResearchSessionSearchStatus = 'idle' | 'searching' | 'found' | 'fallback';

/** Minimal webpage snapshot stored with a research session (sidebar sources). */
export interface ResearchSessionWebpageSnapshot {
  title: string;
  link: string;
  snippet: string;
}

/** AI 助手「测试沙盒」：按人设 id 持久化多轮对话（仅本地 IndexedDB）。 */
export interface AgentSandboxThread {
  agentId: string;
  messages: { role: 'user' | 'model'; text: string }[];
  updatedAt: number;
}

export interface ResearchSession {
  id: string;
  query: string;
  createdAt: number;
  updatedAt: number;
  researchPlan: ResearchPlanStepRecord[];
  researchReport: ResearchReportRecord;
  sourceCount: number;
  searchStatus: ResearchSessionSearchStatus;
  /** URLs/snippets from the last Metaso search used for this run (optional on legacy rows). */
  searchWebpages?: ResearchSessionWebpageSnapshot[];
}

export class MyDatabase extends Dexie {
  nodes!: Table<CanvasNode>;
  articles!: Table<Article>;
  agents!: Table<AgentConfig>;
  edges!: Table<Edge>;
  canvases!: Table<Canvas>;
  researchSessions!: Table<ResearchSession>;
  agentSandboxThreads!: Table<AgentSandboxThread>;

  constructor() {
    super('CortexLocalDB');
    this.version(1).stores({
      nodes: '++id, type, agentConfigId',
      articles: '++id, type, date',
      agents: '++id, role',
      edges: '++id, from, to'
    });

    this.version(2).stores({
      nodes: '++id, type, agentConfigId, canvasId',
      edges: '++id, from, to, canvasId',
      canvases: '++id, name, createdAt'
    });

    this.version(3).stores({
      researchSessions: 'id, createdAt',
    });

    this.version(4).stores({
      agentSandboxThreads: 'agentId',
    });
  }
}

export const db = new MyDatabase();
