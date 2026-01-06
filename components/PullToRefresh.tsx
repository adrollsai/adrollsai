'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function PullToRefresh({ children }: { children: React.ReactNode }) {
  const [pullChange, setPullChange] = useState(0)
  const [loading, setLoading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  
  // Use Refs for synchronous tracking during gestures to avoid render lag
  const startPointRef = useRef(0)
  const pullChangeRef = useRef(0)
  
  const router = useRouter()

  useEffect(() => {
    // Prevent default browser refresh to allow our custom implementation
    document.body.style.overscrollBehavior = 'contain'
    return () => {
      document.body.style.overscrollBehavior = 'auto'
    }
  }, [])

  const pullStart = (e: React.TouchEvent) => {
    const { screenY } = e.targetTouches[0]
    startPointRef.current = screenY
    setIsDragging(true) // Disable transition for 1:1 movement
  }

  const pull = (e: React.TouchEvent) => {
    const touch = e.targetTouches[0]
    const { screenY } = touch
    
    // SEAMLESS LOGIC:
    // If the user isn't at the top yet, keep resetting the start point.
    // This prevents the page from "jumping" if they scroll up and immediately pull.
    if (window.scrollY > 0) {
        startPointRef.current = screenY
        return
    }

    // We are at the top (or overscrolled)
    const pullLength = screenY - startPointRef.current
    
    // Only allow pulling down, and stop if already loading
    if (pullLength > 0 && !loading) {
      // Apply resistance (dampening) to make it feel physical
      const val = pullLength * 0.45 
      
      setPullChange(val)
      pullChangeRef.current = val
    } else {
        // If pushing up (negative) while at top, keep it at 0
        setPullChange(0)
        pullChangeRef.current = 0
    }
  }

  const endPull = () => {
    setIsDragging(false) // Re-enable transition for smooth snap back
    
    if (pullChangeRef.current > 70) { // Threshold to trigger refresh
      setLoading(true)
      setPullChange(80) // Snap to a visible loading height
      
      // Perform Refresh
      setTimeout(() => {
        window.location.reload()
      }, 800)
    } else {
      setPullChange(0)
    }
    
    // Reset refs
    startPointRef.current = 0
    pullChangeRef.current = 0
  }

  return (
    <div 
      className="min-h-screen w-full relative"
      onTouchStart={pullStart}
      onTouchMove={pull}
      onTouchEnd={endPull}
      style={{ 
        // CRITICAL: Use 'none' when 0. This allows fixed children (like TopBar) 
        // to attach to the viewport normally. When > 0, they attach to this div.
        transform: pullChange > 0 ? `translateY(${pullChange}px)` : 'none',
        
        // CRITICAL: Remove transition during drag for instant response, add it for snap back
        transition: isDragging ? 'none' : 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)' 
      }}
    >
      {/* Loading Indicator - Positioned nicely above the content */}
      <div 
        className="absolute w-full flex justify-center items-center h-[80px]"
        style={{ 
            top: '-80px', 
            left: 0,
            opacity: pullChange > 0 ? 1 : 0 
        }}
      >
        <div className="bg-white/90 backdrop-blur-md p-2.5 rounded-full shadow-lg border border-slate-200/50">
           <Loader2 className={`text-slate-900 ${loading ? 'animate-spin' : ''}`} size={22} />
        </div>
      </div>

      {children}
    </div>
  )
}