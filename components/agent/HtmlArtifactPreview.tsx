'use client';

import * as React from 'react';
import { useState } from 'react';
import { Maximize2, Minimize2, Code, Eye, Sparkles } from 'lucide-react';

interface HtmlArtifactPreviewProps {
  title: string;
  html: string;
  description?: string;
}

export default function HtmlArtifactPreview({ title, html, description }: HtmlArtifactPreviewProps) {
  const [showCode, setShowCode] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={`my-3 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-sm transition-all duration-300 ${isExpanded ? 'fixed inset-4 z-50 shadow-2xl flex flex-col' : ''}`}>
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-blue-100 dark:bg-blue-900/60 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <Sparkles size={12} />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200">{title}</h4>
            {description && <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1">{description}</p>}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowCode(!showCode)}
            className="p-1 rounded text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700 transition"
            title={showCode ? 'View Preview' : 'View Code'}
          >
            {showCode ? <Eye size={14} /> : <Code size={14} />}
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700 transition"
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className={`p-3 overflow-auto ${isExpanded ? 'flex-1' : 'max-h-96'}`}>
        {showCode ? (
          <pre className="text-[11px] font-mono bg-slate-950 text-slate-200 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">
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
            className="w-full min-h-[220px] rounded-lg border-0 bg-transparent"
            sandbox="allow-scripts"
            title={title}
          />
        )}
      </div>
    </div>
  );
}
