import type { TFunction } from 'i18next';
import type { AIConfig } from '../components/AISettingsModal';
import { callUniversalAI } from './ai';
import { combineSystemParts, getLocaleDirective } from '../utils/aiI18n';
import { parseLenientLlmJson } from '../utils/llmJson';
import { deriveSearchQueryFromNoteText } from './spawnWebSearchNoteCards';
import { enrichSearchQueryWithLinkedContext } from '../utils/linkedCardSearchContext';

export interface NoteSearchQueries {
  /** Query for webpage search */
  webQuery: string;
  /** Query for image search (may differ; more visual) */
  imageQuery: string;
  /** Short human label for the ack card */
  topic: string;
}

function cleanQuery(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[*_`#>【】\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function fallbackFromNote(noteText: string): NoteSearchQueries | null {
  const q = deriveSearchQueryFromNoteText(noteText.replace(/#{1,6}\s+/g, ''));
  if (!q) return null;
  // Avoid obvious markdown title-only noise when body has more lines.
  const lines = noteText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  let query = q;
  if (lines.length >= 2) {
    // Prefer a later substantial line if the first looks like a short title/heading.
    const first = lines[0]!.replace(/[*_`#]/g, '').trim();
    const second = lines.find((l, i) => i > 0 && l.replace(/[*_`#]/g, '').trim().length >= 8);
    if (first.length <= 16 && second) {
      query = deriveSearchQueryFromNoteText(second) || q;
    }
  }
  return { webQuery: query, imageQuery: query, topic: query.slice(0, 40) };
}

export function normalizeNoteSearchQueries(raw: unknown, noteText: string): NoteSearchQueries | null {
  const fb = fallbackFromNote(noteText);
  if (!raw || typeof raw !== 'object') return fb;

  const o = raw as Record<string, unknown>;
  const webQuery =
    cleanQuery(o.webQuery, 80) ||
    cleanQuery(o.query, 80) ||
    cleanQuery(o.webpageQuery, 80);
  const imageQuery =
    cleanQuery(o.imageQuery, 80) ||
    cleanQuery(o.image_query, 80) ||
    webQuery;
  const topic = cleanQuery(o.topic, 40) || webQuery.slice(0, 40);

  if (!webQuery && !imageQuery) return fb;
  return {
    webQuery: webQuery || imageQuery,
    imageQuery: imageQuery || webQuery,
    topic: topic || webQuery || imageQuery,
  };
}

/**
 * Ask the model what the note is really about, then return search queries.
 * Pass `linkedContext` when other cards are edge-connected so queries keep that background.
 * Falls back to heuristic first-line extraction if the model call fails.
 */
export async function deriveNoteSearchQueries(
  noteText: string,
  config: AIConfig,
  t: TFunction<'translation', undefined>,
  options?: { linkedContext?: string; linkedTexts?: string[] },
): Promise<NoteSearchQueries | null> {
  const trimmed = noteText.replace(/\r\n/g, '\n').trim();
  if (!trimmed) return null;

  const linkedTexts = options?.linkedTexts ?? [];
  const linked =
    (options?.linkedContext ?? '').trim() ||
    (linkedTexts.length > 0 ? linkedTexts.join('\n\n---\n\n') : '(none)');
  const hasLinked = linked !== '(none)' && linked.length > 0;

  const applyLinkedEnrichment = (plan: NoteSearchQueries | null): NoteSearchQueries | null => {
    if (!plan || linkedTexts.length === 0) return plan;
    return {
      ...plan,
      webQuery: enrichSearchQueryWithLinkedContext(plan.webQuery, linkedTexts),
      imageQuery: enrichSearchQueryWithLinkedContext(plan.imageQuery, linkedTexts),
    };
  };

  const fallback = applyLinkedEnrichment(fallbackFromNote(trimmed));

  try {
    let prompt = t('ai.prompts.noteSearchQueryUser', {
      note: trimmed.slice(0, 4000),
      linked: linked.slice(0, 6000),
    });
    // If i18n dropped the linked block, append it explicitly.
    if (hasLinked) {
      const probe = linked.slice(0, Math.min(24, linked.length));
      if (probe && !prompt.includes(probe)) {
        prompt = `${prompt}\n\nLinked notes (fallback):\n"""\n${linked.slice(0, 6000)}\n"""`;
      }
    }

    const raw = await callUniversalAI({
      config,
      systemInstruction: combineSystemParts(
        getLocaleDirective(),
        t('ai.prompts.noteSearchQuerySystem'),
      ),
      prompt,
      temperature: 0.2,
      topP: 0.4,
    });
    if (!raw?.trim()) return fallback;
    const normalized = normalizeNoteSearchQueries(parseLenientLlmJson(raw), trimmed) ?? fallback;
    return applyLinkedEnrichment(normalized);
  } catch {
    return fallback;
  }
}
