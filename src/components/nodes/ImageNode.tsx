import React from 'react';
import type { NodeContentProps } from './types';

export function ImageNode({ node }: NodeContentProps) {
  const title = (node.description || '').trim();

  return (
    <div
      className="w-full h-full bg-white p-2 shadow-lg border-2 border-[#E6E4DF] flex flex-col"
      style={{ outline: '1px solid transparent' }}
    >
      <div className="w-full bg-[#EAE7E2] rounded flex items-center justify-center border border-dashed border-[#d1cfca] overflow-hidden flex-1 min-h-0">
        <img
          alt={title || 'Image'}
          className="w-full h-full object-cover shadow-inner pointer-events-none"
          src={node.content}
          referrerPolicy="no-referrer"
          draggable={false}
        />
      </div>
      {title ? (
        <p
          className="mt-1.5 px-0.5 text-[10px] font-sans text-[#8c8a84] truncate"
          title={title}
        >
          {title}
        </p>
      ) : null}
    </div>
  );
}
