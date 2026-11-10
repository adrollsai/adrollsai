'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AgentChat from '@/components/agent/AgentChat';
import { Loader2 } from 'lucide-react';
import '../../../lib/ui/dsh-tokens.css';

function AgentPageContent() {
  const searchParams = useSearchParams();
  const impersonateId = searchParams.get('impersonate');

  return (
    // `.dsh` scopes the harness design tokens (off-white dark surfaces,
    // neutral chrome, 16px prose) so they never leak into the dashboard UI.
    <div className="dsh fixed inset-0 z-50 h-screen w-screen overflow-hidden" data-theme="light">
      <AgentChat impersonateId={impersonateId} />
    </div>
  );
}

export default function AgentPage() {
  return (
    <Suspense
      fallback={
        <div
          className="dsh fixed inset-0 z-50 flex items-center justify-center"
          data-theme="light"
        >
          <div
            className="flex items-center gap-3 p-5 rounded-[16px]"
            style={{
              background: 'var(--dsw-alias-bg-layer-2)',
              border: '1px solid var(--dsw-alias-border-l1)',
              boxShadow: 'var(--dsw-shadow-lv2)',
            }}
          >
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--dsw-alias-label-tertiary)' }} />
            <p className="dsh-t-s dsh-label-secondary">Loading harness…</p>
          </div>
        </div>
      }
    >
      <AgentPageContent />
    </Suspense>
  );
}
