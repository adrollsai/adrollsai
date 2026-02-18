'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { ChevronLeft, ChevronRight, CheckCircle, AlertCircle, Banknote, Home, RefreshCw, Loader2, Info } from 'lucide-react'

// --- HELPER TYPES & LOGIC ---
const PEAK_MONTHS = [3, 4, 5] // April(3), May(4), June(5) - 0-indexed for JS Date
const QUARTER_LIMIT = 7
const PEAK_LIMIT = 4

// Helper to get Q1, Q2, etc.
const getQuarter = (date: Date) => Math.floor(date.getMonth() / 3) + 1

export default function BookingPortal() {
  const supabase = createClient()
  
  // Data State
  const [loading, setLoading] = useState(true)
  const [holding, setHolding] = useState<any>(null)
  const [bookings, setBookings] = useState<any[]>([])
  const [preferences, setPreferences] = useState<any[]>([])

  // UI State
  const [currentDate, setCurrentDate] = useState(new Date()) // For calendar navigation
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [processingPref, setProcessingPref] = useState<number | null>(null) // To show loading on specific quarter

  // 1. Fetch My Holding
  const fetchMyData = async () => {
    // Keep loading true only on initial load, not refresh
    if (!holding) setLoading(true)
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Get first holding
    const { data: myHolding } = await supabase
        .from('customer_holdings')
        .select('*, fractions(*, properties(*))')
        .eq('user_id', user.id)
        .single()
    
    if (myHolding) {
        setHolding(myHolding)
        
        // Fetch Bookings
        const { data: allBookings } = await supabase
            .from('fraction_bookings')
            .select('*')
            .eq('property_id', myHolding.fractions.properties.id)
        
        setBookings(allBookings || [])

        // Fetch My Preferences
        const { data: prefs } = await supabase
            .from('quarterly_preferences')
            .select('*')
            .eq('holding_id', myHolding.id)
        
        setPreferences(prefs || [])
    }
    setLoading(false)
  }

  useEffect(() => { fetchMyData() }, [])

  // --- CALENDAR LOGIC ---
  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate()
  const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay()
  const daysInCurrentMonth = getDaysInMonth(currentDate.getFullYear(), currentDate.getMonth())

  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))
  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))

  // Check status of a specific day
  const getDayStatus = (day: number) => {
    const checkDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day)
    const dateStr = checkDate.toISOString().split('T')[0] // YYYY-MM-DD

    // 1. Is it booked?
    const booking = bookings.find(b => 
        dateStr >= b.start_date && dateStr <= b.end_date
    )

    if (booking) {
        if (booking.holding_id === holding?.id) return 'my_stay' // Blue
        if (booking.type === 'guest_booking') return 'rented' // Gold
        return 'unavailable' // Red (Other owner)
    }

    return 'available' // Green
  }

  // --- VALIDATION LOGIC ---
  const validateBooking = () => {
      if (!selectedDate || !holding) return { valid: false, msg: "Select a date" }

      const q = getQuarter(selectedDate)
      const isPeak = PEAK_MONTHS.includes(selectedDate.getMonth())
      
      // Calculate current usage
      const myBookings = bookings.filter(b => b.holding_id === holding.id)
      
      // Count nights used in this quarter
      let quarterNights = 0
      let peakNights = 0
      
      myBookings.forEach(b => {
          const start = new Date(b.start_date)
          // Simple check: if start date is in this quarter
          if (getQuarter(start) === q && start.getFullYear() === selectedDate.getFullYear()) {
              quarterNights += 1
          }
          if (PEAK_MONTHS.includes(start.getMonth()) && start.getFullYear() === selectedDate.getFullYear()) {
              peakNights += 1
          }
      })

      if (quarterNights >= QUARTER_LIMIT) return { valid: false, msg: `Quarter ${q} limit (${QUARTER_LIMIT} nights) reached.` }
      if (isPeak && peakNights >= PEAK_LIMIT) return { valid: false, msg: `Peak Season limit (${PEAK_LIMIT} nights) reached.` }
      
      return { valid: true, msg: "Date available" }
  }

  // --- ACTION: BOOK NIGHT ---
  const handleBooking = async () => {
    if (!selectedDate || !holding) return

    const dateStr = selectedDate.toISOString().split('T')[0]
    
    // 1. Create Booking
    const { error } = await supabase.from('fraction_bookings').insert({
        holding_id: holding.id,
        property_id: holding.fractions.properties.id,
        start_date: dateStr,
        end_date: dateStr, // Single night for MVP
        type: 'owner_stay',
        status: 'confirmed'
    })

    if (error) {
        alert("Booking failed: " + error.message)
    } else {
        alert("Booking Confirmed!")
        setShowConfirm(false)
        fetchMyData()
    }
  }

  // --- ACTION: TOGGLE PREFERENCE (Rent vs Stay vs Undo) ---
  const handlePreference = async (newPref: 'stay' | 'rent_out', quarter: number) => {
      if (!holding) return
      setProcessingPref(quarter)

      const year = new Date().getFullYear()
      
      // Check if this preference is already set
      const existing = preferences.find(p => p.quarter === quarter)
      
      try {
        if (existing && existing.preference === newPref) {
            // UNDO: If clicking the same button, DELETE the preference
            const { error } = await supabase
                .from('quarterly_preferences')
                .delete()
                .eq('id', existing.id)
            
            if (error) throw error
        } else {
            // SET/UPDATE: Upsert the new preference
            const { error } = await supabase
                .from('quarterly_preferences')
                .upsert({
                    holding_id: holding.id,
                    year: year,
                    quarter: quarter,
                    preference: newPref,
                    locked_at: new Date().toISOString()
                }, { onConflict: 'holding_id, year, quarter' })
            
            if (error) throw error
        }
        
        // Refresh data
        await fetchMyData()

      } catch (error: any) {
          alert("Error updating preference: " + error.message)
      } finally {
          setProcessingPref(null)
      }
  }

  if (loading) return <div className="p-10 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900"></div></div>

  return (
    <div className="p-6 pb-32 max-w-lg mx-auto space-y-8">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
            <h1 className="text-2xl font-black text-slate-900">Book Your Stay</h1>
            <p className="text-xs text-slate-500">{holding?.fractions.properties.title}</p>
        </div>
        <div className="text-right">
             <div className="text-xs font-bold uppercase text-slate-400">Quarter {getQuarter(currentDate)}</div>
             <div className="text-sm font-black text-slate-900">
                {bookings.filter(b => b.holding_id === holding?.id).length} / 28 Nights Used
             </div>
        </div>
      </div>

      {/* --- CALENDAR --- */}
      <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 relative">
        <div className="flex justify-between items-center mb-6">
            <button onClick={prevMonth} className="p-2 hover:bg-slate-100 rounded-full"><ChevronLeft size={20}/></button>
            <span className="font-bold text-lg text-slate-900">
                {currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
            </span>
            <button onClick={nextMonth} className="p-2 hover:bg-slate-100 rounded-full"><ChevronRight size={20}/></button>
        </div>

        <div className="grid grid-cols-7 gap-2 mb-2">
            {['S','M','T','W','T','F','S'].map((d, i) => (
                <div key={i} className="text-center text-[10px] font-bold text-slate-400 uppercase">{d}</div>
            ))}
        </div>

        <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: firstDayOfMonth }).map((_, i) => <div key={`empty-${i}`} />)}
            
            {Array.from({ length: daysInCurrentMonth }).map((_, i) => {
                const day = i + 1
                const status = getDayStatus(day)
                
                // Color Logic
                let bgClass = "bg-slate-50 text-slate-400" // Default
                if (status === 'my_stay') bgClass = "bg-blue-600 text-white shadow-md shadow-blue-200"
                if (status === 'unavailable') bgClass = "bg-red-50 text-red-300 cursor-not-allowed"
                if (status === 'rented') bgClass = "bg-amber-100 text-amber-700 border border-amber-200"
                if (status === 'available') bgClass = "bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white cursor-pointer"

                return (
                    <button 
                        key={day}
                        disabled={status === 'unavailable' || status === 'rented' || status === 'my_stay'}
                        onClick={() => {
                            setSelectedDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), day))
                            setShowConfirm(true)
                        }}
                        className={`aspect-square rounded-xl flex items-center justify-center text-xs font-bold transition-all ${bgClass}`}
                    >
                        {day}
                    </button>
                )
            })}
        </div>

        {/* Legend */}
        <div className="mt-6 flex gap-3 justify-center text-[10px] font-bold text-slate-500">
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-400"/> Free</div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-600"/> My Stay</div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-200"/> Booked</div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-amber-400"/> Rent</div>
        </div>
      </div>

      {/* --- QUARTERLY PREFERENCES --- */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Banknote size={16} className="text-slate-400"/>
                Yield Preferences
            </h3>
            <button onClick={() => fetchMyData()} className="p-1 hover:bg-slate-100 rounded-full"><RefreshCw size={14} className="text-slate-400"/></button>
        </div>
        
        <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex gap-3">
            <Info size={20} className="text-blue-600 shrink-0"/>
            <p className="text-xs text-blue-800 leading-relaxed">
                <b>Hybrid Strategy:</b> Book your specific vacation dates above first. Then, select <b>Rent Out</b> below to release your remaining unbooked nights for yield.
            </p>
        </div>

        {[1, 2, 3, 4].map(q => {
            const pref = preferences.find(p => p.quarter === q)
            const isProcessing = processingPref === q
            const currentQ = getQuarter(new Date())
            const isPast = q < currentQ

            return (
                <div key={q} className={`p-4 rounded-2xl border flex items-center justify-between transition-all ${pref ? 'bg-white border-slate-300 shadow-sm' : 'bg-slate-50 border-dashed border-slate-200'}`}>
                    <div>
                        <p className="text-xs font-bold text-slate-500 uppercase">Quarter {q}</p>
                        <p className="text-sm font-bold text-slate-900">
                            {pref?.preference === 'rent_out' ? '💰 Release & Earn' : (pref?.preference === 'stay' ? '🏠 Keep for Personal Use' : 'Undecided')}
                        </p>
                    </div>

                    {!isPast && (
                        <div className="flex gap-2">
                            {isProcessing ? (
                                <Loader2 className="animate-spin text-slate-400" />
                            ) : (
                                <>
                                    <button 
                                        onClick={() => handlePreference('stay', q)}
                                        className={`p-2 rounded-lg border transition-all ${pref?.preference === 'stay' ? 'bg-slate-900 text-white border-slate-900 ring-2 ring-slate-200' : 'bg-white text-slate-300 border-slate-200 hover:border-slate-400'}`}
                                        title="I want to stay"
                                    >
                                        <Home size={18}/>
                                    </button>
                                    <button 
                                        onClick={() => handlePreference('rent_out', q)}
                                        className={`p-2 rounded-lg border transition-all ${pref?.preference === 'rent_out' ? 'bg-amber-100 text-amber-700 border-amber-300 ring-2 ring-amber-100' : 'bg-white text-slate-300 border-slate-200 hover:border-amber-300 hover:text-amber-300'}`}
                                        title="Release remainder for rent"
                                    >
                                        <Banknote size={18}/>
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                </div>
            )
        })}
      </div>

      {/* --- BOOKING CONFIRM MODAL --- */}
      {showConfirm && selectedDate && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
              <div className="bg-white w-full max-w-sm rounded-3xl p-6 space-y-4 animate-in zoom-in duration-200">
                  <div className="text-center">
                      <h3 className="text-lg font-black text-slate-900">Confirm Booking</h3>
                      <p className="text-sm text-slate-500">
                        {selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                      </p>
                  </div>

                  {/* Validation Message */}
                  {(() => {
                      const check = validateBooking()
                      return (
                          <div className={`p-3 rounded-xl text-xs font-bold flex items-center gap-2 ${check.valid ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                              {check.valid ? <CheckCircle size={16}/> : <AlertCircle size={16}/>}
                              {check.msg}
                          </div>
                      )
                  })()}

                  <div className="flex gap-3 pt-2">
                      <button onClick={() => setShowConfirm(false)} className="flex-1 py-3 font-bold text-slate-500 bg-slate-100 rounded-xl">Cancel</button>
                      <button 
                        onClick={handleBooking}
                        disabled={!validateBooking().valid}
                        className="flex-1 py-3 font-bold text-white bg-slate-900 rounded-xl disabled:opacity-50"
                      >
                          Confirm Stay
                      </button>
                  </div>
              </div>
          </div>
      )}

    </div>
  )
}