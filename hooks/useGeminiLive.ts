import { useState, useRef, useCallback } from 'react';

export type Logger = {
  log: (msg: string, type?: 'info' | 'error' | 'success') => void;
  logs: { time: string; msg: string; type: 'info' | 'error' | 'success' }[];
};

export const useGeminiLive = (apiKey: string) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [logs, setLogs] = useState<{ time: string; msg: string; type: 'info' | 'error' | 'success' }[]>([]);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  
  // Analysers
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);

  // Helper to add logs
  const addLog = (msg: string, type: 'info' | 'error' | 'success' = 'info') => {
    const time = new Date().toLocaleTimeString().split(' ')[0];
    setLogs(prev => [{ time, msg, type }, ...prev].slice(0, 50)); // Keep last 50 logs
  };

  const connect = useCallback(async (systemInstruction: string, tools: any[]) => {
    if (!apiKey) {
        addLog("Missing API Key", 'error');
        return;
    }

    try {
        addLog("Initializing Audio...");
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        // Output context (for speakers)
        audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
        
        // Setup Visualizers
        inputAnalyserRef.current = audioContextRef.current.createAnalyser();
        inputAnalyserRef.current.fftSize = 32;
        inputAnalyserRef.current.smoothingTimeConstant = 0.1;
        
        outputAnalyserRef.current = audioContextRef.current.createAnalyser();
        outputAnalyserRef.current.fftSize = 32;
        outputAnalyserRef.current.smoothingTimeConstant = 0.1;

        // WebSocket Setup
        addLog("Connecting to Gemini...");
        const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
            addLog("Connected! 🟢", 'success');
            setIsConnected(true);
            nextStartTimeRef.current = audioContextRef.current?.currentTime || 0;

            const setupMsg = {
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generationConfig: { 
                        responseModalities: ["AUDIO"],
                        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } }
                    },
                    systemInstruction: { parts: [{ text: systemInstruction }] },
                    tools: [{ functionDeclarations: tools }]
                }
            };
            ws.send(JSON.stringify(setupMsg));
        };

        ws.onmessage = async (event) => {
            try {
                let textData = "";
                if (event.data instanceof Blob) {
                    textData = await event.data.text();
                } else {
                    textData = event.data as string;
                }

                const data = JSON.parse(textData);

                if (data.serverContent?.modelTurn?.parts?.[0]?.inlineData) {
                    // addLog("Received Audio Chunk");
                    playAudio(data.serverContent.modelTurn.parts[0].inlineData.data);
                    setIsSpeaking(true);
                }

                if (data.serverContent?.turnComplete) {
                    addLog("Bot finished speaking");
                    setIsSpeaking(false);
                }

                if (data.serverContent?.interrupted) {
                    addLog("User interrupted bot", 'info');
                    setIsSpeaking(false);
                    // Clear buffer logic could go here
                }

                if (data.toolUse) {
                    const call = data.toolUse.functionCalls[0];
                    addLog(`Tool Called: ${call.name}`, 'success');
                    ws.send(JSON.stringify({
                        toolResponse: {
                            functionResponses: [{
                                name: call.name,
                                id: call.id,
                                response: { result: "Success" } 
                            }]
                        }
                    }));
                }
            } catch (e) {
                console.error(e);
            }
        };

        ws.onerror = (e) => {
            addLog("WebSocket Error", 'error');
            console.error(e);
            disconnect();
        };

        ws.onclose = () => {
            addLog("Disconnected", 'error');
            disconnect();
        };

        await startMicrophone(ws);

    } catch (err: any) {
        addLog(`Setup Failed: ${err.message}`, 'error');
        disconnect();
    }
  }, [apiKey]);

  const startMicrophone = async (ws: WebSocket) => {
    try {
        addLog("Opening Microphone...");
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { 
                echoCancellation: true, 
                noiseSuppression: true,
                autoGainControl: true
            } 
        });
        
        mediaStreamRef.current = stream;
        
        // We use the SAME audio context for input to ensure timing sync
        // But we must handle sample rate conversion manually
        const context = audioContextRef.current!;
        const source = context.createMediaStreamSource(stream);
        sourceRef.current = source;
        source.connect(inputAnalyserRef.current!);

        // Processor
        // Buffer 512 = ~10ms at 48kHz. Very fast.
        const processor = context.createScriptProcessor(512, 1, 1);
        processorRef.current = processor;

        // RESAMPLER STATE
        const targetRate = 16000;
        let inputSampleRate = context.sampleRate; // Likely 44100 or 48000
        
        processor.onaudioprocess = (e) => {
            if (ws.readyState !== WebSocket.OPEN) return;

            const inputData = e.inputBuffer.getChannelData(0);
            
            // 1. Calculate Volume
            let sum = 0;
            for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
            setVolumeLevel(Math.sqrt(sum / inputData.length));

            // 2. Downsample to 16kHz (Crucial for Gemini!)
            const downsampledData = downsampleBuffer(inputData, inputSampleRate, targetRate);

            // 3. Convert to PCM16
            const pcm16 = new Int16Array(downsampledData.length);
            for (let i = 0; i < downsampledData.length; i++) {
                const s = Math.max(-1, Math.min(1, downsampledData[i]));
                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }

            // 4. Send
            const base64Audio = arrayBufferToBase64(pcm16.buffer);
            ws.send(JSON.stringify({
                realtimeInput: {
                    mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: base64Audio }]
                }
            }));
        };

        source.connect(processor);
        processor.connect(context.destination); // Connect to dest to keep it alive (usually muted by browser if not)

    } catch (err: any) {
        addLog(`Mic Error: ${err.message}`, 'error');
        disconnect();
    }
  };

  const playAudio = (base64String: string) => {
    if (!audioContextRef.current) return;
    
    // Convert Base64 -> Float32 (24kHz)
    const binaryString = window.atob(base64String);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
    
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
    }

    const buffer = audioContextRef.current.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);

    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(outputAnalyserRef.current!);
    source.connect(audioContextRef.current.destination);
    
    // Latency handling: If we fall behind by more than 0.2s, snap to current time
    const now = audioContextRef.current.currentTime;
    if (nextStartTimeRef.current < now || nextStartTimeRef.current > now + 0.5) {
        // addLog("Resyncing Audio Timeline", 'info');
        nextStartTimeRef.current = now;
    }
    
    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += buffer.duration;
  };

  const disconnect = useCallback(() => {
    setIsConnected(false);
    setIsSpeaking(false);
    
    wsRef.current?.close();
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    audioContextRef.current?.close();
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    
    addLog("Session Ended", 'info');
  }, []);

  return { 
    connect, 
    disconnect, 
    isConnected, 
    isSpeaking, 
    volumeLevel,
    inputAnalyser: inputAnalyserRef.current,
    outputAnalyser: outputAnalyserRef.current,
    logs 
  };
};

// --- UTILS ---

// Simple Linear Interpolation Downsampler
function downsampleBuffer(buffer: Float32Array, sampleRate: number, outSampleRate: number) {
    if (outSampleRate === sampleRate) {
        return buffer;
    }
    if (outSampleRate > sampleRate) {
        throw new Error("Upsampling not supported");
    }
    const sampleRateRatio = sampleRate / outSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
        // Simple averaging (box filter) for anti-aliasing
        let accum = 0, count = 0;
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
            accum += buffer[i];
            count++;
        }
        result[offsetResult] = count > 0 ? accum / count : 0;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
    }
    return result;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}