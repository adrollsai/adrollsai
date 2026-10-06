'use client';

import * as React from 'react';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import AgentChat from '@/components/agent/AgentChat';
import { Bot, ShieldCheck, Loader2, Building2 } from 'lucide-react';

function AgentPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const impersonateId = searchParams.get('impersonate');
  const supabase = createClient();

  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [impersonatedName, setImpersonatedName] = useState<string | null>(null);

  useEffect(() => {
    async function checkSuperAdmin() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        router.push('/login');
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role, email')
        .eq('id', session.user.id)
        .single();

      const isSuperAdmin =
        profile?.role === 'super_admin' ||
        profile?.email === 'rchopra489@gmail.com' ||
        session.user.email === 'rchopra489@gmail.com';

      if (!isSuperAdmin) {
        router.push('/dashboard');
        return;
      }

      setIsAuthorized(true);

      // If impersonating, fetch client name for the top badge
      if (impersonateId) {
        const { data: clientProfile } = await supabase
          .from('profiles')
          .select('business_name, email')
          .eq('id', impersonateId)
          .single();
        if (clientProfile) {
          setImpersonatedName(clientProfile.business_name || clientProfile.email);
        }
      } else {
        setImpersonatedName(null);
      }
    }

    checkSuperAdmin();
  }, [router, supabase, impersonateId]);

  if (isAuthorized === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Loader2 size={24} className="text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950 pb-24 pt-4 px-3 sm:px-6">
      <div className="max-w-5xl mx-auto mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600/10 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center">
            <Bot size={18} />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
              Nobo
              <span className="text-[10px] font-bold uppercase tracking-wider bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-400 px-2 py-0.5 rounded-full">
                Super Admin Access
              </span>
              {impersonatedName && (
                <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-400 px-2 py-0.5 rounded-full flex items-center gap-1 border border-amber-200 dark:border-amber-900">
                  <Building2 size={10} />
                  <span>Client: {impersonatedName}</span>
                </span>
              )}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Autonomous AI business partner • CRM, Meta Ads MCP, Crons & Scheduling, Supabase & Vercel control.
            </p>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 px-3 py-1.5 rounded-full">
          <ShieldCheck size={14} />
          <span>Super Admin Active</span>
        </div>
      </div>

      <AgentChat impersonateId={impersonateId} />
    </div>
  );
}

export default function AgentPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
          <Loader2 size={24} className="text-blue-600 animate-spin" />
        </div>
      }
    >
      <AgentPageContent />
    </Suspense>
  );
}
