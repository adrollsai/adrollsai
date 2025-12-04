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
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  
  // Analysers
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);

  const addLog = (msg: string, type: 'info' | 'error' | 'success' = 'info') => {
    const time = new Date().toLocaleTimeString().split(' ')[0];
    setLogs(prev => [{ time, msg, type }, ...prev].slice(0, 50)); 
  };

  const connect = useCallback(async (systemInstruction: string, tools: any[]) => {
    if (!apiKey) return alert("API Key required");

    try {
        addLog("Initializing Audio...");
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        
        // 1. OUTPUT CONTEXT (24kHz for Gemini)
        outputContextRef.current = new AudioContextClass({ sampleRate: 24000 });
        
        // 2. INPUT CONTEXT (Try 16kHz)
        // If the browser refuses 16kHz, we downsample manually below.
        inputContextRef.current = new AudioContextClass({ sampleRate: 16000 });
        
        // Setup Visualizers
        inputAnalyserRef.current = inputContextRef.current.createAnalyser();
        outputAnalyserRef.current = outputContextRef.current.createAnalyser();
        inputAnalyserRef.current.fftSize = 32; 
        outputAnalyserRef.current.fftSize = 32;

        // WebSocket
        addLog("Connecting to Gemini...");
        const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
            addLog("Connected! 🟢", 'success');
            setIsConnected(true);
            nextStartTimeRef.current = outputContextRef.current?.currentTime || 0;

            const setupMsg = {
                setup: {
                    // UPDATED MODEL: Specialized for native audio & speed
                    model: "models/gemini-2.5-flash-native-audio-preview-09-2025",
                    generationConfig: { 
                        responseModalities: ["AUDIO"],
                        speechConfig: { 
                            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } }
                        }
                    },
                    systemInstruction: { parts: [{ text: systemInstruction }] },
                    tools: [{ functionDeclarations: tools }]
                }
            };
            ws.send(JSON.stringify(setupMsg));
        };

        ws.onmessage = async (event) => {
            try {
                let textData = event.data instanceof Blob ? await event.data.text() : event.data;
                const data = JSON.parse(textData);

                // Audio Received
                if (data.serverContent?.modelTurn?.parts?.[0]?.inlineData) {
                    playAudio(data.serverContent.modelTurn.parts[0].inlineData.data);
                    
                    // Only log "Speaking" if we weren't already to avoid spam
                    if (!isSpeaking) addLog("Gemini Speaking 🔊", 'success');
                    setIsSpeaking(true);
                }

                if (data.serverContent?.turnComplete) {
                    addLog("Turn Complete", 'info');
                    setIsSpeaking(false);
                }

                if (data.serverContent?.interrupted) {
                    addLog("Interrupted by User", 'info');
                    setIsSpeaking(false);
                    // Clear the buffer to stop previous audio instantly
                    nextStartTimeRef.current = outputContextRef.current?.currentTime || 0;
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
            } catch (e) { console.error(e); }
        };

        ws.onclose = () => { 
            addLog("Disconnected", 'error');
            setIsConnected(false); 
        };
        
        await startMicrophone(ws);

    } catch (err: any) {
        addLog(`Error: ${err.message}`, 'error');
        disconnect();
    }
  }, [apiKey, isSpeaking]); // Added isSpeaking to deps for log check

  const startMicrophone = async (ws: WebSocket) => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { 
                echoCancellation: true,
                autoGainControl: true,
                noiseSuppression: true
            } 
        });
        mediaStreamRef.current = stream;
        
        const context = inputContextRef.current!;
        const source = context.createMediaStreamSource(stream);
        sourceRef.current = source;
        source.connect(inputAnalyserRef.current!);

        // BUFFER SIZE 256: 16ms latency (Matches Google Demo)
        const processor = context.createScriptProcessor(256, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
            if (ws.readyState !== WebSocket.OPEN) return;

            const inputData = e.inputBuffer.getChannelData(0);
            
            // Visualizer Volume
            let sum = 0;
            for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
            setVolumeLevel(Math.sqrt(sum / inputData.length));

            // RESAMPLING LOGIC (Fixes Gibberish on 48kHz mics)
            let pcm16;
            if (context.sampleRate !== 16000) {
                const downsampled = downsampleTo16k(inputData, context.sampleRate);
                pcm16 = floatTo16BitPCM(downsampled);
            } else {
                pcm16 = floatTo16BitPCM(inputData);
            }

            const base64Audio = arrayBufferToBase64(pcm16.buffer);
            ws.send(JSON.stringify({
                realtimeInput: {
                    mediaChunks: [{ mimeType: "audio/pcm", data: base64Audio }]
                }
            }));
        };

        source.connect(processor);
        processor.connect(context.destination);

    } catch (err: any) {
        addLog(`Mic Error: ${err.message}`, 'error');
        disconnect();
    }
  };

  const playAudio = (base64String: string) => {
    if (!outputContextRef.current) return;
    
    const binaryString = window.atob(base64String);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
    
    const float32 = new Float32Array(bytes.length / 2);
    const dataView = new DataView(bytes.buffer);
    for (let i = 0; i < bytes.length / 2; i++) {
        float32[i] = dataView.getInt16(i * 2, true) / 32768;
    }

    const buffer = outputContextRef.current.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);

    const source = outputContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(outputAnalyserRef.current!);
    source.connect(outputContextRef.current.destination);
    
    const now = outputContextRef.current.currentTime;
    // Aggressive catch-up: if behind by >0.1s, jump to now
    if (nextStartTimeRef.current < now || nextStartTimeRef.current > now + 0.1) {
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
    inputContextRef.current?.close();
    outputContextRef.current?.close();
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  return { 
    connect, disconnect, isConnected, isSpeaking, 
    volumeLevel, inputAnalyser: inputAnalyserRef.current, 
    outputAnalyser: outputAnalyserRef.current, logs 
  };
};

// --- UTILS ---
const downsampleTo16k = (buffer: Float32Array, sampleRate: number) => {
    if (sampleRate === 16000) return buffer;
    const ratio = sampleRate / 16000;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
        result[i] = buffer[Math.round(i * ratio)];
    }
    return result;
}

const floatTo16BitPCM = (input: Float32Array) => {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return output;
}

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary);
}