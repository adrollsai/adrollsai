'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { Loader2 } from 'lucide-react'

export default function SharedBookingRedirect() {
  const params = useParams() as { lead_id?: string }
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const resolveBooking = async () => {
      const leadId = params.lead_id
      if (!leadId) {
        setError('Invalid booking reference')
        return
      }

      const { data: lead } = await supabase
        .from('leads')
        .select('id, user_id')
        .eq('id', leadId)
        .maybeSingle()

      if (!lead?.user_id) {
        setError('Appointment details not found or link has expired.')
        return
      }

      const queryStr = searchParams.toString() ? `?${searchParams.toString()}` : ''
      router.replace(`/shared/${lead.user_id}/booking/${lead.id}${queryStr}`)
    }

    resolveBooking()
  }, [params.lead_id, router, searchParams, supabase])

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-800 text-white p-8 rounded-2xl max-w-sm text-center shadow-2xl">
          <p className="text-rose-400 font-bold mb-2">Notice</p>
          <p className="text-slate-300 text-sm">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-4">
      <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-4" />
      <p className="text-slate-400 text-sm">Loading appointment details...</p>
    </div>
  )
}
