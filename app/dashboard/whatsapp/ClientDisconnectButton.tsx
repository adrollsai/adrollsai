'use client'

import { useState } from 'react'
import { disconnectWhatsApp } from './actions'

export default function ClientDisconnectButton() {
  const [loading, setLoading] = useState(false)

  const handleDisconnect = async () => {
    if (!confirm("Are you sure you want to disconnect? This will stop all automated messages.")) return;

    setLoading(true)
    await disconnectWhatsApp() // This calls the server action
    setLoading(false)
    // The page will automatically refresh due to revalidatePath in the action
  }

  return (
    <button 
      onClick={handleDisconnect}
      disabled={loading}
      className="px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm hover:bg-red-100 transition-colors disabled:opacity-50"
    >
      {loading ? 'Disconnecting...' : 'Disconnect Account'}
    </button>
  )
}