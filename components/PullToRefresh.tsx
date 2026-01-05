'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function PullToRefresh({ children }: { children: React.ReactNode }) {
  const [startPoint, setStartPoint] = useState(0)
  const [pullChange, setPullChange] = useState(0)
  const [loading, setLoading] = useState(false)
  const refreshThreshold = 150
  const router = useRouter()

  useEffect(() => {
    // Prevent default pull-to-refresh on mobile specifically to use ours
    // functionality might vary by browser version
    document.body.style.overscrollBehavior = 'contain'
    return () => {
      document.body.style.overscrollBehavior = 'auto'
    }
  }, [])

  const pullStart = (e: React.TouchEvent) => {
    const { screenY } = e.targetTouches[0]
    setStartPoint(screenY)
  }

  const pull = (e: React.TouchEvent) => {
    const touch = e.targetTouches[0]
    const { screenY } = touch
    
    // Only enable pull if we are at the top of the page
    if (window.scrollY === 0 && !loading) {
      const pullLength = screenY - startPoint
      if (pullLength > 0) {
        // Resistance effect
        setPullChange(pullLength * 0.4) 
      }
    }
  }

  const endPull = () => {
    if (pullChange > 60) { // Trigger threshold
      setLoading(true)
      setPullChange(80) // Snap to loading position
      
      // Perform Refresh
      setTimeout(() => {
        window.location.reload()
      }, 1000)
    } else {
      setPullChange(0)
    }
  }

  return (
    <div 
      className="min-h-screen transition-transform duration-200 ease-out"
      onTouchStart={pullStart}
      onTouchMove={pull}
      onTouchEnd={endPull}
      style={{ 
        transform: `translateY(${pullChange}px)` 
      }}
    >
      {/* Loading Indicator Spinner */}
      <div 
        className="absolute top-[-60px] left-0 w-full flex justify-center items-center h-[60px]"
        style={{ opacity: pullChange > 0 ? 1 : 0 }}
      >
        <div className="bg-white p-2 rounded-full shadow-md border border-slate-100">
           <Loader2 className={`text-blue-600 ${loading ? 'animate-spin' : ''}`} size={20} />
        </div>
      </div>

      {children}
    </div>
  )
}