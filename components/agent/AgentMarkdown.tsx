'use client';

/**
 * Markdown renderer for harness prose.
 *
 * Uses the DeepSeek Harness markdown scale exactly: base 16px/28px, h1 24/34,
 * h2 22/32, h3 20/30, h4 16/28, small 14/24, tables 15/25 with a 500-weight
 * head, inline code 14/22 and code blocks 13/22 on a 12px radius. Weights stop
 * at 700 (headings) and 600 (strong) — nothing heavier, and no coloured
 * decoration on headings.
 */
import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check } from 'lucide-react';

interface AgentMarkdownProps {
  content: string;
  className?: string;
}

const MONO = 'var(--dsh-font-mono)';

const label = (token: string) => ({ color: `var(${token})` });

function CodeBlock({ children, className }: { children: any; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  const codeText = String(children).replace(/\n$/, '');
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';

  const handleCopy = () => {
    navigator.clipboard.writeText(codeText).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      className="my-3 overflow-hidden"
      style={{
        borderRadius: 'var(--dsh-radius-md)',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-markdown-code-block)',
      }}
    >
      <div
        className="flex items-center justify-between px-3.5 py-1.5"
        style={{
          background: 'var(--dsw-alias-markdown-code-block-banner)',
          borderBottom: '1px solid var(--dsw-alias-border-l1)',
        }}
      >
        <span
          className="dsh-mono dsh-t-xs uppercase"
          style={{ ...label('--dsw-alias-label-tertiary'), letterSpacing: '0.04em' }}
        >
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 dsh-t-xs"
          style={label('--dsw-alias-label-tertiary')}
          title="Copy code"
        >
          {copied ? (
            <Check size={12} style={label('--dsw-alias-state-success-primary')} />
          ) : (
            <Copy size={12} />
          )}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto" style={{ margin: 0 }}>
        <code
          className="dsh-mono"
          style={{
            fontSize: 'var(--dsh-text-xs)',
            lineHeight: '22px',
            fontFamily: MONO,
            ...label('--dsw-alias-label-primary'),
          }}
        >
          {children}
        </code>
      </pre>
    </div>
  );
}

function AgentMarkdownInner({ content, className = '' }: AgentMarkdownProps) {
  if (!content) return null;

  return (
    <div className={`agent-markdown dsh-t-prose ${className}`} style={label('--dsw-alias-label-primary')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1
              className="mt-6 mb-3"
              style={{
                fontSize: 'var(--dsh-text-xl)',
                lineHeight: '34px',
                fontWeight: 700,
                ...label('--dsw-alias-label-primary'),
              }}
            >
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2
              className="mt-5 mb-2.5"
              style={{ fontSize: '22px', lineHeight: '32px', fontWeight: 700, ...label('--dsw-alias-label-primary') }}
            >
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3
              className="mt-4 mb-2"
              style={{ fontSize: 'var(--dsh-text-l)', lineHeight: '30px', fontWeight: 700, ...label('--dsw-alias-label-primary') }}
            >
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4
              className="mt-3 mb-1.5"
              style={{ fontSize: 'var(--dsh-text-base)', lineHeight: '28px', fontWeight: 600, ...label('--dsw-alias-label-primary') }}
            >
              {children}
            </h4>
          ),
          p: ({ children }) => (
            <p style={{ fontSize: 'var(--dsh-text-base)', lineHeight: '28px', margin: '12px 0', ...label('--dsw-alias-label-primary') }}>
              {children}
            </p>
          ),
          strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
          em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
          ul: ({ children }) => (
            <ul
              className="list-disc pl-6"
              style={{ margin: '12px 0', fontSize: 'var(--dsh-text-base)', lineHeight: '28px' }}
            >
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol
              className="list-decimal list-outside pl-6"
              style={{ margin: '12px 0', fontSize: 'var(--dsh-text-base)', lineHeight: '28px' }}
            >
              {children}
            </ol>
          ),
          li: ({ children }) => <li style={{ margin: '4px 0' }}>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote
              className="pl-4 py-1 my-3"
              style={{
                borderLeft: '2px solid var(--dsw-alias-border-l3)',
                ...label('--dsw-alias-label-secondary'),
              }}
            >
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div
              className="overflow-x-auto my-3"
              style={{
                borderRadius: 'var(--dsh-radius-md)',
                border: '1px solid var(--dsw-alias-border-l1)',
              }}
            >
              <table className="min-w-full border-collapse text-left" style={{ fontSize: '15px', lineHeight: '25px' }}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead
              style={{
                background: 'var(--dsw-alias-markdown-code-block-banner)',
                fontWeight: 500,
                borderBottom: '1px solid var(--dsw-alias-border-l2)',
              }}
            >
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody style={{ borderTop: '1px solid var(--dsw-alias-border-l1)' }}>{children}</tbody>
          ),
          tr: ({ children }) => (
            <tr style={{ borderBottom: '1px solid var(--dsw-alias-border-l1)' }}>{children}</tr>
          ),
          th: ({ children }) => (
            <th className="px-3.5 py-2" style={{ fontWeight: 500, ...label('--dsw-alias-label-primary') }}>
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3.5 py-2" style={label('--dsw-alias-label-secondary')}>
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
                className="dsh-mono"
                style={{
                  padding: '2px 6px',
                  borderRadius: 'var(--dsh-radius-xs)',
                  background: 'var(--dsw-alias-markdown-inline-code)',
                  fontFamily: MONO,
                  fontSize: 'var(--dsh-text-s)',
                  lineHeight: '22px',
                  ...label('--dsw-alias-label-primary'),
                }}
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
              className="underline"
              style={label('--dsw-alias-state-business-primary')}
            >
              {children}
            </a>
          ),
          hr: () => (
            <hr className="my-4" style={{ border: 0, borderTop: '1px solid var(--dsw-alias-border-l1)' }} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Memoised on `content`.
 *
 * This matters more than it looks: the chat re-renders on every streamed token,
 * and without memoisation ReactMarkdown + remark-gfm re-parse EVERY message in
 * the transcript each time — that is what makes the tab lag while the agent is
 * running. With it, only the message currently streaming re-parses.
 */
const AgentMarkdown = React.memo(AgentMarkdownInner);
export default AgentMarkdown;
