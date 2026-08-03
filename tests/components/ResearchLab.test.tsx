import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../../src/utils/openExternal', () => ({
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
}));

import { ResearchLab } from '../../src/components/ResearchLab';
import { openExternalUrl } from '../../src/utils/openExternal';
import { db } from '../../src/db';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, any>) => {
      const map: Record<string, string> = {
        'lab.investigate': 'What would you like to investigate?',
        'lab.idle_intro': 'Enter a broad topic or specific thesis. The agent will formulate a research plan, cross-reference archives, and generate a synthesized report.',
        'lab.placeholder': 'Search topic...',
        'lab.suggested_tag_1': '# spatial-encoding',
        'lab.suggested_tag_2': '# character-arcs',
        'lab.sources_utilized': 'Sources utilized',
        'lab.sources_none_hint': 'No sources yet.',
        'lab.source_view_detail': 'View source details',
        'lab.source_detail_heading': 'Web source',
        'lab.source_modal_hint': 'Hint',
        'lab.open_in_system_browser': 'Open in browser',
        'settings.close': 'Close',
        'lab.source_open_new_tab': 'Open source',
        'lab.source_untitled': 'Untitled',
        'lab.processed': 'Processed',
        'lab.demo_source_card_1_title': 'Ch 4: The Archive',
        'lab.demo_source_card_1_desc': "Found 3 metaphors for 'decay'.",
        'lab.demo_source_card_2_title': 'REF-042: Spatial Encoding',
        'lab.demo_source_card_2_desc': 'Linked theory of trauma and blueprints.',
        'lab.target_inquiry': 'Target inquiry',
        'lab.recommended_plan_title': 'Recommended research plan',
        'lab.approve': 'Approve & Execute',
        'lab.executing': 'Agent Execution Log',
        'lab.report': 'Synthesized Report',
        'lab.new_research': 'New Research',
        'lab.past_sessions': 'Past Sessions',
        'lab.delete_session': 'Delete session',
        'lab.delete_session_confirm': 'Remove?',
        'lab.no_past_sessions': 'No completed research yet.',
        'lab.searching': 'Searching the web...',
        'lab.search_complete': `${opts?.count ?? 0} web sources found`,
        'lab.search_fallback': 'Search unavailable, using offline mode',
        'lab.plan_edit_hint': 'Edit plan hint',
        'lab.plan_revision_placeholder': 'Revision instructions...',
        'lab.plan_revision_apply': 'Update outline with AI',
        'lab.plan_revision_applying': 'Updating outline...',
        'lab.plan_stream_hint': 'Streaming hint',
        'lab.plan_stream_status': 'Receiving outline…',
        'lab.report_stream_status': 'Receiving report…',
        'lab.ai_need_web_classifier': 'Classifier {{query}}',
        'lab.ai_decompose_question': 'Decompose question: {{query}}',
        'lab.ai_revise_decompose': 'Revise decompose for {{query}}. Plan: {{plan}}. Instruction: {{instruction}}',
        'lab.ai_research_report': 'Generate report for: {{query}}',
        'lab.search_preparing': 'Preparing web search…',
        'lab.search_offline_no_key': 'Offline mode — no Metaso API key configured.',
        'lab.stage_resolving_context': 'Resolving web sources…',
        'lab.stage_generating_report': 'Generating report…',
        'lab.report_footer_web': 'Based on {{count}} web sources + LLM synthesis',
        'lab.report_footer_offline': 'Offline mode — LLM-only synthesis',
        'lab.report_failed_banner': 'Report generation failed.',
        'lab.retry_generate_report': 'Retry report generation',
        'lab.conclusion_label': 'Agent recommendation and conclusion:',
        'nodes.ai_loading': 'Synthesizing...',
      };
      let result = map[key] ?? key;
      if (opts) {
        Object.entries(opts).forEach(([k, v]) => {
          result = result.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
        });
      }
      return result;
    },
    i18n: { language: 'en' },
  }),
}));

// Mock search module
const mockMetasoSearch = vi.fn();
vi.mock('../../src/services/search', () => ({
  metasoSearch: (...args: any[]) => mockMetasoSearch(...args),
  buildSearchContext: (results: any) => {
    if (!results?.webpages?.length) return '';
    return results.webpages.map((w: any) => `[Source] ${w.title}: ${w.snippet}`).join('\n');
  },
}));

// Mock aiI18n
vi.mock('../../src/utils/aiI18n', () => ({
  getLocaleDirective: () => 'Reply in English.',
}));

const baseConfig = {
  provider: 'openai',
  apiKey: 'sk-test',
  baseUrl: '',
  model: 'gpt-4o',
};

describe('ResearchLab', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(openExternalUrl).mockClear().mockResolvedValue(undefined);
    await db.researchSessions.clear();
  });

  it('renders idle state with input', () => {
    const callAI = vi.fn();
    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);
    expect(screen.getByText('What would you like to investigate?')).toBeTruthy();
    expect(screen.getByPlaceholderText('Search topic...')).toBeTruthy();
  });

  it('shows empty history message when no sessions in db', () => {
    const callAI = vi.fn();
    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);
    // 默认折叠，先展开
    fireEvent.click(screen.getByTestId('research-history-toggle'));
    expect(screen.getByText('No completed research yet.')).toBeTruthy();
  });

  it('lists sessions from db and opens report on row click', async () => {
    const callAI = vi.fn();
    await db.researchSessions.add({
      id: 'sess-1',
      query: 'Memory palace history',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      researchPlan: [{ title: 'Step 1', desc: 'D' }],
      researchReport: {
        intro: 'Saved intro text',
        points: [{ title: 'Point A', text: 'Body A' }],
        conclusion: 'Saved conclusion',
      },
      sourceCount: 0,
      searchStatus: 'idle',
    });

    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    // 默认折叠，先展开
    fireEvent.click(screen.getByTestId('research-history-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('research-session-sess-1')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('research-session-sess-1'));

    await waitFor(() => {
      expect(screen.getByText('Memory palace history')).toBeTruthy();
      expect(screen.getByText('Saved intro text')).toBeTruthy();
    });
  });

  it('deletes a session from IndexedDB after confirm', async () => {
    const callAI = vi.fn();
    await db.researchSessions.add({
      id: 'sess-del',
      query: 'To delete',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      researchPlan: [{ title: 'S', desc: 'D' }],
      researchReport: { intro: 'I', points: [], conclusion: 'C' },
      sourceCount: 0,
      searchStatus: 'idle',
    });

    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    // 默认折叠，先展开
    fireEvent.click(screen.getByTestId('research-history-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('research-session-delete-sess-del')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('research-session-delete-sess-del'));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'dialog.confirm' }));

    await waitFor(async () => {
      expect(await db.researchSessions.count()).toBe(0);
    });
  });

  it('does not delete a session when confirm is dismissed', async () => {
    const callAI = vi.fn();
    await db.researchSessions.add({
      id: 'sess-keep',
      query: 'Keep me',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      researchPlan: [{ title: 'S', desc: 'D' }],
      researchReport: { intro: 'I', points: [], conclusion: 'C' },
      sourceCount: 0,
      searchStatus: 'idle',
    });

    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    // 默认折叠，先展开
    fireEvent.click(screen.getByTestId('research-history-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('research-session-delete-sess-keep')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('research-session-delete-sess-keep'));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'dialog.cancel' }));

    expect(await db.researchSessions.count()).toBe(1);
  });

  it('calls callAI without search context when no metasoApiKey', async () => {
    const callAI = vi.fn().mockResolvedValue(
      JSON.stringify([
        { title: 'Step 1', desc: 'Desc 1' },
        { title: 'Step 2', desc: 'Desc 2' },
        { title: 'Step 3', desc: 'Desc 3' },
      ]),
    );
    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    const input = screen.getByPlaceholderText('Search topic...');
    fireEvent.change(input, { target: { value: 'memory loss' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(callAI).toHaveBeenCalledTimes(1);
    });

    // No Metaso key → no need_web classifier call
    expect(mockMetasoSearch).not.toHaveBeenCalled();

    const prompt = callAI.mock.calls[0][0].prompt;
    expect(prompt).not.toContain('[Source]');
    expect(prompt).not.toContain('Classifier');
    expect(prompt).toContain('memory loss');
  });

  it('generatePlan 传入 onStreamChunk 并显示流式大纲预览', async () => {
    const planJson = JSON.stringify([
      { title: 'Step 1', desc: 'Desc 1' },
      { title: 'Step 2', desc: 'Desc 2' },
      { title: 'Step 3', desc: 'Desc 3' },
    ]);
    const callAI = vi.fn().mockImplementation(async (opts: { onStreamChunk?: (t: string) => void }) => {
      opts.onStreamChunk?.('{"title":');
      opts.onStreamChunk?.(planJson);
      return planJson;
    });
    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    const input = screen.getByPlaceholderText('Search topic...');
    fireEvent.change(input, { target: { value: 'streaming plan' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(callAI).toHaveBeenCalledTimes(1);
      expect(callAI.mock.calls[0][0].onStreamChunk).toEqual(expect.any(Function));
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Step 1 title')).toHaveValue('Step 1');
    });
  });

  it('calls metasoSearch when metasoApiKey is provided', async () => {
    mockMetasoSearch.mockResolvedValue({
      credits: 1,
      total: 1,
      webpages: [{ title: 'Research', link: 'https://r.com', snippet: 'Findings', score: 'high', date: '2026-01-01' }],
    });

    const callAI = vi.fn()
      .mockResolvedValueOnce('{"need_web":true}')
      .mockResolvedValue(
        JSON.stringify([
          { title: 'Step 1', desc: 'Desc' },
          { title: 'Step 2', desc: 'Desc' },
          { title: 'Step 3', desc: 'Desc' },
        ]),
      );

    render(<ResearchLab aiConfig={{ ...baseConfig, metasoApiKey: 'sk-metaso-test' }} callAI={callAI} />);

    const input = screen.getByPlaceholderText('Search topic...');
    fireEvent.change(input, { target: { value: 'AI research' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(mockMetasoSearch).toHaveBeenCalledWith('AI research', { apiKey: 'sk-metaso-test' });
    });

    await waitFor(() => {
      expect(callAI).toHaveBeenCalledTimes(2);
    });

    expect((callAI.mock.calls[0][0].prompt as string)).toContain('Classifier');

    // callAI: classifier then plan; plan prompt SHOULD contain search context
    const prompt = callAI.mock.calls[1][0].prompt;
    expect(prompt).toContain('[Source]');
    expect(prompt).toContain('Findings');
  });

  it('opens source detail modal and calls openExternalUrl for system browser', async () => {
    mockMetasoSearch.mockResolvedValue({
      credits: 1,
      total: 1,
      webpages: [
        { title: 'Paper', link: 'https://example.com/doc', snippet: 'S', score: '', date: '' },
      ],
    });
    const planJson = JSON.stringify([
      { title: 'Step 1', desc: 'D1' },
      { title: 'Step 2', desc: 'D2' },
      { title: 'Step 3', desc: 'D3' },
    ]);
    const callAI = vi.fn().mockResolvedValueOnce('{"need_web":true}').mockResolvedValueOnce(planJson);

    render(<ResearchLab aiConfig={{ ...baseConfig, metasoApiKey: 'sk-metaso' }} callAI={callAI} />);

    fireEvent.change(screen.getByPlaceholderText('Search topic...'), { target: { value: 'topic sources' } });
    fireEvent.submit(screen.getByPlaceholderText('Search topic...').closest('form')!);

    // 非空闲阶段面板默认折叠，先展开
    fireEvent.click(screen.getByTestId('research-history-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('lab-source-card-0')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('lab-source-card-0'));

    await waitFor(() => {
      expect(screen.getByTestId('lab-source-detail-modal')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Open in browser/i }));

    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/doc');
  });

  it('does not call metaso when classifier returns need_web false', async () => {
    const callAI = vi.fn()
      .mockResolvedValueOnce('{"need_web":false}')
      .mockResolvedValue(
        JSON.stringify([
          { title: 'Step 1', desc: 'Desc' },
          { title: 'Step 2', desc: 'Desc' },
          { title: 'Step 3', desc: 'Desc' },
        ]),
      );

    render(<ResearchLab aiConfig={{ ...baseConfig, metasoApiKey: 'sk-metaso-test' }} callAI={callAI} />);

    const input = screen.getByPlaceholderText('Search topic...');
    fireEvent.change(input, { target: { value: 'meaning of life' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(callAI).toHaveBeenCalledTimes(2);
    });

    expect(mockMetasoSearch).not.toHaveBeenCalled();

    const planPrompt = callAI.mock.calls[1][0].prompt as string;
    expect(planPrompt).not.toContain('[Source]');
    expect(planPrompt).toContain('meaning of life');
  });

  it('degrades gracefully when metasoSearch fails', async () => {
    mockMetasoSearch.mockRejectedValue(new Error('Network error'));

    const callAI = vi.fn()
      .mockResolvedValueOnce('{"need_web":true}')
      .mockResolvedValue(
        JSON.stringify([
          { title: 'Step 1', desc: 'Desc' },
          { title: 'Step 2', desc: 'Desc' },
          { title: 'Step 3', desc: 'Desc' },
        ]),
      );

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<ResearchLab aiConfig={{ ...baseConfig, metasoApiKey: 'sk-bad-key' }} callAI={callAI} />);

    const input = screen.getByPlaceholderText('Search topic...');
    fireEvent.change(input, { target: { value: 'test query' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(callAI).toHaveBeenCalledTimes(2);
    });

    // Should have warned about search failure
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Metaso search failed'),
      expect.any(String)
    );

    // callAI prompt should NOT contain search context (graceful fallback)
    const prompt = callAI.mock.calls[1][0].prompt;
    expect(prompt).not.toContain('[Source]');

    consoleSpy.mockRestore();
  });

  it('includes user-approved research plan in the report prompt when executing', async () => {
    const planJson = JSON.stringify([
      { title: 'Step 1', desc: 'Desc 1' },
      { title: 'Step 2', desc: 'Desc 2' },
      { title: 'Step 3', desc: 'Desc 3' },
    ]);
    const reportJson = JSON.stringify({
      intro: 'Intro',
      points: [{ title: 'P1', text: 'T1' }],
      conclusion: 'Done',
    });
    const callAI = vi.fn().mockResolvedValueOnce(planJson).mockResolvedValueOnce(reportJson);

    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    const topicInput = screen.getByPlaceholderText('Search topic...');
    fireEvent.change(topicInput, { target: { value: 'memory loss' } });
    fireEvent.submit(topicInput.closest('form')!);

    await waitFor(() => {
      expect(screen.getByLabelText('Step 1 title')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Step 1 title'), { target: { value: 'Edited step one' } });
    fireEvent.click(screen.getByRole('button', { name: /Approve & Execute/i }));

    await waitFor(() => {
      expect(callAI).toHaveBeenCalledTimes(2);
    });

    const reportPrompt = callAI.mock.calls[1][0].prompt as string;
    expect(reportPrompt).toContain('user-approved research plan');
    expect(reportPrompt).toContain('Edited step one');
    expect(reportPrompt).toContain('memory loss');
  });

  it('persists completed research session to IndexedDB', async () => {
    const planJson = JSON.stringify([
      { title: 'Step 1', desc: 'Desc 1' },
      { title: 'Step 2', desc: 'Desc 2' },
      { title: 'Step 3', desc: 'Desc 3' },
    ]);
    const reportJson = JSON.stringify({
      intro: 'Persisted intro',
      points: [{ title: 'P1', text: 'T1' }],
      conclusion: 'Persisted done',
    });
    const callAI = vi.fn().mockResolvedValueOnce(planJson).mockResolvedValueOnce(reportJson);

    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    fireEvent.change(screen.getByPlaceholderText('Search topic...'), { target: { value: 'persist query' } });
    fireEvent.submit(screen.getByPlaceholderText('Search topic...').closest('form')!);

    await waitFor(() => {
      expect(screen.getByLabelText('Step 1 title')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /Approve & Execute/i }));

    await waitFor(() => {
      expect(callAI).toHaveBeenCalledTimes(2);
    });

    await waitFor(async () => {
      const rows = await db.researchSessions.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0].query).toBe('persist query');
      expect(rows[0].researchReport.intro).toBe('Persisted intro');
      expect(rows[0].searchStatus).toBe('idle');
      expect(rows[0].searchWebpages).toEqual([]);
    });
  });

  it('persists searchStatus found and sourceCount when Metaso returns webpages on execute', async () => {
    mockMetasoSearch.mockResolvedValue({
      credits: 1,
      total: 3,
      webpages: [
        { title: 'A', link: 'https://a.com', snippet: 'Sa', score: '', date: '' },
        { title: 'B', link: 'https://b.com', snippet: 'Sb', score: '', date: '' },
        { title: 'C', link: 'https://c.com', snippet: 'Sc', score: '', date: '' },
      ],
    });
    const planJson = JSON.stringify([
      { title: 'Step 1', desc: 'D1' },
      { title: 'Step 2', desc: 'D2' },
      { title: 'Step 3', desc: 'D3' },
    ]);
    const reportJson = JSON.stringify({
      intro: 'Web intro',
      points: [{ title: 'P', text: 'T' }],
      conclusion: 'C',
    });
    const callAI = vi.fn()
      .mockResolvedValueOnce('{"need_web":true}')
      .mockResolvedValueOnce(planJson)
      .mockResolvedValueOnce(reportJson);

    render(<ResearchLab aiConfig={{ ...baseConfig, metasoApiKey: 'sk-m' }} callAI={callAI} />);

    fireEvent.change(screen.getByPlaceholderText('Search topic...'), { target: { value: 'metaso topic' } });
    fireEvent.submit(screen.getByPlaceholderText('Search topic...').closest('form')!);

    await waitFor(() => {
      expect(screen.getByLabelText('Step 1 title')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /Approve & Execute/i }));

    await waitFor(() => {
      expect(callAI).toHaveBeenCalledTimes(3);
    });

    await waitFor(async () => {
      const rows = await db.researchSessions.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0].searchStatus).toBe('found');
      expect(rows[0].sourceCount).toBe(3);
      expect(rows[0].searchWebpages?.length).toBe(3);
      expect(rows[0].searchWebpages?.[0]?.link).toBe('https://a.com');
      expect(rows[0].researchReport.intro).toBe('Web intro');
    });

    expect(mockMetasoSearch).toHaveBeenCalledTimes(2);
  });

  it('still shows report when persisting session fails', async () => {
    const addSpy = vi.spyOn(db.researchSessions, 'add').mockRejectedValueOnce(new Error('disk full'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const planJson = JSON.stringify([
        { title: 'Step 1', desc: 'Desc 1' },
        { title: 'Step 2', desc: 'Desc 2' },
        { title: 'Step 3', desc: 'Desc 3' },
      ]);
      const reportJson = JSON.stringify({
        intro: 'Shown even if save fails',
        points: [],
        conclusion: 'End',
      });
      const callAI = vi.fn().mockResolvedValueOnce(planJson).mockResolvedValueOnce(reportJson);

      render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

      fireEvent.change(screen.getByPlaceholderText('Search topic...'), { target: { value: 'q' } });
      fireEvent.submit(screen.getByPlaceholderText('Search topic...').closest('form')!);

      await waitFor(() => {
        expect(screen.getByLabelText('Step 1 title')).toBeTruthy();
      });
      fireEvent.click(screen.getByRole('button', { name: /Approve & Execute/i }));

      await waitFor(() => {
        expect(screen.getByText('Shown even if save fails')).toBeTruthy();
      });

      expect(errSpy).toHaveBeenCalledWith(
        '[Scribe AI] ResearchLab failed to persist session',
        expect.any(Error),
      );

      const rows = await db.researchSessions.toArray();
      expect(rows).toHaveLength(0);
    } finally {
      addSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it('ignores second Approve while executeResearch is in flight', async () => {
    const planJson = JSON.stringify([
      { title: 'Step 1', desc: 'D1' },
      { title: 'Step 2', desc: 'D2' },
      { title: 'Step 3', desc: 'D3' },
    ]);
    const reportJson = JSON.stringify({ intro: 'Done', points: [], conclusion: 'C' });

    let releaseReport!: (v: string) => void;
    const reportGate = new Promise<string>((res) => {
      releaseReport = res;
    });

    const callAI = vi.fn().mockResolvedValueOnce(planJson).mockImplementationOnce(() => reportGate);

    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    fireEvent.change(screen.getByPlaceholderText('Search topic...'), { target: { value: 't' } });
    fireEvent.submit(screen.getByPlaceholderText('Search topic...').closest('form')!);

    await waitFor(() => {
      expect(screen.getByLabelText('Step 1 title')).toBeTruthy();
    });

    const approveBtn = screen.getByRole('button', { name: /Approve & Execute/i });
    fireEvent.click(approveBtn);
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(callAI).toHaveBeenCalledTimes(2);
    });

    releaseReport(reportJson);

    await waitFor(async () => {
      const rows = await db.researchSessions.toArray();
      expect(rows).toHaveLength(1);
    });

    expect(callAI).toHaveBeenCalledTimes(2);
  });

  it('calls AI to revise plan from the revision textarea', async () => {
    const initialPlan = JSON.stringify([
      { title: 'Step 1', desc: 'Desc 1' },
      { title: 'Step 2', desc: 'Desc 2' },
      { title: 'Step 3', desc: 'Desc 3' },
    ]);
    const revisedPlan = JSON.stringify([{ title: 'Only one step', desc: 'Condensed' }]);
    const callAI = vi.fn().mockResolvedValueOnce(initialPlan).mockResolvedValueOnce(revisedPlan);

    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    const topicInput = screen.getByPlaceholderText('Search topic...');
    fireEvent.change(topicInput, { target: { value: 'topic t' } });
    fireEvent.submit(topicInput.closest('form')!);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Revision instructions...')).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText('Revision instructions...'), {
      target: { value: 'Merge everything into one step' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Update outline with AI/i }));

    await waitFor(() => {
      expect(callAI).toHaveBeenCalledTimes(2);
    });

    const revisePrompt = callAI.mock.calls[1][0].prompt as string;
    expect(revisePrompt).toContain('Merge everything into one step');
    expect(revisePrompt).toContain('Step 1');

    await waitFor(() => {
      expect(screen.getByLabelText('Step 1 title')).toHaveValue('Only one step');
    });
  });

  it('does not persist session when report JSON is invalid; retry generates and persists', async () => {
    const planJson = JSON.stringify([
      { title: 'Step 1', desc: 'D1' },
      { title: 'Step 2', desc: 'D2' },
      { title: 'Step 3', desc: 'D3' },
    ]);
    const fixedReport = JSON.stringify({
      intro: 'Recovered intro',
      points: [{ title: 'P', text: 'T' }],
      conclusion: 'Done',
    });
    const callAI = vi
      .fn()
      .mockResolvedValueOnce(planJson)
      .mockResolvedValueOnce('NOT VALID JSON { broken')
      .mockResolvedValueOnce(fixedReport);

    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    fireEvent.change(screen.getByPlaceholderText('Search topic...'), { target: { value: 'retry topic' } });
    fireEvent.submit(screen.getByPlaceholderText('Search topic...').closest('form')!);

    await waitFor(() => {
      expect(screen.getByLabelText('Step 1 title')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /Approve & Execute/i }));

    await waitFor(() => {
      expect(screen.getByTestId('lab-retry-report')).toBeTruthy();
    });

    let rows = await db.researchSessions.toArray();
    expect(rows).toHaveLength(0);

    fireEvent.click(screen.getByTestId('lab-retry-report'));

    await waitFor(() => {
      expect(screen.getByText('Recovered intro')).toBeTruthy();
    });

    await waitFor(async () => {
      rows = await db.researchSessions.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0].researchReport.intro).toBe('Recovered intro');
    });

    expect(callAI).toHaveBeenCalledTimes(3);
  });

  it('uses fallback plan when model returns empty or invalid JSON', async () => {
    const callAI = vi.fn().mockResolvedValueOnce('[]');

    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    const topicInput = screen.getByPlaceholderText('Search topic...');
    fireEvent.change(topicInput, { target: { value: 'topic' } });
    fireEvent.submit(topicInput.closest('form')!);

    await waitFor(() => {
      expect(screen.getByLabelText('Step 1 title')).toHaveValue('Archive Extraction');
    });
    expect(callAI).toHaveBeenCalledTimes(1);
  });

  it('keeps plan unchanged when AI revision returns empty array', async () => {
    const planJson = JSON.stringify([{ title: 'Step 1', desc: 'Desc 1' }]);
    const callAI = vi.fn().mockResolvedValueOnce(planJson).mockResolvedValueOnce('[]');

    render(<ResearchLab aiConfig={baseConfig} callAI={callAI} />);

    fireEvent.change(screen.getByPlaceholderText('Search topic...'), { target: { value: 't' } });
    fireEvent.submit(screen.getByPlaceholderText('Search topic...').closest('form')!);

    await waitFor(() => screen.getByPlaceholderText('Revision instructions...'));

    fireEvent.change(screen.getByPlaceholderText('Revision instructions...'), {
      target: { value: 'please break this' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Update outline with AI/i }));

    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(2));

    await waitFor(() => {
      expect(screen.getByLabelText('Step 1 title')).toHaveValue('Step 1');
    });
    expect(screen.getByPlaceholderText('Revision instructions...')).toHaveValue('please break this');
  });
});
