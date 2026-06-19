'use client'

import React, { useState, useRef, useEffect } from 'react'
import { X, ZoomIn, ZoomOut, Maximize2, Download, RefreshCcw } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface ImagePreviewModalProps {
    isOpen: boolean
    onClose: () => void
    imageUrl: string
    title?: string
    type?: 'image' | 'video'
}

export default function ImagePreviewModal({ isOpen, onClose, imageUrl, title, type }: ImagePreviewModalProps) {
    const [scale, setScale] = useState(1)
    const [position, setPosition] = useState({ x: 0, y: 0 })
    const [isDragging, setIsDragging] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!isOpen) {
            setScale(1)
            setPosition({ x: 0, y: 0 })
        }
    }, [isOpen])

    const handleZoomIn = () => setScale(prev => Math.min(prev + 0.5, 5))
    const handleZoomOut = () => setScale(prev => Math.max(prev - 0.5, 0.5))
    const handleReset = () => {
        setScale(1)
        setPosition({ x: 0, y: 0 })
    }

    const handleMouseDown = (e: React.MouseEvent) => {
        if (scale > 1) {
            setIsDragging(true)
        }
    }

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDragging && scale > 1) {
            setPosition(prev => ({
                x: prev.x + e.movementX,
                y: prev.y + e.movementY
            }))
        }
    }

    const handleMouseUp = () => setIsDragging(false)

    // Handle Wheel Zoom
    const handleWheel = (e: React.WheelEvent) => {
        if (e.ctrlKey) {
            e.preventDefault()
            const delta = e.deltaY > 0 ? -0.2 : 0.2
            setScale(prev => Math.min(Math.max(prev + delta, 0.5), 5))
        }
    }

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[20000] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 overflow-hidden"
                    onWheel={handleWheel}
                >
                    {/* Header Controls */}
                    <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-10">
                        <div className="bg-white/10 backdrop-blur-md px-4 py-2 rounded-full border border-white/20">
                            <h3 className="text-white text-sm font-bold truncate max-w-[200px] sm:max-w-md">{title || 'Preview'}</h3>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="bg-white/10 backdrop-blur-md p-1 rounded-full border border-white/20 flex items-center gap-1">
                                <button onClick={handleZoomOut} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-all" title="Zoom Out"><ZoomOut size={18} /></button>
                                <div className="text-[10px] font-black text-white/50 w-10 text-center uppercase tabular-nums">{Math.round(scale * 100)}%</div>
                                <button onClick={handleZoomIn} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-all" title="Zoom In"><ZoomIn size={18} /></button>
                                <div className="w-px h-4 bg-white/10 mx-1" />
                                <button onClick={handleReset} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-all" title="Reset"><RefreshCcw size={18} /></button>
                            </div>
                            <button onClick={onClose} className="bg-white/10 backdrop-blur-md p-2.5 rounded-full text-white/70 hover:text-white hover:bg-red-500/20 border border-white/20 transition-all">
                                <X size={20} />
                            </button>
                        </div>
                    </div>

                    {/* Image Container */}
                    <div 
                        ref={containerRef}
                        className={`relative w-full h-full flex items-center justify-center ${scale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                    >
                        <motion.div
                            animate={{ 
                                scale,
                                x: position.x,
                                y: position.y
                            }}
                            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                            className="relative max-w-full max-h-full flex items-center justify-center"
                        >
                            {(type === 'video' || (imageUrl && (
                                /\.(mp4|webm|mov|ogg|m4v|3gp)/i.test(imageUrl.split('?')[0]) ||
                                imageUrl.toLowerCase().includes('.mp4') ||
                                imageUrl.toLowerCase().includes('.webm') ||
                                imageUrl.toLowerCase().includes('.mov') ||
                                imageUrl.toLowerCase().includes('video') ||
                                imageUrl.includes('fbcdn.net/v/')
                            ))) ? (
                                <video 
                                    src={imageUrl} 
                                    controls 
                                    autoPlay
                                    className="max-w-[90vw] max-h-[80vh] object-contain select-none shadow-2xl rounded-lg bg-black"
                                />
                            ) : (
                                <img 
                                    src={imageUrl} 
                                    alt="Preview" 
                                    className="max-w-[90vw] max-h-[80vh] object-contain select-none shadow-2xl rounded-lg"
                                    draggable={false}
                                />
                            )}
                        </motion.div>
                    </div>

                    {/* Footer Tips */}
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 hidden sm:block">
                        <div className="bg-white/5 backdrop-blur-sm px-4 py-2 rounded-full border border-white/10 text-white/40 text-[10px] font-bold uppercase tracking-widest flex items-center gap-4">
                            <span className="flex items-center gap-1.5"><Maximize2 size={12}/> Drag to pan</span>
                            <span className="flex items-center gap-1.5"><ZoomIn size={12}/> Ctrl + Scroll to zoom</span>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
