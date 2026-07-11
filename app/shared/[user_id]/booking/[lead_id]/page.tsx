'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Calendar as CalendarIcon, Clock, Video, CheckCircle, AlertTriangle, ArrowRight, Loader2, RefreshCw } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

type Profile = {
  id: string
  business_name: string
  logo_url: string
  brand_color: string
  google_booking_duration: number
}

type Lead = {
  id: string
  name: string
  email: string
  phone: string
  booked_time: string | null
  meet_link: string | null
  user_id: string
}

type Slot = {
  time: string
  label: string
  available: boolean
}

export default function PublicBookingPortal() {
  const params = useParams() as { user_id?: string; lead_id?: string }
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const leadId = params.lead_id as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const [lead, setLead] = useState<Lead | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  
  // Reschedule flow
  const [isRescheduling, setIsRescheduling] = useState(searchParams.get('action') === 'reschedule')
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [slots, setSlots] = useState<Slot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [submittingReschedule, setSubmittingReschedule] = useState(false)

  // Cancel flow
  const [isCancelling, setIsCancelling] = useState(searchParams.get('action') === 'cancel')
  const [submittingCancel, setSubmittingCancel] = useState(false)
  const [cancelledSuccess, setCancelledSuccess] = useState(false)
  const [rescheduledSuccess, setRescheduledSuccess] = useState(false)

  // Fetch lead and host profile
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true)
        setError(null)

        let currentUserId = ''

        if (leadId === 'preview') {
          const hostId = params.user_id || ''
          const mockLead: Lead = {
            id: 'preview',
            name: 'John Doe (Preview Mode)',
            email: 'john.doe@example.com',
            phone: '+1 555 0199',
            booked_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Booked tomorrow
            meet_link: 'https://meet.google.com/abc-defg-hij',
            user_id: hostId
          }
          setLead(mockLead)
          currentUserId = hostId
        } else {
          // Load lead
          const { data: leadData, error: leadErr } = await supabase
            .from('leads')
            .select('*')
            .eq('id', leadId)
            .maybeSingle()

          if (leadErr) throw leadErr
          if (!leadData) {
            setError('We could not find your booking record.')
            setLoading(false)
            return
          }

          setLead(leadData)
          currentUserId = leadData.user_id
        }

        // Load host profile
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(currentUserId)
        let profileQuery = supabase
          .from('profiles')
          .select('id, business_name, logo_url, brand_color, google_booking_duration')
        
        if (isUuid) {
          profileQuery = profileQuery.eq('id', currentUserId)
        } else {
          profileQuery = profileQuery.eq('custom_domain', currentUserId)
        }

        const { data: profileData, error: profileErr } = await profileQuery.maybeSingle()
        if (profileErr) throw profileErr
        setProfile(profileData)


        // Pre-select today's or tomorrow's date for rescheduling
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        const tomorrowStr = tomorrow.toISOString().split('T')[0]
        setSelectedDate(tomorrowStr)

      } catch (err: any) {
        console.error('[BOOKING PORTAL] Failed to load:', err)
        setError('An unexpected error occurred while loading booking details.')
      } finally {
        setLoading(false)
      }
    }

    if (leadId) {
      loadData()
    }
  }, [leadId])

  // Fetch slots when selected date changes
  useEffect(() => {
    async function loadSlots() {
      if (!selectedDate || !leadId) return
      try {
        setLoadingSlots(true)
        setSlots([])
        setSelectedSlot(null)

        const url = leadId === 'preview' 
          ? `/api/booking/preview/slots?date=${selectedDate}&host_id=${params.user_id}`
          : `/api/booking/${leadId}/slots?date=${selectedDate}`

        const res = await fetch(url)
        const data = await res.json()

        if (!res.ok) throw new Error(data.error || 'Failed to fetch slots')
        setSlots(data.slots || [])
      } catch (err: any) {
        console.error('[BOOKING PORTAL] Slots error:', err)
      } finally {
        setLoadingSlots(false)
      }
    }

    if (isRescheduling && selectedDate) {
      loadSlots()
    }
  }, [selectedDate, isRescheduling, leadId, params.user_id])

  // Handle slot reservation / reschedule submit
  const handleRescheduleSubmit = async () => {
    if (!selectedSlot || !leadId) return
    try {
      setSubmittingReschedule(true)

      if (leadId === 'preview') {
        // Simulate preview success
        await new Promise(resolve => setTimeout(resolve, 800))
        setRescheduledSuccess(true)
        setIsRescheduling(false)
        setLead(prev => prev ? { ...prev, booked_time: selectedSlot } : null)
        return
      }

      const res = await fetch(`/api/booking/${leadId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reschedule', slot: selectedSlot })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Booking failed')

      setRescheduledSuccess(true)
      setIsRescheduling(false)
      // Reload lead status
      const { data: updatedLead } = await supabase
        .from('leads')
        .select('*')
        .eq('id', leadId)
        .single()
      if (updatedLead) {
        setLead(updatedLead)
      }
    } catch (err: any) {
      alert(err.message || 'Failed to reschedule. Please try another slot.')
    } finally {
      setSubmittingReschedule(false)
    }
  }

  // Handle cancellation submit
  const handleCancelSubmit = async () => {
    if (!leadId) return
    try {
      setSubmittingCancel(true)

      if (leadId === 'preview') {
        // Simulate preview success
        await new Promise(resolve => setTimeout(resolve, 800))
        setCancelledSuccess(true)
        setIsCancelling(false)
        setLead(prev => prev ? { ...prev, booked_time: null, meet_link: null } : null)
        return
      }

      const res = await fetch(`/api/booking/${leadId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Cancellation failed')

      setCancelledSuccess(true)
      setIsCancelling(false)
      setLead(prev => prev ? { ...prev, booked_time: null, meet_link: null } : null)
    } catch (err: any) {
      alert(err.message || 'Failed to cancel appointment.')
    } finally {
      setSubmittingCancel(false)
    }
  }

  // Format Helper: date strings
  const formatFriendlyDate = (isoStr: string) => {
    return new Date(isoStr).toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })
  }

  // Generate date list for the next 7 days (skipping Sundays)
  const getNext7Days = () => {
    const dates = []
    const now = new Date()
    for (let i = 1; i <= 8; i++) {
      const d = new Date()
      d.setDate(now.getDate() + i)
      if (d.getDay() === 0) continue // Skip Sunday
      dates.push({
        value: d.toISOString().split('T')[0],
        label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      })
    }
    return dates.slice(0, 7)
  }

  const brandColor = profile?.brand_color || '#0F172A'

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <Loader2 className="animate-spin text-slate-400 mb-2" size={32} />
        <p className="text-sm font-semibold text-slate-500">Loading booking page...</p>
      </div>
    )
  }

  if (error || !lead) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white p-8 rounded-2xl border border-slate-200 shadow-sm text-center">
          <div className="w-12 h-12 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-rose-200">
            <AlertTriangle size={24} />
          </div>
          <h2 className="text-lg font-black text-slate-800 mb-2">Booking Error</h2>
          <p className="text-sm text-slate-500 mb-6">{error || 'Appointment booking information is not available.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50/50 py-12 px-4 sm:px-6 lg:px-8 flex flex-col justify-between font-sans selection:bg-indigo-500 selection:text-white">
      <div className="max-w-xl mx-auto w-full">
        
        {/* Logo / Header */}
        <div className="text-center mb-8">
          {profile?.logo_url ? (
            <img src={profile.logo_url} alt={profile.business_name} className="h-12 w-auto mx-auto mb-3 object-contain" />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-white font-black flex items-center justify-center mx-auto mb-3 text-lg">
              {profile?.business_name?.[0] || 'N'}
            </div>
          )}
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">{profile?.business_name || 'Appointment Booking'}</h1>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mt-0.5">Manage Your Consultation</p>
        </div>

        {/* Cancelled Success Screen */}
        {cancelledSuccess && (
          <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm text-center space-y-4">
            <div className="w-14 h-14 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto border border-rose-200">
              <CheckCircle size={28} />
            </div>
            <h2 className="text-xl font-extrabold text-slate-800">Appointment Cancelled</h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              Your appointment with <strong>{profile?.business_name}</strong> has been cancelled. An email confirmation was sent to your inbox.
            </p>
            <button 
              onClick={() => {
                setCancelledSuccess(false)
                setIsRescheduling(true)
              }} 
              style={{ backgroundColor: brandColor }}
              className="mt-4 px-6 py-2.5 rounded-full text-white text-xs font-bold transition-all shadow-md active:scale-95"
            >
              Book New Appointment
            </button>
          </div>
        )}

        {/* Rescheduled Success Screen */}
        {rescheduledSuccess && (
          <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm text-center space-y-4">
            <div className="w-14 h-14 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto border border-emerald-200">
              <CheckCircle size={28} />
            </div>
            <h2 className="text-xl font-extrabold text-slate-800">Booking Rescheduled!</h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              Your meeting was successfully moved to <strong>{lead.booked_time ? formatFriendlyDate(lead.booked_time) : ''}</strong>. We've sent the meeting links to your email.
            </p>
            <button 
              onClick={() => setRescheduledSuccess(false)}
              style={{ backgroundColor: brandColor }}
              className="mt-4 px-6 py-2.5 rounded-full text-white text-xs font-bold transition-all shadow-md active:scale-95"
            >
              View Booking Details
            </button>
          </div>
        )}

        {/* Main Interface */}
        {!cancelledSuccess && !rescheduledSuccess && (
          <div className="space-y-6">
            
            {/* Lead Booking Status Card */}
            {!isRescheduling && !isCancelling && (
              <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm relative overflow-hidden">
                <div style={{ backgroundColor: brandColor }} className="absolute top-0 left-0 w-1.5 h-full" />
                
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Your Booking Status</h3>
                
                {lead.booked_time ? (
                  <div className="space-y-5">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 shrink-0">
                        <CalendarIcon size={18} />
                      </div>
                      <div>
                        <span className="block text-xs font-semibold text-slate-400">Scheduled Consultation</span>
                        <span className="text-base font-extrabold text-slate-800">{formatFriendlyDate(lead.booked_time)}</span>
                      </div>
                    </div>

                    {lead.meet_link && (
                      <div className="flex items-start gap-3">
                        <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 shrink-0">
                          <Video size={18} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="block text-xs font-semibold text-slate-400">Meeting Video Room</span>
                          <a href={lead.meet_link} target="_blank" rel="noopener noreferrer" className="text-sm font-black text-blue-600 hover:text-blue-800 hover:underline break-all">
                            🎥 Join Google Meet
                          </a>
                        </div>
                      </div>
                    )}

                    <div className="border-t border-slate-100 pt-4 flex gap-3">
                      <button 
                        onClick={() => setIsRescheduling(true)}
                        className="flex-1 py-3 border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold rounded-2xl text-xs transition-all active:scale-95 text-center"
                      >
                        Reschedule
                      </button>
                      <button 
                        onClick={() => setIsCancelling(true)}
                        className="flex-1 py-3 bg-rose-50 border border-rose-100 hover:bg-rose-100/70 text-rose-600 font-bold rounded-2xl text-xs transition-all active:scale-95 text-center"
                      >
                        Cancel Appointment
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <div className="w-12 h-12 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-3 border border-amber-100">
                      <Clock size={20} />
                    </div>
                    <h4 className="font-extrabold text-slate-800 text-sm">No Appointment Booked</h4>
                    <p className="text-xs text-slate-400 max-w-xs mx-auto mt-1">You currently do not have a booked slot or the booking was cancelled.</p>
                    <button 
                      onClick={() => setIsRescheduling(true)}
                      style={{ backgroundColor: brandColor }}
                      className="mt-4 px-6 py-2 rounded-full text-white text-xs font-bold transition-all shadow-sm active:scale-95"
                    >
                      Book A Slot
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Rescheduling Scheduler Card */}
            {isRescheduling && (
              <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-black text-slate-800 text-base">Select New Date & Time</h3>
                  <button 
                    onClick={() => {
                      if (lead.booked_time) {
                        setIsRescheduling(false)
                      }
                    }} 
                    className="text-xs font-bold text-slate-400 hover:text-slate-600"
                  >
                    Back
                  </button>
                </div>

                {/* Days list row */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase block mb-2">Available Dates</label>
                  <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
                    {getNext7Days().map(day => (
                      <button
                        key={day.value}
                        onClick={() => setSelectedDate(day.value)}
                        className={`px-4 py-3 rounded-2xl text-center text-xs font-bold border transition-all shrink-0 active:scale-95 flex flex-col gap-0.5 justify-center ${
                          selectedDate === day.value 
                            ? 'border-indigo-600 text-white shadow-sm'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'
                        }`}
                        style={selectedDate === day.value ? { backgroundColor: brandColor, borderColor: brandColor } : {}}
                      >
                        <span>{day.label.split(',')[0]}</span>
                        <span className="opacity-90">{day.label.split(' ').slice(1).join(' ')}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Slots Grid */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase block mb-2">Available Slots (timezone: Asia/Kolkata)</label>
                  
                  {loadingSlots ? (
                    <div className="py-8 flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin text-indigo-500 mb-1" size={20} />
                      <span className="text-[10px] text-slate-400 font-semibold">Calculating conflicts...</span>
                    </div>
                  ) : slots.length === 0 ? (
                    <div className="py-8 text-center text-slate-400 text-xs font-semibold">
                      No slots available for this date. Please select another date.
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {slots.map(slot => (
                        <button
                          key={slot.time}
                          disabled={!slot.available}
                          onClick={() => setSelectedSlot(slot.time)}
                          className={`py-2.5 rounded-xl text-center text-xs font-bold border transition-all ${
                            !slot.available
                              ? 'bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed line-through'
                              : selectedSlot === slot.time
                                ? 'text-white border-indigo-600 font-extrabold shadow-sm'
                                : 'border-slate-200 text-slate-600 hover:border-slate-400 bg-white hover:bg-slate-50/50'
                          }`}
                          style={selectedSlot === slot.time ? { backgroundColor: brandColor, borderColor: brandColor } : {}}
                        >
                          {slot.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Submitting confirmation */}
                {selectedSlot && (
                  <div className="border-t border-slate-100 pt-4 flex flex-col gap-3">
                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/60 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                        <Clock size={14} className="text-slate-400" />
                        <span>Rescheduling slot to: <strong>{new Date(selectedSlot).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}</strong></span>
                      </div>
                    </div>
                    <button
                      onClick={handleRescheduleSubmit}
                      disabled={submittingReschedule}
                      style={{ backgroundColor: brandColor }}
                      className="w-full py-3 text-white text-xs font-black rounded-2xl flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-95"
                    >
                      {submittingReschedule ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          <span>Rescheduling...</span>
                        </>
                      ) : (
                        <>
                          <span>Confirm Booking</span>
                          <ArrowRight size={14} />
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Cancellation Confirmation Card */}
            {isCancelling && (
              <div className="bg-white p-6 rounded-3xl border border-rose-100 shadow-sm space-y-5">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-rose-50 text-rose-500 rounded-full border border-rose-100">
                    <AlertTriangle size={24} />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-slate-800 text-base">Cancel Appointment</h3>
                    <p className="text-xs text-slate-400 mt-0.5">This action cannot be undone.</p>
                  </div>
                </div>

                <p className="text-xs text-slate-500 leading-relaxed bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
                  Are you sure you want to cancel your meeting scheduled for <strong>{lead.booked_time ? formatFriendlyDate(lead.booked_time) : ''}</strong>?
                </p>

                <div className="flex gap-3">
                  <button 
                    disabled={submittingCancel}
                    onClick={handleCancelSubmit}
                    className="flex-1 py-3 bg-rose-500 text-white font-extrabold rounded-2xl text-xs hover:bg-rose-600 transition-all active:scale-95 flex items-center justify-center gap-1.5"
                  >
                    {submittingCancel ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        <span>Cancelling...</span>
                      </>
                    ) : (
                      'Yes, Cancel Appointment'
                    )}
                  </button>
                  <button 
                    disabled={submittingCancel}
                    onClick={() => setIsCancelling(false)}
                    className="flex-1 py-3 border border-slate-200 text-slate-700 font-extrabold rounded-2xl text-xs hover:bg-slate-50 transition-all active:scale-95"
                  >
                    No, Keep Booking
                  </button>
                </div>
              </div>
            )}

          </div>
        )}

      </div>

      {/* Footer copyright */}
      <div className="text-center text-[10px] text-slate-400 font-semibold tracking-wider uppercase mt-12 pb-4">
        © {new Date().getFullYear()} {profile?.business_name || 'Nobogent'}. All rights reserved.
      </div>
    </div>
  )
}
