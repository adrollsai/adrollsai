'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Calendar as CalendarIcon, Clock, Video, CheckCircle, AlertTriangle, ArrowRight, Loader2, RefreshCw, User, Mail, Phone } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

type Profile = {
  id: string
  business_name: string
  logo_url: string
  brand_color: string
  google_booking_duration: number
}

type Slot = {
  time: string
  label: string
  available: boolean
}

export default function PublicDirectBooking() {
  const params = useParams()
  const router = useRouter()
  const supabase = createClient()

  const hostId = params.user_id as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const [profile, setProfile] = useState<Profile | null>(null)
  
  // Date & Slot states
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [slots, setSlots] = useState<Slot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)

  // Booking Form states
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  
  const [submittingBooking, setSubmittingBooking] = useState(false)
  const [bookingSuccess, setBookingSuccess] = useState(false)
  const [confirmedTime, setConfirmedTime] = useState('')
  const [confirmedMeetLink, setConfirmedMeetLink] = useState('')

  // Fetch host profile
  useEffect(() => {
    async function loadProfile() {
      try {
        setLoading(true)
        setError(null)

        const res = await fetch(`/api/booking/preview/profile?host_id=${encodeURIComponent(hostId)}`)
        const data = await res.json()
        
        if (!res.ok || !data.profile) {
          setError('We could not find this booking page.')
          setLoading(false)
          return
        }

        setProfile(data.profile)

        // Pre-select tomorrow's date
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        const tomorrowStr = tomorrow.toISOString().split('T')[0]
        setSelectedDate(tomorrowStr)

      } catch (err: any) {
        console.error('[PUBLIC BOOKING] Failed to load profile:', err)
        setError('An unexpected error occurred while loading booking settings.')
      } finally {
        setLoading(false)
      }
    }

    if (hostId) {
      loadProfile()
    }
  }, [hostId])

  // Fetch slots when selected date changes
  useEffect(() => {
    async function loadSlots() {
      if (!selectedDate || !hostId) return
      try {
        setLoadingSlots(true)
        setSlots([])
        setSelectedSlot(null)

        const res = await fetch(`/api/booking/preview/slots?date=${selectedDate}&host_id=${hostId}`)
        const data = await res.json()

        if (!res.ok) throw new Error(data.error || 'Failed to fetch slots')
        setSlots(data.slots || [])
      } catch (err: any) {
        console.error('[PUBLIC BOOKING] Slots error:', err)
      } finally {
        setLoadingSlots(false)
      }
    }

    if (selectedDate) {
      loadSlots()
    }
  }, [selectedDate, hostId])

  // Handle direct booking submit
  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedSlot || !hostId || !name || !email || !phone) return
    try {
      setSubmittingBooking(true)
      const res = await fetch('/api/shared/booking/public-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host_id: hostId,
          slot: selectedSlot,
          name,
          email,
          phone
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Booking failed')

      setConfirmedTime(data.bookedTime)
      setConfirmedMeetLink(data.meetLink || '')
      setBookingSuccess(true)
    } catch (err: any) {
      alert(err.message || 'Failed to book slot. Please try another slot.')
    } finally {
      setSubmittingBooking(false)
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

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white p-8 rounded-2xl border border-slate-200 shadow-sm text-center">
          <div className="w-12 h-12 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-rose-200">
            <AlertTriangle size={24} />
          </div>
          <h2 className="text-lg font-black text-slate-800 mb-2">Booking Error</h2>
          <p className="text-sm text-slate-500 mb-6">{error || 'Booking page details are not available.'}</p>
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
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mt-0.5">Schedule a Consultation</p>
        </div>

        {/* Booking Success Screen */}
        {bookingSuccess ? (
          <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm text-center space-y-4">
            <div className="w-14 h-14 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto border border-emerald-200">
              <CheckCircle size={28} />
            </div>
            <h2 className="text-xl font-extrabold text-slate-800">Booking Confirmed!</h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              Your consultation has been successfully booked for <strong>{confirmedTime ? formatFriendlyDate(confirmedTime) : ''}</strong>. We have sent the meeting details to your email.
            </p>
            {confirmedMeetLink && (
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-left space-y-2 mt-4">
                <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Video Call Information</span>
                <a href={confirmedMeetLink} target="_blank" rel="noopener noreferrer" className="text-sm font-black text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1.5">
                  🎥 Join Google Meet
                </a>
              </div>
            )}
            <button 
              onClick={() => {
                setBookingSuccess(false)
                setSelectedSlot(null)
                setName('')
                setEmail('')
                setPhone('')
              }}
              style={{ backgroundColor: brandColor }}
              className="mt-6 px-6 py-2.5 rounded-full text-white text-xs font-bold transition-all shadow-md active:scale-95"
            >
              Book Another Appointment
            </button>
          </div>
        ) : (
          <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-6">
            
            {/* Step 1: Select Slot */}
            <div className="space-y-4">
              <h3 className="font-black text-slate-800 text-base">1. Select Date & Time</h3>
              
              {/* Days list row */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-2">Available Dates</label>
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
                  {getNext7Days().map(day => (
                    <button
                      key={day.value}
                      onClick={() => {
                        setSelectedDate(day.value)
                        setSelectedSlot(null)
                      }}
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
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-2 font-semibold">Available Slots (timezone: Asia/Kolkata)</label>
                
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
            </div>

            {/* Step 2: Contact Form */}
            {selectedSlot && (
              <form onSubmit={handleBookingSubmit} className="border-t border-slate-100 pt-6 space-y-4 animate-in fade-in slide-in-from-top-3 duration-300">
                <h3 className="font-black text-slate-800 text-base">2. Your Contact Information</h3>
                
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Your Full Name</label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 pointer-events-none">
                        <User size={14} />
                      </span>
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="John Doe"
                        className="w-full bg-slate-50 border border-slate-200 py-3 pl-9 pr-4 rounded-xl text-xs font-bold outline-none text-slate-800 focus:border-indigo-500 focus:bg-white transition-all"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Email Address</label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 pointer-events-none">
                          <Mail size={14} />
                        </span>
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="john.doe@example.com"
                          className="w-full bg-slate-50 border border-slate-200 py-3 pl-9 pr-4 rounded-xl text-xs font-bold outline-none text-slate-800 focus:border-indigo-500 focus:bg-white transition-all"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Phone Number</label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 pointer-events-none">
                          <Phone size={14} />
                        </span>
                        <input
                          type="tel"
                          required
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="e.g. +91 9999999999"
                          className="w-full bg-slate-50 border border-slate-200 py-3 pl-9 pr-4 rounded-xl text-xs font-bold outline-none text-slate-800 focus:border-indigo-500 focus:bg-white transition-all"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/60 flex items-center justify-between text-xs text-slate-500 font-semibold mt-2">
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-slate-400" />
                    <span>Booking slot: <strong>{new Date(selectedSlot).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}</strong></span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submittingBooking}
                  style={{ backgroundColor: brandColor }}
                  className="w-full py-3 text-white text-xs font-black rounded-2xl flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-95 mt-4"
                >
                  {submittingBooking ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Booking Appointment...</span>
                    </>
                  ) : (
                    <>
                      <span>Confirm Booking</span>
                      <ArrowRight size={14} />
                    </>
                  )}
                </button>
              </form>
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
