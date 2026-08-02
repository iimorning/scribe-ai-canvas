import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Coffee } from 'lucide-react';
import type { NoteNodeProps } from '../../types';
import { NoteBody } from '../NoteBody';
import { receiptDerivedFromId } from '../receiptDerivedFromId';
import { WebSearchSourcesToggle } from '../../WebSearchSourcesToggle';

export function NoteLayoutReceipt({
  node,
  editingNodeId,
  setEditingNodeId,
  webSearchSourceCount = 0,
  webSearchSourcesCollapsed = false,
  onToggleWebSearchSources,
}: NoteNodeProps) {
  const { t, i18n } = useTranslation();

  const receiptMeta = useMemo(() => receiptDerivedFromId(node.id), [node.id]);
  const receiptStamp = useMemo(() => {
    const d = new Date();
    const loc = i18n.language?.startsWith('zh') ? 'zh-CN' : 'en-US';
    return {
      date: d.toLocaleDateString(loc),
      time: d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }),
    };
  }, [node.id, i18n.language]);

  const barcodeLine = `${String(receiptMeta.store).padStart(3, '0')} ${receiptMeta.txn} ${receiptMeta.barcodeTail}`;

  const editReceipt =
    'focus:outline-none rounded px-1 -mx-1 transition-all cursor-text min-h-[50px] select-text font-mono text-[13px] leading-[1.4] text-[#2c281f] [text-shadow:0_0_1px_rgba(44,40,31,0.2)]';
  const viewReceipt =
    'markdown-body font-mono text-[13px] leading-[1.4] text-[#2c281f] [text-shadow:0_0_1px_rgba(44,40,31,0.2)]';
  const editClassName = `${editReceipt} empty:before:text-[#2c281f]/40 empty:before:content-['${t('nodes.type_something')}']`;

  return (
    <div
      className="note-surface-receipt receipt-note-shadow relative flex h-full w-full min-h-0 flex-col transition-all duration-500"
      style={{ outline: '1px solid transparent' }}
    >
      <WebSearchSourcesToggle
        count={webSearchSourceCount}
        collapsed={webSearchSourcesCollapsed}
        onToggle={onToggleWebSearchSources}
      />
      <div className="receipt-jagged-top note-receipt-paper shrink-0 rotate-180" aria-hidden />
      <div className="note-receipt-paper relative flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-5">
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.03] mix-blend-multiply"
          aria-hidden
        >
          <Coffee className="note-receipt-watermark h-40 w-40 text-[#2c281f]" strokeWidth={1} />
        </div>

        <div className="note-receipt-chrome relative z-10 mb-5 border-b-2 border-dashed pb-5 text-center">
          <h2 className="mb-2 font-mono text-[12px] font-semibold uppercase tracking-[0.2em]">{t('nodes.receipt_title')}</h2>
          <p className="font-mono text-[13px] uppercase">{t('nodes.receipt_store', { num: receiptMeta.store })}</p>
          <p className="mt-4 font-mono text-[13px]">
            {t('nodes.receipt_date')} {receiptStamp.date}
          </p>
          <p className="font-mono text-[13px]">
            {t('nodes.receipt_time')} {receiptStamp.time}
          </p>
          <p className="font-mono text-[13px]">
            {t('nodes.receipt_txn')} {receiptMeta.txn}
          </p>
        </div>

        <div className="note-receipt-chrome relative z-10 mb-1 flex justify-between border-b border-dashed pb-2 font-mono text-[12px] font-semibold uppercase tracking-widest">
          <span>{t('nodes.receipt_col_item')}</span>
          <span>{t('nodes.receipt_col_amt')}</span>
        </div>
        <div className="note-receipt-chrome relative z-10 -mt-1 mb-3 flex justify-between border-b border-transparent font-mono text-[13px] opacity-80">
          <span className="pr-4">{node.type === 'note' ? t('nodes.observation') : t('nodes.note')}</span>
          <span className="shrink-0">{t('nodes.receipt_row_value')}</span>
        </div>

        <NoteBody
          node={node}
          editingNodeId={editingNodeId}
          setEditingNodeId={setEditingNodeId}
          editClassName={editClassName}
          viewClassName={viewReceipt}
          emptyNoteMarkdown={`_${t('nodes.empty_note')}_`}
          scrollAreaClassName="note-receipt-markdown relative z-10 min-h-0 flex-1 overflow-y-auto pr-1 custom-scrollbar"
        />

        <div className="note-receipt-chrome relative z-10 mt-auto border-t-2 border-dashed pt-5 text-center">
          <div className="mb-4 flex justify-between font-mono text-[12px] font-semibold uppercase tracking-widest">
            <span>{t('nodes.receipt_total')}</span>
            <span>{t('nodes.receipt_paid')}</span>
          </div>
          <p className="mb-2 font-mono text-[13px] uppercase opacity-80">{t('nodes.receipt_thanks')}</p>
          <p className="mb-4 font-mono text-[11px] opacity-60">{t('nodes.receipt_policy')}</p>
          <div className="receipt-barcode mb-2 opacity-80 mix-blend-multiply" aria-hidden />
          <p className="font-mono text-[11px] tracking-widest opacity-90">{barcodeLine}</p>
        </div>
      </div>
      <div className="receipt-jagged-bottom note-receipt-paper shrink-0 rotate-180" aria-hidden />
    </div>
  );
}
