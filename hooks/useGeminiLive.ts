import { useState, useRef, useCallback, useEffect } from 'react';

// --- HELPER FUNCTIONS ---
function floatTo16BitPCM(float32Arr: Float32Array) {
  const buffer = new ArrayBuffer(float32Arr.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Arr.length; i++) {
    let s = Math.max(-1, Math.min(1, float32Arr[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buffer;
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
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  
  // Analysers
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);

  const addLog = (msg: string, type: 'info' | 'error' | 'success' = 'info') => {
    const time = new Date().toLocaleTimeString().split(' ')[0];
    setLogs(prev => [{ time, msg, type }, ...prev].slice(0, 50)); 
  };

  const connect = useCallback(async (systemInstruction: string, tools: any[]) => {
    if (!apiKey) {
        addLog("Missing API Key", 'error');
        return;
    }
    
    // PREVENT DOUBLE CONNECTION (Strict Mode Fix)
    if (wsRef.current) return;

    try {
        addLog("Initializing Audio...");
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
        
        // Setup Analysers
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
                    model: "models/gemini-2.5-flash-native-audio-preview-09-2025",
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
                let textData = event.data instanceof Blob ? await event.data.text() : event.data;
                const data = JSON.parse(textData);

                // Audio Received
                if (data.serverContent?.modelTurn?.parts?.[0]?.inlineData) {
                    playAudio(data.serverContent.modelTurn.parts[0].inlineData.data);
                    setIsSpeaking(true);
                }

                if (data.serverContent?.turnComplete) {
                    setIsSpeaking(false);
                }

                if (data.serverContent?.interrupted) {
                    addLog("Interrupted", 'info');
                    setIsSpeaking(false);
                    if (audioContextRef.current) {
                        nextStartTimeRef.current = audioContextRef.current.currentTime;
                    }
                }

                if (data.toolUse) {
                    const call = data.toolUse.functionCalls[0];
                    addLog(`Tool: ${call.name}`, 'success');
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
            wsRef.current = null; // Clear ref on close
        };
        
        await startMicrophone(ws);

    } catch (err: any) {
        addLog(`Error: ${err.message}`, 'error');
        disconnect();
    }
  }, [apiKey]);

  const startMicrophone = async (ws: WebSocket) => {
    if (!audioContextRef.current) return;

    try {
        // --- 1. Load AudioWorklet (Embedded String) ---
        // This runs in a separate thread to prevent UI Lag
        const workletCode = `
          class RecorderProcessor extends AudioWorkletProcessor {
            constructor() {
              super();
              this.bufferSize = 2048; 
              this.buffer = new Float32Array(this.bufferSize);
              this.bufferIndex = 0;
            }
            process(inputs, outputs, parameters) {
              const input = inputs[0];
              if (!input || !input[0]) return true;
              const channel = input[0];
              for (let i = 0; i < channel.length; i++) {
                this.buffer[this.bufferIndex++] = channel[i];
                if (this.bufferIndex === this.bufferSize) {
                  this.port.postMessage(this.buffer);
                  this.bufferIndex = 0;
                }
              }
              return true;
            }
          }
          registerProcessor('recorder-worklet', RecorderProcessor);
        `;
        
        const blob = new Blob([workletCode], { type: 'application/javascript' });
        const workletUrl = URL.createObjectURL(blob);
        await audioContextRef.current.audioWorklet.addModule(workletUrl);

        // --- 2. Start Stream ---
        // Request 16kHz to match Gemini. Browser handles resampling if hardware is 48kHz.
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { sampleRate: 16000, channelCount: 1 } 
        });
        mediaStreamRef.current = stream;
        
        const source = audioContextRef.current.createMediaStreamSource(stream);
        sourceNodeRef.current = source;
        source.connect(inputAnalyserRef.current!);

        // --- 3. Connect Worklet ---
        const recorderNode = new AudioWorkletNode(audioContextRef.current, 'recorder-worklet');
        workletNodeRef.current = recorderNode;
        
        recorderNode.port.onmessage = (event) => {
            if (ws.readyState !== WebSocket.OPEN) return;

            const inputData = event.data as Float32Array;
            
            // Volume
            let sum = 0;
            for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
            setVolumeLevel(Math.sqrt(sum / inputData.length));

            // Convert Float32 -> PCM16
            // Note: browser's createMediaStreamSource(16000) handles the resampling for us now
            const pcm16 = floatTo16BitPCM(inputData);
            
            // FIXED: Removed .buffer access (pcm16 IS the ArrayBuffer)
            const base64Audio = arrayBufferToBase64(pcm16);

            ws.send(JSON.stringify({
                realtimeInput: {
                    mediaChunks: [{ mimeType: "audio/pcm", data: base64Audio }]
                }
            }));
        };

        source.connect(recorderNode);
        recorderNode.connect(audioContextRef.current.destination);

    } catch (err: any) {
        addLog(`Mic Error: ${err.message}`, 'error');
        disconnect();
    }
  };

  const playAudio = (base64String: string) => {
    if (!audioContextRef.current) return;
    
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
    
    const now = audioContextRef.current.currentTime;
    if (nextStartTimeRef.current < now) nextStartTimeRef.current = now;
    
    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += buffer.duration;
  };

  const disconnect = useCallback(() => {
    setIsConnected(false);
    setIsSpeaking(false);
    
    wsRef.current?.close();
    wsRef.current = null; // Important for double-connection check
    
    workletNodeRef.current?.disconnect();
    sourceNodeRef.current?.disconnect();
    audioContextRef.current?.close();
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    
    addLog("Session Ended", 'info');
  }, []);

  return { 
    connect, disconnect, isConnected, isSpeaking, 
    volumeLevel, inputAnalyser: inputAnalyserRef.current, 
    outputAnalyser: outputAnalyserRef.current, logs 
  };
};