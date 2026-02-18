'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, ChevronLeft, ChevronRight, CheckCircle, AlertCircle, Lock, Loader2 } from 'lucide-react'

export default function AdminBookingCalendar() {
  const supabase = createClient()
  const params = useParams()
  const router = useRouter()
  const propertyId = params.id as string

  const [loading, setLoading] = useState(true)
  const [bookings, setBookings] = useState<any[]>([])
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  
  // Modal State
  const [showConfirm, setShowConfirm] = useState(false)
  const [guestName, setGuestName] = useState('External Booking')
  const [bookingPrice, setBookingPrice] = useState('0')

  // Fetch Bookings
  const fetchBookings = async () => {
    setLoading(true)
    const { data } = await supabase
        .from('fraction_bookings')
        .select('*, customer_holdings(profiles(business_name))')
        .eq('property_id', propertyId)
    
    setBookings(data || [])
    setLoading(false)
  }

  useEffect(() => { fetchBookings() }, [])

  // Calendar Helpers
  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate()
  const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay()
  const daysInCurrentMonth = getDaysInMonth(currentDate.getFullYear(), currentDate.getMonth())

  const getDayStatus = (day: number) => {
    const checkDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day)
    const dateStr = checkDate.toISOString().split('T')[0]
    
    const booking = bookings.find(b => dateStr >= b.start_date && dateStr <= b.end_date)

    if (booking) {
        if (booking.type === 'guest_booking') return 'blocked' // Gold
        if (booking.type === 'owner_stay') return 'owner' // Blue
        return 'unavailable'
    }
    return 'available'
  }

  // Action: Create Blocked Booking
  const handleBlockDate = async () => {
      if (!selectedDate) return

      const dateStr = selectedDate.toISOString().split('T')[0]
      
      // We need a dummy holding ID to satisfy the FK constraint. 
      // Ideally, you'd have an 'Admin/System' holding, but for now we pick the first one 
      // OR we update the table to make holding_id nullable (Better).
      // For this quick fix, we'll fetch ANY holding for this property to link it.
      
      const { data: holding } = await supabase.from('customer_holdings').select('id').eq('fraction_id', (await supabase.from('fractions').select('id').eq('property_id', propertyId).limit(1).single()).data?.id).limit(1).single()
      
      if (!holding) {
          alert("Error: No fractions created yet. Create fractions first.")
          return
      }

      const { error } = await supabase.from('fraction_bookings').insert({
          property_id: propertyId,
          holding_id: holding.id, // Linked technically, but type is 'guest_booking'
          start_date: dateStr,
          end_date: dateStr,
          type: 'guest_booking', // THIS IS KEY: It marks it as external
          status: 'confirmed',
          notes: guestName,
          guest_tariff_total: parseFloat(bookingPrice)
      })

      if (error) alert("Failed: " + error.message)
      else {
          alert("Date Blocked Successfully")
          setShowConfirm(false)
          fetchBookings()
      }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => router.back()} className="p-2 hover:bg-slate-100 rounded-full">
            <ArrowLeft size={20}/>
        </button>
        <div>
            <h1 className="text-2xl font-black text-slate-900">Manage Availability</h1>
            <p className="text-sm text-slate-500">Block dates for external guests (Airbnb/Booking.com)</p>
        </div>
      </div>

      <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
        <div className="flex justify-between items-center mb-6">
            <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))} className="p-2 hover:bg-slate-100 rounded-full"><ChevronLeft/></button>
            <span className="font-bold text-xl">{currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</span>
            <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))} className="p-2 hover:bg-slate-100 rounded-full"><ChevronRight/></button>
        </div>

        <div className="grid grid-cols-7 gap-2">
            {['S','M','T','W','T','F','S'].map((d,i) => <div key={i} className="text-center text-xs font-bold text-slate-400 py-2">{d}</div>)}
            {Array.from({ length: firstDayOfMonth }).map((_, i) => <div key={`empty-${i}`} />)}
            {Array.from({ length: daysInCurrentMonth }).map((_, i) => {
                const day = i + 1
                const status = getDayStatus(day)
                let bg = "bg-slate-50 hover:bg-slate-100 cursor-pointer text-slate-500"
                
                if (status === 'blocked') bg = "bg-amber-100 text-amber-700 border border-amber-300 cursor-not-allowed"
                if (status === 'owner') bg = "bg-blue-100 text-blue-700 border border-blue-300 cursor-not-allowed"

                return (
                    <div 
                        key={day} 
                        onClick={() => {
                            if (status === 'available') {
                                setSelectedDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), day))
                                setShowConfirm(true)
                            }
                        }}
                        className={`h-14 rounded-xl flex items-center justify-center font-bold text-sm transition-all ${bg}`}
                    >
                        {day}
                    </div>
                )
            })}
        </div>
        
        <div className="mt-6 flex gap-4 justify-center text-xs font-bold text-slate-500">
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-slate-200"/> Available</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-amber-400"/> Guest Booking (Blocked)</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-blue-500"/> Owner Stay</div>
        </div>
      </div>

      {/* Block Modal */}
      {showConfirm && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white w-full max-w-sm rounded-2xl p-6 space-y-4">
                  <h3 className="text-lg font-bold">Block Date</h3>
                  <p className="text-sm text-slate-500">Locking {selectedDate?.toDateString()} for external booking.</p>
                  
                  <div className="space-y-2">
                      <label className="text-xs font-bold uppercase text-slate-500">Guest Name / Platform</label>
                      <input className="w-full p-2 border rounded-lg" value={guestName} onChange={e => setGuestName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                      <label className="text-xs font-bold uppercase text-slate-500">Revenue (Optional)</label>
                      <input className="w-full p-2 border rounded-lg" type="number" value={bookingPrice} onChange={e => setBookingPrice(e.target.value)} />
                  </div>

                  <button onClick={handleBlockDate} className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-2">
                      <Lock size={16}/> Confirm Block
                  </button>
                  <button onClick={() => setShowConfirm(false)} className="w-full py-3 text-slate-500 font-bold">Cancel</button>
              </div>
          </div>
      )}
    </div>
  )
}