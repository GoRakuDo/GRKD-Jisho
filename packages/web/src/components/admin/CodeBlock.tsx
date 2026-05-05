import React from 'react';
import '../../styles/globals.css';

type CodeBlockProps = {
  children: string;
  language?: string;
  maxHeight?: string;
};

export const CodeBlock: React.FC<CodeBlockProps> = ({ children, language, maxHeight }) => {
  return (
    <div className="relative rounded-[12px] overflow-hidden bg-graphite-900 border border-graphite-800">
      {language && (
        <div className="absolute top-0 right-0 px-3 py-1 text-[11px] font-grkd-mono text-graphite-500 uppercase">
          {language}
        </div>
      )}
      <pre 
        className="p-4 font-grkd-mono text-[13px] leading-[1.5] text-porcelain-150 whitespace-pre-wrap"
        style={{ maxHeight, overflowY: maxHeight ? 'auto' : 'visible' }}
      >
        {children}
      </pre>
    </div>
  );
};
