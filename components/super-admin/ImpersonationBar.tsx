'use client'

/**
 * The super admin's tenant switcher.
 *
 * WHY THIS EXISTS
 * Impersonation only ever existed as a query parameter that the "Connected accounts"
 * page happened to set: to look at another tenant you had to return to
 * /dashboard/accounts, find the account, click "Impersonate", and then hunt for the
 * page you were on again. Nothing stayed on screen to tell you which tenant you were
 * looking at, which is how a super admin ends up editing the wrong client's CRM.
 *
 * This bar is deliberately:
 *   - sticky at the top of the dashboard, so the current tenant is always visible;
 *   - route-preserving, so switching tenant keeps you on the same page;
 *   - only rendered for a super_admin (every other role never sees it, and it takes
 *     no space for them);
 *   - state-only, never cached in localStorage: the list is the live `profiles` table.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeftRight, Building2, Loader2, RotateCcw, ShieldCheck } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import SearchableSelect from '@/components/SearchableSelect'
import type { SearchableSelectOption } from '@/components/SearchableSelect'

/** Every role a super admin may look through. `super_admin` itself is excluded. */
const SWITCHABLE_ROLES = ['agency', 'admin', 'client', 'agent', 'team_member']

type Tenant = {
  id: string
  label: string
  role: string
}

function ImpersonationBarInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const impersonateId = searchParams.get('impersonate')

  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [current, setCurrent] = useState<Tenant | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: me } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (me?.role !== 'super_admin') {
        setIsSuperAdmin(false)
        return
      }
      setIsSuperAdmin(true)

      const { data: rows } = await supabase
        .from('profiles')
        .select('id, business_name, full_name, email, role')
        .in('role', SWITCHABLE_ROLES)
        .order('business_name', { ascending: true, nullsFirst: false })
        .limit(1000)

      const list: Tenant[] = (rows || [])
        .map((r: any) => ({
          id: r.id,
          label: String(r.business_name || r.full_name || r.email || r.id.slice(0, 8)),
          role: String(r.role || ''),
        }))
        .sort((a, b) => a.label.localeCompare(b.label))

      setTenants(list)
      setCurrent(impersonateId ? list.find((t) => t.id === impersonateId) || null : null)
    } catch (err) {
      console.error('[ImpersonationBar] load failed', err)
    } finally {
      setLoading(false)
    }
  }, [impersonateId, supabase])

  useEffect(() => {
    load()
  }, [load])

  const options: SearchableSelectOption[] = useMemo(
    () => [
      { value: 'PLATFORM', label: 'Platform (no impersonation)', badge: 'OWNER', badgeTone: 'slate' },
      ...tenants.map((t) => ({
        value: t.id,
        label: t.label,
        hint: t.role,
        badge: t.id === impersonateId ? 'VIEWING' : null,
        badgeTone: 'emerald' as const,
      })),
    ],
    [tenants, impersonateId]
  )

  /** Switch tenant without losing the page or its other query params. */
  const go = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (!value || value === 'PLATFORM') params.delete('impersonate')
      else params.set('impersonate', value)
      const qs = params.toString()
      router.push(qs ? `${pathname}?${qs}` : pathname)
    },
    [pathname, router, searchParams]
  )

  if (!isSuperAdmin) return null

  return (
    <div className="sticky top-0 z-50 w-full border-b border-indigo-200/70 bg-indigo-50/95 backdrop-blur supports-[backdrop-filter]:bg-indigo-50/80">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-3 py-1.5 sm:gap-3 sm:px-4">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
          <ShieldCheck size={11} />
          Super admin
        </span>

        <span className="hidden items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-indigo-900/70 sm:inline-flex">
          <ArrowLeftRight size={12} />
          Viewing as
        </span>

        <div className="min-w-[190px] flex-1 sm:max-w-[320px] sm:flex-none">
          {loading && !tenants.length ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-900/70">
              <Loader2 size={12} className="animate-spin" /> loading tenants…
            </span>
          ) : (
            <SearchableSelect
              options={options}
              value={impersonateId || 'PLATFORM'}
              onChange={go}
              placeholder="Pick an account"
              searchPlaceholder="Search tenants…"
              icon={<Building2 size={13} />}
              buttonClassName="!py-1 !px-2.5 !rounded-lg !text-xs !font-bold !border-indigo-200 !bg-white"
            />
          )}
        </div>

        {impersonateId ? (
          <button
            onClick={() => go('PLATFORM')}
            className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-[11px] font-bold text-indigo-700 transition hover:bg-indigo-100 active:scale-95"
            title="Stop impersonating and go back to the platform account"
          >
            <RotateCcw size={11} />
            Exit
          </button>
        ) : (
          <span className="text-[11px] font-semibold text-indigo-900/50">platform view</span>
        )}

        <span className="ml-auto hidden text-[11px] font-semibold text-indigo-900/50 sm:inline">
          {current ? `acting on ${current.label}` : 'no tenant selected'}
        </span>

        <button
          onClick={() => router.push('/dashboard/accounts')}
          className="ml-auto rounded-lg px-2 py-1 text-[11px] font-bold text-indigo-700 underline-offset-2 hover:underline sm:ml-0"
        >
          All accounts
        </button>
      </div>
    </div>
  )
}

export default function ImpersonationBar() {
  return (
    <Suspense fallback={null}>
      <ImpersonationBarInner />
    </Suspense>
  )
}
