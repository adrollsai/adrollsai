'use client';

import * as React from 'react';
import { useState } from 'react';
import { Maximize2, Minimize2, Code, Eye, Sparkles } from 'lucide-react';

interface HtmlArtifactPreviewProps {
  title: string;
  html: string;
  description?: string;
}

/**
 * Inline HTML artifact preview, on the token system.
 *
 * The old markup used light/dark Tailwind pairs, which under the harness
 * (data-theme, not the `dark` class) resolved to the light branch — a white
 * panel inside the dark UI.
 */
export default function HtmlArtifactPreview({ title, html, description }: HtmlArtifactPreviewProps) {
  const [showCode, setShowCode] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const iconButton =
    'p-1 rounded dsh-label-tertiary dsh-interactive';

  return (
    <div
      className={`my-3 overflow-hidden transition-all duration-300 ${
        isExpanded ? 'fixed inset-4 z-50 flex flex-col' : ''
      }`}
      style={{
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 'var(--dsh-radius-md)',
        background: 'var(--dsw-alias-bg-layer-1)',
        boxShadow: isExpanded ? 'var(--dsw-shadow-lv3)' : 'var(--dsw-shadow-lv1)',
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{
          background: 'var(--dsw-alias-bg-layer-2)',
          borderBottom: '1px solid var(--dsw-alias-border-l1)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-5 h-5 flex items-center justify-center shrink-0 dsh-accent"
            style={{
              borderRadius: 'var(--dsh-radius-xs)',
              background: 'var(--dsw-alias-state-business-tertiary)',
            }}
          >
            <Sparkles size={12} />
          </div>
          <div className="min-w-0">
            <h4 className="dsh-t-xs dsh-strong dsh-label-primary truncate">{title}</h4>
            {description && (
              <p className="dsh-t-xxxs dsh-label-tertiary truncate leading-[14px]">{description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0 ml-2">
          <button
            onClick={() => setShowCode(!showCode)}
            className={iconButton}
            title={showCode ? 'View preview' : 'View code'}
          >
            {showCode ? <Eye size={14} /> : <Code size={14} />}
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={iconButton}
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      <div className={`p-3 overflow-auto ${isExpanded ? 'flex-1' : 'max-h-96'}`}>
        {showCode ? (
          <pre
            className="dsh-mono dsh-t-xs p-3 overflow-x-auto whitespace-pre-wrap"
            style={{
              background: 'var(--dsw-alias-markdown-code-block)',
              borderRadius: 'var(--dsh-radius-sm)',
              color: 'var(--dsw-alias-label-secondary)',
              margin: 0,
            }}
          >
            {html}
          </pre>
        ) : (
          <iframe
            srcDoc={`
              <!DOCTYPE html>
              <html>
                <head>
                  <meta charset="utf-8" />
                  <meta name="viewport" content="width=device-width, initial-scale=1" />
                  <script src="https://cdn.tailwindcss.com"></script>
                </head>
                <body class="bg-transparent p-2 font-sans antialiased">
                  ${html}
                </body>
              </html>
            `}
            className="w-full min-h-[220px] border-0 bg-transparent"
            style={{ borderRadius: 'var(--dsh-radius-sm)' }}
            sandbox="allow-scripts"
            title={title}
          />
        )}
      </div>
    </div>
  );
}
