'use client'

import { useState } from 'react'
import { BellRing, Loader2 } from 'lucide-react'

export default function TestNotificationBtn() {
  const [isTesting, setIsTesting] = useState(false)

  const handleTest = async () => {
    setIsTesting(true)
    try {
      const res = await fetch('/api/test-notification', { method: 'POST' })
      if (res.ok) {
        alert("Test triggered! Quickly close the app or lock your phone. The notification will arrive in 5 seconds.")
      } else {
        alert("Failed to trigger test.")
      }
    } catch (error) {
      console.error(error)
      alert("Network error.")
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <button
      onClick={handleTest}
      disabled={isTesting}
      className="flex items-center gap-1.5 bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-blue-100 active:scale-95 transition-all disabled:opacity-50"
    >
      {isTesting ? <Loader2 size={14} className="animate-spin" /> : <BellRing size={14} />}
      Test Push (5s)
    </button>
  )
}