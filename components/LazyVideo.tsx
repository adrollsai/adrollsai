'use client'

import { useState, useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'

interface LazyVideoProps {
    src: string
    poster?: string
    className?: string
    playsInline?: boolean
    muted?: boolean
    loop?: boolean
    autoPlay?: boolean
}

export default function LazyVideo({
    src,
    poster,
    className = 'w-full h-full object-cover',
    playsInline = true,
    muted = true,
    loop = false,
    autoPlay = false
}: LazyVideoProps) {
    const [isInView, setIsInView] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (typeof window === 'undefined') return
        
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsInView(true)
                    observer.disconnect()
                }
            },
            { rootMargin: '300px' } // Preload when within 300px of viewport
        )

        if (containerRef.current) {
            observer.observe(containerRef.current)
        }

        return () => observer.disconnect()
    }, [src, poster])

    return (
        <div ref={containerRef} className="w-full h-full relative bg-slate-900 flex items-center justify-center">
            {isInView ? (
                <video
                    src={poster ? src : `${src}#t=0.1`}
                    poster={poster}
                    preload={poster ? "none" : "metadata"}
                    playsInline={playsInline}
                    muted={muted}
                    loop={loop}
                    autoPlay={autoPlay}
                    className={className}
                />
            ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
                    <Loader2 className="animate-spin text-slate-700" size={20} />
                </div>
            )}
        </div>
    )
}
