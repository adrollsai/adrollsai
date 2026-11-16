import { redirect } from 'next/navigation'

/**
 * The "Distribute" destination.
 *
 * `components/BottomNav.tsx` has advertised this tab for any tenant with
 * `profiles.enable_distribution = true`, but the route never existed — the tab
 * was a guaranteed 404. Lead distribution is implemented inside the CRM tab
 * (`components/GroupLeadDistributionModal.tsx`), so this route forwards there
 * instead of dead-ending. The impersonation scope is carried through so an
 * agency viewing a sub-account keeps that context.
 */
export default async function DistributePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = (await searchParams) || {}
  const raw = params.impersonate
  const impersonate = Array.isArray(raw) ? raw[0] : raw

  redirect(
    impersonate
      ? `/dashboard/crm?impersonate=${encodeURIComponent(impersonate)}`
      : '/dashboard/crm'
  )
}
