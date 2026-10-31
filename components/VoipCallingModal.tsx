'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX, Grid, Loader2, Sparkles, CheckCircle2, AlertCircle, X, ShieldCheck, Minus, Maximize2, Minimize2, GripHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { formatCallPhone } from '@/utils/dialer'

interface VoipCallingModalProps {
    isOpen: boolean
    onClose: () => void
    recipientPhone: string
    recipientName?: string
    leadId?: string
    profileId?: string
    onCallFinished?: () => void
}

type CallState = 'requesting_mic' | 'connecting' | 'dialing' | 'ringing' | 'in_call' | 'analyzing' | 'completed' | 'error'

export default function VoipCallingModal({
    isOpen,
    onClose,
    recipientPhone,
    recipientName,
    leadId,
    profileId,
    onCallFinished
}: VoipCallingModalProps) {
    const [callState, setCallState] = useState<CallState>('requesting_mic')
    const [statusMessage, setStatusMessage] = useState('Initializing VoIP session...')
    const [durationSeconds, setDurationSeconds] = useState(0)
    const [isMuted, setIsMuted] = useState(false)
    const [isSpeakerMuted, setIsSpeakerMuted] = useState(false)
    const [showKeypad, setShowKeypad] = useState(false)
    const [isMinimized, setIsMinimized] = useState(false)
    const [callUuid, setCallUuid] = useState<string | null>(null)
    const [sessionId, setSessionId] = useState<string>('')
    const [activeCallerDid, setActiveCallerDid] = useState<string>('+91 79 6548 0905')
    const [micLevel, setMicLevel] = useState<number>(0)
    const [remoteLevel, setRemoteLevel] = useState<number>(0)
    const [analysisResult, setAnalysisResult] = useState<{ summary?: string; transcript?: any[]; recordingUrl?: string } | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    // Dragging position state
    const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const [isDragging, setIsDragging] = useState(false)
    const dragStartRef = useRef<{ mouseX: number; mouseY: number; initialX: number; initialY: number }>({ mouseX: 0, mouseY: 0, initialX: 0, initialY: 0 })
    const widgetRef = useRef<HTMLDivElement | null>(null)

    // Audio & WebSocket refs
    const wsRef = useRef<WebSocket | null>(null)
    const audioContextRef = useRef<AudioContext | null>(null)
    const mediaStreamRef = useRef<MediaStream | null>(null)
    const processorRef = useRef<ScriptProcessorNode | null>(null)
    const nextPlayTimeRef = useRef<number>(0)
    const timerIntervalRef = useRef<NodeJS.Timeout | null>(null)
    const isMutedRef = useRef(false)
    const isSpeakerMutedRef = useRef(false)

    isMutedRef.current = isMuted
    isSpeakerMutedRef.current = isSpeakerMuted

    const cleanRecipient = formatCallPhone(recipientPhone)
    const displayRecipient = cleanRecipient ? cleanRecipient.replace('+91', '+91 ') : recipientPhone

    // Set initial position in bottom-right corner when opened
    useEffect(() => {
        if (!isOpen) return
        if (typeof window !== 'undefined') {
            const isMobile = window.innerWidth < 640
            if (isMobile) {
                // Centered at bottom on mobile
                const initialX = Math.max(10, Math.round((window.innerWidth - 360) / 2))
                const initialY = Math.max(20, window.innerHeight - 520)
                setPosition({ x: initialX, y: initialY })
            } else {
                // Bottom-right corner dock
                const initialX = Math.max(20, window.innerWidth - 410)
                const initialY = Math.max(20, window.innerHeight - 560)
                setPosition({ x: initialX, y: initialY })
            }
        }
    }, [isOpen])

    // Drag handlers
    const handleStartDrag = (clientX: number, clientY: number) => {
        setIsDragging(true)
        dragStartRef.current = {
            mouseX: clientX,
            mouseY: clientY,
            initialX: position.x,
            initialY: position.y
        }
    }

    const handleMouseDown = (e: React.MouseEvent) => {
        // Prevent drag when clicking buttons, inputs, or sliders
        if ((e.target as HTMLElement).closest('button, input, a, select')) return
        handleStartDrag(e.clientX, e.clientY)
    }

    const handleTouchStart = (e: React.TouchEvent) => {
        if ((e.target as HTMLElement).closest('button, input, a, select')) return
        if (e.touches.length > 0) {
            handleStartDrag(e.touches[0].clientX, e.touches[0].clientY)
        }
    }

    useEffect(() => {
        if (!isDragging) return

        const handleMouseMove = (e: MouseEvent) => {
            const deltaX = e.clientX - dragStartRef.current.mouseX
            const deltaY = e.clientY - dragStartRef.current.mouseY
            const maxX = Math.max(0, window.innerWidth - 340)
            const maxY = Math.max(0, window.innerHeight - 100)

            setPosition({
                x: Math.min(maxX, Math.max(10, dragStartRef.current.initialX + deltaX)),
                y: Math.min(maxY, Math.max(10, dragStartRef.current.initialY + deltaY))
            })
        }

        const handleTouchMove = (e: TouchEvent) => {
            if (e.touches.length === 0) return
            const touch = e.touches[0]
            const deltaX = touch.clientX - dragStartRef.current.mouseX
            const deltaY = touch.clientY - dragStartRef.current.mouseY
            const maxX = Math.max(0, window.innerWidth - 340)
            const maxY = Math.max(0, window.innerHeight - 100)

            setPosition({
                x: Math.min(maxX, Math.max(10, dragStartRef.current.initialX + deltaX)),
                y: Math.min(maxY, Math.max(10, dragStartRef.current.initialY + deltaY))
            })
        }

        const handleEndDrag = () => {
            setIsDragging(false)
        }

        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleEndDrag)
        window.addEventListener('touchmove', handleTouchMove)
        window.addEventListener('touchend', handleEndDrag)

        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleEndDrag)
            window.removeEventListener('touchmove', handleTouchMove)
            window.removeEventListener('touchend', handleEndDrag)
        }
    }, [isDragging])

    // Format duration mm:ss
    const formatDuration = (totalSec: number) => {
        const mins = Math.floor(totalSec / 60)
        const secs = totalSec % 60
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    }

    // Cleanup all media & connections safely
    const cleanupMedia = useCallback(() => {
        if (timerIntervalRef.current) {
            clearInterval(timerIntervalRef.current)
            timerIntervalRef.current = null
        }

        if (processorRef.current) {
            try {
                processorRef.current.disconnect()
            } catch (e) {}
            processorRef.current = null
        }

        if (mediaStreamRef.current) {
            try {
                mediaStreamRef.current.getTracks().forEach(track => track.stop())
            } catch (e) {}
            mediaStreamRef.current = null
        }

        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            try {
                audioContextRef.current.close()
            } catch (e) {}
            audioContextRef.current = null
        }

        if (wsRef.current) {
            try {
                if (wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.close()
                }
            } catch (e) {}
            wsRef.current = null
        }
    }, [])

    // Hangup trigger - does not block user from browsing the CRM
    const handleHangup = useCallback(async () => {
        if (callState === 'analyzing' || callState === 'completed') {
            onClose()
            return
        }

        setCallState('analyzing')
        setStatusMessage('Call ended. AI is analyzing conversation in background...')
        toast.info('🎙️ Call ended. AI summary & transcription processing in background...')

        // Notify bridge of hangup
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            try {
                wsRef.current.send(JSON.stringify({ event: 'hangup' }))
            } catch (e) {}
        }

        // Notify backend to terminate Vobiz call
        if (callUuid) {
            fetch('/api/voice/vobiz/agent-call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'hangup', callUuid })
            }).catch(() => {})
        }

        // Stop local microphone recording
        if (processorRef.current) {
            try { processorRef.current.disconnect() } catch (e) {}
        }
        if (mediaStreamRef.current) {
            try { mediaStreamRef.current.getTracks().forEach(t => t.stop()) } catch (e) {}
        }

        // Automatically close/dismiss widget after 2 seconds if user doesn't dismiss manually, letting analysis finish in bg
        const autoDismissTimer = setTimeout(() => {
            setCallState('completed')
            if (onCallFinished) onCallFinished()
        }, 3000)

        return () => clearTimeout(autoDismissTimer)
    }, [callState, callUuid, onClose, onCallFinished])

    // Keypad DTMF tone simulator & transmitter
    const handleKeypadPress = (digit: string) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ event: 'dtmf', digit }))
        }
        toast.info(`Sent DTMF tone: ${digit}`)
    }

    // Main setup lifecycle when modal opens
    useEffect(() => {
        if (!isOpen) {
            cleanupMedia()
            setCallState('requesting_mic')
            setDurationSeconds(0)
            setAnalysisResult(null)
            setErrorMessage(null)
            setIsMinimized(false)
            return
        }

        let isCancelled = false
        const generatedSessionId = `agent_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
        setSessionId(generatedSessionId)
        setCallState('requesting_mic')
        setStatusMessage('Requesting microphone permission...')

        async function startCallSession() {
            try {
                // 1. Request microphone access
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                        channelCount: 1,
                        sampleRate: 16000
                    }
                })

                if (isCancelled) {
                    stream.getTracks().forEach(t => t.stop())
                    return
                }

                mediaStreamRef.current = stream

                // 2. Initialize AudioContext at 16kHz
                const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
                const audioCtx = new AudioCtx({ sampleRate: 16000 })
                audioContextRef.current = audioCtx
                nextPlayTimeRef.current = audioCtx.currentTime + 0.1

                if (audioCtx.state === 'suspended') {
                    await audioCtx.resume()
                }

                // 3. Connect to Cloud Run Voice Bridge WebSocket
                setCallState('connecting')
                setStatusMessage('Connecting to VoIP Audio Bridge...')

                const bridgeWsHost = process.env.NEXT_PUBLIC_VOICE_BRIDGE_URL || 'wss://gemini-voice-bridge-805895515412.us-central1.run.app'
                const wsUrl = `${bridgeWsHost}/agent-bridge?sessionId=${encodeURIComponent(generatedSessionId)}&role=agent&leadId=${encodeURIComponent(leadId || '')}&profileId=${encodeURIComponent(profileId || '')}`
                
                const ws = new WebSocket(wsUrl)
                wsRef.current = ws

                ws.onopen = async () => {
                    if (isCancelled) return
                    console.log(`[VOIP MODAL] Connected to Agent Bridge: ${generatedSessionId}`)
                    setCallState('dialing')
                    setStatusMessage(`Dialing ${displayRecipient} via VoIP softphone...`)

                    // 4. Trigger PSTN Call through Vobiz API
                    try {
                        const res = await fetch('/api/voice/vobiz/agent-call', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                action: 'dial',
                                toPhone: recipientPhone,
                                leadId: leadId || undefined,
                                sessionId: generatedSessionId
                            })
                        })
                        const data = await res.json()
                        if (!res.ok || !data.success) {
                            throw new Error(data.error || 'Failed to dial phone number')
                        }
                        if (data.callUuid) {
                            setCallUuid(data.callUuid)
                        }
                        if (data.callerDid) {
                            setActiveCallerDid(data.callerDid)
                        }
                        setCallState('ringing')
                        setStatusMessage(`Ringing client phone...`)
                    } catch (dialErr: any) {
                        setCallState('error')
                        setErrorMessage(dialErr.message || 'Call initiation failed')
                    }
                }

                ws.onmessage = (event) => {
                    if (isCancelled) return
                    try {
                        const data = JSON.parse(event.data)

                        if (data.event === 'call_connected') {
                            setCallState('in_call')
                            setStatusMessage('Connected • Call in Progress')
                            if (data.callId) setCallUuid(data.callId)

                            // Start Duration Timer
                            setDurationSeconds(0)
                            if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
                            timerIntervalRef.current = setInterval(() => {
                                setDurationSeconds(prev => prev + 1)
                            }, 1000)

                        } else if (data.event === 'remote_audio' && data.audio) {
                            if (isSpeakerMutedRef.current || !audioContextRef.current) return

                            // Decode Base64 16kHz PCM to Float32 & Play
                            const binaryStr = atob(data.audio)
                            const bytes = new Uint8Array(binaryStr.length)
                            for (let i = 0; i < binaryStr.length; i++) {
                                bytes[i] = binaryStr.charCodeAt(i)
                            }
                            const sampleCount = Math.floor(bytes.byteLength / 2)
                            const int16View = new Int16Array(bytes.buffer, bytes.byteOffset, sampleCount)
                            const float32Data = new Float32Array(sampleCount)
                            let sumSq = 0
                            for (let i = 0; i < sampleCount; i++) {
                                const sample = int16View[i] / 32768.0
                                float32Data[i] = sample
                                sumSq += sample * sample
                            }
                            const rms = Math.sqrt(sumSq / float32Data.length)
                            setRemoteLevel(Math.min(100, Math.round(rms * 400)))

                            // Schedule seamless audio buffer playout
                            const actx = audioContextRef.current
                            if (actx && actx.state !== 'closed') {
                                const audioBuffer = actx.createBuffer(1, float32Data.length, 16000)
                                audioBuffer.copyToChannel(float32Data, 0)

                                const source = actx.createBufferSource()
                                source.buffer = audioBuffer
                                source.connect(actx.destination)

                                const startTime = Math.max(actx.currentTime, nextPlayTimeRef.current)
                                source.start(startTime)
                                nextPlayTimeRef.current = startTime + audioBuffer.duration
                            }

                        } else if (data.event === 'call_ended') {
                            setCallState('analyzing')
                            setStatusMessage('Call ended. AI is analyzing conversation in background...')
                            toast.info('🎙️ Call ended. AI analysis running in background...')
                            if (timerIntervalRef.current) {
                                clearInterval(timerIntervalRef.current)
                                timerIntervalRef.current = null
                            }

                        } else if (data.event === 'analysis_completed') {
                            setCallState('completed')
                            setStatusMessage('AI Analysis complete! Attached to lead history.')
                            toast.success('🎙️ AI Analysis Complete: Transcript & summary attached to lead!')
                            setAnalysisResult({
                                summary: data.summary,
                                transcript: data.transcript,
                                recordingUrl: data.recordingUrl
                            })
                            if (onCallFinished) onCallFinished()
                        }
                    } catch (e) {
                        console.warn('[VOIP MODAL] WebSocket message error:', e)
                    }
                }

                ws.onerror = (e) => {
                    console.error('[VOIP MODAL] WebSocket error:', e)
                    if (callState !== 'completed' && callState !== 'in_call') {
                        setCallState('error')
                        setErrorMessage('VoIP bridge connection failed. Please check network.')
                    }
                }

                ws.onclose = () => {
                    console.log('[VOIP MODAL] WebSocket closed')
                }

                // 5. Setup Local Microphone Capture & Streaming
                const micSource = audioCtx.createMediaStreamSource(stream)
                const processor = audioCtx.createScriptProcessor(2048, 1, 1)
                processorRef.current = processor

                processor.onaudioprocess = (e) => {
                    if (isCancelled) return
                    const input = e.inputBuffer.getChannelData(0)
                    // Zero out output buffer so agent's mic is not echoed back into their speakers/headphones
                    const output = e.outputBuffer.getChannelData(0)
                    output.fill(0)

                    // Calculate RMS volume level for UI visualizer
                    let sumSq = 0
                    const pcm16 = new Int16Array(input.length)
                    for (let i = 0; i < input.length; i++) {
                        const s = Math.max(-1, Math.min(1, input[i]))
                        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
                        sumSq += s * s
                    }
                    const rms = Math.sqrt(sumSq / input.length)
                    setMicLevel(isMutedRef.current ? 0 : Math.min(100, Math.round(rms * 450)))

                    // Stream to bridge if call active and not muted
                    if (!isMutedRef.current && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                        const bytes = new Uint8Array(pcm16.buffer)
                        let binary = ''
                        for (let i = 0; i < bytes.byteLength; i++) {
                            binary += String.fromCharCode(bytes[i])
                        }
                        const base64Audio = btoa(binary)
                        wsRef.current.send(JSON.stringify({
                            event: 'agent_audio',
                            audio: base64Audio
                        }))
                    }
                }

                micSource.connect(processor)
                processor.connect(audioCtx.destination)

            } catch (err: any) {
                if (isCancelled) return
                console.error('[VOIP MODAL] Setup failed:', err)
                setCallState('error')
                if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                    setErrorMessage('Microphone permission was denied. Please allow microphone access in your browser settings to talk.')
                } else {
                    setErrorMessage(err.message || 'Failed to initialize audio device.')
                }
            }
        }

        startCallSession()

        return () => {
            isCancelled = true
            cleanupMedia()
        }
    }, [isOpen, recipientPhone, leadId, profileId, cleanupMedia, displayRecipient])

    if (!isOpen) return null

    // ==========================================
    // 1. MINIMIZED FLOATING PILL DOCK VIEW
    // ==========================================
    if (isMinimized) {
        return (
            <div 
                className="fixed inset-0 z-[200] pointer-events-none select-none"
            >
                <div 
                    ref={widgetRef}
                    style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
                    onMouseDown={handleMouseDown}
                    onTouchStart={handleTouchStart}
                    className="absolute bg-slate-900/95 hover:bg-slate-900 border border-slate-700/80 rounded-full px-4 py-2.5 shadow-2xl backdrop-blur-md flex items-center gap-3 text-white pointer-events-auto cursor-grab active:cursor-grabbing transition-shadow ring-1 ring-white/10"
                >
                    {/* Pulsing indicator */}
                    <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${callState === 'in_call' ? 'bg-emerald-400 animate-ping' : 'bg-indigo-400 animate-pulse'}`} />
                        <div className="flex flex-col text-left">
                            <span className="text-xs font-black truncate max-w-[110px] text-slate-100">
                                {recipientName || 'Client'}
                            </span>
                            <span className="text-[10px] font-mono font-bold text-emerald-400">
                                {callState === 'in_call' ? formatDuration(durationSeconds) : statusMessage.split('•')[0].slice(0, 15)}
                            </span>
                        </div>
                    </div>

                    <div className="h-5 w-[1px] bg-slate-700/80 mx-0.5" />

                    {/* Quick Mute Toggle */}
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setIsMuted(!isMuted) }}
                        className={`p-2 rounded-full transition-colors cursor-pointer ${isMuted ? 'bg-rose-500/20 text-rose-400' : 'hover:bg-slate-800 text-slate-300'}`}
                        title={isMuted ? 'Unmute Mic' : 'Mute Mic'}
                    >
                        {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
                    </button>

                    {/* Quick Hangup */}
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleHangup() }}
                        className="p-2 bg-rose-600 hover:bg-rose-500 text-white rounded-full transition-all shadow-md active:scale-95 cursor-pointer"
                        title="End Call"
                    >
                        <PhoneOff size={14} />
                    </button>

                    {/* Maximize to full dialer */}
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setIsMinimized(false) }}
                        className="p-2 hover:bg-slate-800 text-slate-400 hover:text-white rounded-full transition-colors cursor-pointer"
                        title="Expand Softphone"
                    >
                        <Maximize2 size={14} />
                    </button>
                </div>
            </div>
        )
    }

    // ==========================================
    // 2. EXPANDED DRAGGABLE SOFTPHONE CARD VIEW
    // ==========================================
    return (
        <div className="fixed inset-0 z-[200] pointer-events-none select-none">
            <div 
                ref={widgetRef}
                style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
                className="absolute bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 border border-slate-700/80 rounded-3xl w-[350px] overflow-hidden shadow-2xl shadow-slate-950/80 flex flex-col relative text-white pointer-events-auto select-auto animate-in zoom-in-95 duration-150 ring-1 ring-white/10"
            >
                {/* Top Ambient Call Status Accent */}
                <div className={`absolute top-0 left-0 right-0 h-1.5 transition-all duration-500 ${
                    callState === 'in_call' ? 'bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500 animate-pulse' :
                    callState === 'ringing' || callState === 'dialing' ? 'bg-gradient-to-r from-amber-500 via-indigo-500 to-blue-500 animate-pulse' :
                    callState === 'analyzing' ? 'bg-gradient-to-r from-purple-500 via-indigo-500 to-pink-500 animate-pulse' :
                    callState === 'completed' ? 'bg-emerald-500' :
                    callState === 'error' ? 'bg-rose-500' : 'bg-slate-700'
                }`} />

                {/* Draggable Header Handle */}
                <div 
                    onMouseDown={handleMouseDown}
                    onTouchStart={handleTouchStart}
                    className="p-3.5 pb-2.5 flex items-center justify-between border-b border-slate-800/60 cursor-grab active:cursor-grabbing bg-slate-900/60 hover:bg-slate-800/40 transition-colors select-none"
                    title="Drag to reposition window"
                >
                    <div className="flex items-center gap-2">
                        <GripHorizontal size={15} className="text-slate-500 shrink-0" />
                        <div className="p-1 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-lg">
                            <ShieldCheck size={13} />
                        </div>
                        <div>
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block leading-tight">VoIP Line</span>
                            <span className="text-[11px] font-mono font-bold text-slate-200">{activeCallerDid}</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-1">
                        {/* Minimize Button */}
                        <button 
                            type="button"
                            onClick={() => setIsMinimized(true)}
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                            title="Minimize to floating pill (lets you browse CRM freely)"
                        >
                            <Minus size={15} />
                        </button>

                        {/* Close / Hangup Button */}
                        <button 
                            type="button"
                            onClick={handleHangup}
                            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                            title="End / Close Call"
                        >
                            <X size={15} />
                        </button>
                    </div>
                </div>

                {/* Central Body: Avatar, Name, Status, Waveform */}
                <div className="p-5 flex flex-col items-center text-center space-y-3.5">
                    
                    {/* Glowing Avatar */}
                    <div className="relative my-1">
                        {/* Dynamic outer pulse ring based on mic or remote volume */}
                        <div 
                            className="absolute -inset-2.5 rounded-full transition-all duration-150 opacity-40 blur-md pointer-events-none"
                            style={{
                                backgroundColor: callState === 'in_call' ? '#10B981' : '#6366F1',
                                transform: `scale(${1 + (Math.max(micLevel, remoteLevel) / 100) * 0.4})`
                            }}
                        />
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center font-black text-xl shadow-xl relative z-10 transition-all ${
                            callState === 'in_call' ? 'bg-gradient-to-br from-emerald-500 to-teal-700 text-white shadow-emerald-500/30' :
                            callState === 'ringing' || callState === 'dialing' ? 'bg-gradient-to-br from-indigo-500 to-blue-700 text-white shadow-indigo-500/30 animate-pulse' :
                            callState === 'completed' ? 'bg-emerald-600 text-white' :
                            callState === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-300'
                        }`}>
                            {callState === 'in_call' ? (
                                <Phone size={26} className="animate-pulse" />
                            ) : callState === 'completed' ? (
                                <CheckCircle2 size={30} />
                            ) : callState === 'error' ? (
                                <AlertCircle size={30} />
                            ) : (
                                <span>{(recipientName || recipientPhone || 'C').charAt(0).toUpperCase()}</span>
                            )}
                        </div>
                    </div>

                    {/* Recipient Details */}
                    <div>
                        <h3 className="text-base font-black text-white tracking-tight">
                            {recipientName || 'Prospective Client'}
                        </h3>
                        <p className="text-xs font-mono font-medium text-slate-400 mt-0.5">
                            {displayRecipient}
                        </p>
                    </div>

                    {/* Call Status Badge & Duration */}
                    <div className="space-y-1 w-full">
                        {callState === 'in_call' ? (
                            <div className="flex flex-col items-center">
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-full text-xs font-mono font-bold tracking-wider">
                                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                                    {formatDuration(durationSeconds)}
                                </span>
                                <span className="text-[11px] text-slate-400 mt-1 font-medium">In-Browser VoIP Call</span>
                            </div>
                        ) : callState === 'analyzing' ? (
                            <div className="flex flex-col items-center gap-1.5 p-2 bg-purple-500/10 border border-purple-500/30 rounded-2xl">
                                <div className="inline-flex items-center gap-1.5 text-purple-300 text-xs font-bold animate-pulse">
                                    <Sparkles size={13} className="text-amber-300 animate-spin" />
                                    <span>AI Analysis Running in Background...</span>
                                </div>
                                <p className="text-[10px] text-slate-400 font-medium">
                                    You can close this window now — the transcript and summary will be saved to the lead record.
                                </p>
                            </div>
                        ) : callState === 'completed' ? (
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/20 text-emerald-300 rounded-full text-xs font-bold">
                                <CheckCircle2 size={13} />
                                <span>Call Logged & Saved</span>
                            </div>
                        ) : callState === 'error' ? (
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-500/20 text-rose-300 rounded-full text-xs font-bold">
                                <AlertCircle size={13} />
                                <span>Call Failed</span>
                            </div>
                        ) : (
                            <div className="inline-flex items-center gap-1.5 text-xs text-indigo-300 font-medium">
                                <Loader2 size={12} className="animate-spin text-indigo-400" />
                                <span>{statusMessage}</span>
                            </div>
                        )}

                        {errorMessage && (
                            <p className="text-[11px] text-rose-400 font-medium max-w-[280px] mx-auto pt-1">
                                {errorMessage}
                            </p>
                        )}
                    </div>

                    {/* Audio Level Visualizer Waveform */}
                    {callState === 'in_call' && (
                        <div className="flex items-center justify-center gap-1.5 h-6 pt-1">
                            {[0.2, 0.5, 0.9, 0.6, 1.0, 0.7, 0.4, 0.8, 0.3].map((multiplier, idx) => {
                                const level = isMuted ? 0 : Math.max(micLevel, remoteLevel) * multiplier
                                const height = Math.max(4, Math.min(22, Math.round(level * 0.28)))
                                return (
                                    <div 
                                        key={idx}
                                        className="w-1 rounded-full transition-all duration-100"
                                        style={{
                                            height: `${height}px`,
                                            backgroundColor: isMuted ? '#64748B' : (remoteLevel > micLevel ? '#38BDF8' : '#34D399')
                                        }}
                                    />
                                )
                            })}
                        </div>
                    )}

                    {/* AI Analysis Result Preview Card */}
                    {analysisResult && (
                        <div className="w-full bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3 text-left space-y-1.5 mt-1">
                            <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-300">
                                <Sparkles size={12} />
                                <span>AI Call Summary</span>
                            </div>
                            <p className="text-xs text-slate-300 leading-relaxed max-h-24 overflow-y-auto pr-1">
                                {analysisResult.summary || 'Call successfully completed and transcribed.'}
                            </p>
                            {analysisResult.recordingUrl && (
                                <a 
                                    href={analysisResult.recordingUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[11px] text-indigo-400 hover:text-indigo-300 font-bold block pt-1 underline"
                                >
                                    🎙️ Listen to Recording
                                </a>
                            )}
                        </div>
                    )}

                    {/* In-Call Keypad Overlay */}
                    {showKeypad && callState === 'in_call' && (
                        <div className="grid grid-cols-3 gap-1.5 w-full pt-1">
                            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((digit) => (
                                <button
                                    key={digit}
                                    onClick={() => handleKeypadPress(digit)}
                                    className="p-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-black text-xs rounded-xl transition-all shadow-sm cursor-pointer"
                                >
                                    {digit}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Bottom Action Controls */}
                <div className="p-4 pt-2 bg-slate-950/70 border-t border-slate-800/60 flex items-center justify-around">
                    
                    {callState === 'in_call' ? (
                        <>
                            {/* Mute Mic Button */}
                            <button
                                type="button"
                                onClick={() => setIsMuted(!isMuted)}
                                className={`p-3 rounded-full transition-all cursor-pointer shadow-md ${
                                    isMuted ? 'bg-rose-600 text-white ring-4 ring-rose-500/20' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                                }`}
                                title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
                            >
                                {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                            </button>

                            {/* End Call Button */}
                            <button
                                type="button"
                                onClick={handleHangup}
                                className="p-3.5 bg-rose-600 hover:bg-rose-500 text-white rounded-full transition-all shadow-lg shadow-rose-600/40 active:scale-95 cursor-pointer ring-4 ring-rose-600/20"
                                title="End Call"
                            >
                                <PhoneOff size={20} />
                            </button>

                            {/* Speaker Output Mute Toggle */}
                            <button
                                type="button"
                                onClick={() => setIsSpeakerMuted(!isSpeakerMuted)}
                                className={`p-3 rounded-full transition-all cursor-pointer shadow-md ${
                                    isSpeakerMuted ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                                }`}
                                title={isSpeakerMuted ? 'Unmute Speaker' : 'Mute Speaker'}
                            >
                                {isSpeakerMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                            </button>

                            {/* Keypad Toggle Button */}
                            <button
                                type="button"
                                onClick={() => setShowKeypad(!showKeypad)}
                                className={`p-3 rounded-full transition-all cursor-pointer shadow-md ${
                                    showKeypad ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                                }`}
                                title="Toggle DTMF Keypad"
                            >
                                <Grid size={16} />
                            </button>
                        </>
                    ) : callState === 'completed' || callState === 'error' || callState === 'analyzing' ? (
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition-all active:scale-95 cursor-pointer"
                        >
                            {callState === 'analyzing' ? 'Dismiss (Analysis Continues in BG)' : 'Close Call Window'}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleHangup}
                            className="px-5 py-2 bg-rose-600/90 hover:bg-rose-600 text-white text-xs font-bold rounded-full transition-all shadow-md active:scale-95 cursor-pointer flex items-center gap-2"
                        >
                            <PhoneOff size={14} />
                            <span>Cancel Dialing</span>
                        </button>
                    )}
                </div>

            </div>
        </div>
    )
}
