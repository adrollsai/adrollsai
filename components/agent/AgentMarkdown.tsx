'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check } from 'lucide-react';

interface AgentMarkdownProps {
  content: string;
  className?: string;
}

function CodeBlock({ children, className }: { children: any; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  const codeText = String(children).replace(/\n$/, '');
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';

  const handleCopy = () => {
    navigator.clipboard.writeText(codeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative my-3 rounded-xl overflow-hidden border border-slate-700/80 bg-slate-950 text-slate-100 text-xs">
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-slate-900 border-b border-slate-800 text-[11px] text-slate-400">
        <span className="font-mono uppercase">{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-white transition px-1.5 py-0.5 rounded"
          title="Copy code"
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto font-mono text-[12px] leading-relaxed">
        <code>{children}</code>
      </pre>
    </div>
  );
}

export default function AgentMarkdown({ content, className = '' }: AgentMarkdownProps) {
  if (!content) return null;

  return (
    <div className={`agent-markdown leading-relaxed text-sm space-y-2.5 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-base font-black text-slate-900 dark:text-slate-50 mt-4 mb-2 flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-1.5">
              <span className="w-1.5 h-4 rounded-full bg-blue-500 shrink-0"></span>
              <span>{children}</span>
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-slate-100 mt-3.5 mb-1.5 flex items-center gap-2">
              <span className="w-1.5 h-3.5 rounded-full bg-indigo-500 shrink-0"></span>
              <span>{children}</span>
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-2.5 mb-1">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="my-1.5 text-slate-700 dark:text-slate-300 leading-relaxed">
              {children}
            </p>
          ),
          strong: ({ children }) => (
            <strong className="font-bold text-slate-900 dark:text-white">
              {children}
            </strong>
          ),
          em: ({ children }) => (
            <em className="italic text-slate-700 dark:text-slate-300">{children}</em>
          ),
          ul: ({ children }) => (
            <ul className="my-2 space-y-1 pl-1">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 space-y-1 list-decimal list-outside pl-5 text-slate-700 dark:text-slate-300">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="text-slate-700 dark:text-slate-300 leading-relaxed text-xs sm:text-sm">
              {children}
            </li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-blue-500 bg-blue-50/60 dark:bg-blue-950/20 px-3.5 py-2 rounded-r-xl my-2.5 text-slate-700 dark:text-slate-300 italic text-xs leading-relaxed">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm bg-white dark:bg-slate-900/90">
              <table className="min-w-full text-xs text-left divide-y divide-slate-200 dark:divide-slate-800 border-collapse">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-slate-100/90 dark:bg-slate-800/90 text-[11px] font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-normal">
              {children}
            </tbody>
          ),
          tr: ({ children }) => (
            <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="px-3.5 py-2.5 font-bold text-slate-800 dark:text-slate-200">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3.5 py-2 text-slate-700 dark:text-slate-300 font-medium whitespace-nowrap sm:whitespace-normal">
              {children}
            </td>
          ),
          code: ({ className, children, ...props }: any) => {
            const isMultiline = String(children).includes('\n') || className?.includes('language-');
            if (isMultiline) {
              return <CodeBlock className={className}>{children}</CodeBlock>;
            }
            return (
              <code
                className="px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono text-[11px] font-semibold"
                {...props}
              >
                {children}
              </code>
            );
          },
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline font-medium inline-flex items-center gap-0.5"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-3 border-slate-200 dark:border-slate-800" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
