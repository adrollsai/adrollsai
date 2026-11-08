'use client';

import * as React from 'react';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import AgentChat from '@/components/agent/AgentChat';
import { Loader2 } from 'lucide-react';

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
      <div className="h-[calc(100vh-64px)] flex items-center justify-center bg-[#fdfdfe] dark:bg-[#0d0e12]">
        <Loader2 size={28} className="text-[#4d6bfe] animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-64px)] w-full overflow-hidden bg-[#fdfdfe] dark:bg-[#0d0e12]">
      <AgentChat impersonateId={impersonateId} impersonatedName={impersonatedName} />
    </div>
  );
}

export default function AgentPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center bg-[#fdfdfe] dark:bg-[#0d0e12]">
          <Loader2 size={28} className="text-[#4d6bfe] animate-spin" />
        </div>
      }
    >
      <AgentPageContent />
    </Suspense>
  );
}
