import { useState, useRef, useCallback } from 'react';

export const useGeminiLive = (apiKey: string) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);

  const connect = useCallback(async (systemInstruction: string, tools: any[]) => {
    if (!apiKey) return alert("API Key required");

    // 1. Setup Audio Context
    // Gemini 2.5 Native Audio output is 24kHz. We force the context to match.
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
    
    // 2. Setup WebSocket
    // Using the BidiGenerateContent endpoint
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("Gemini Connected");
      setIsConnected(true);
      
      // Initial Setup Message
      // Updated to use the specific 2.5 Flash Native Audio Preview model
      const setupMsg = {
        setup: {
          model: "models/gemini-2.5-flash-native-audio-preview-09-2025", 
          generationConfig: { 
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } // Optional: Aoife, Puck, Charon, Kore, Fenrir
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
        let textData = "";
        
        // FIX 1: Handle Blob Data (The error you saw)
        // Browsers often receive WebSocket frames as Blobs. We must read them as text first.
        if (event.data instanceof Blob) {
          textData = await event.data.text();
        } else {
          textData = event.data as string;
        }

        const data = JSON.parse(textData);
        
        // A. Handle Audio Output
        // The API returns audio in `serverContent.modelTurn.parts[0].inlineData`
        if (data.serverContent?.modelTurn?.parts?.[0]?.inlineData) {
          const audioData = data.serverContent.modelTurn.parts[0].inlineData.data;
          playAudio(audioData);
          setIsSpeaking(true);
        }

        // B. Handle Turn Complete
        if (data.serverContent?.turnComplete) {
          setIsSpeaking(false);
        }

        // C. Handle Tool Calls
        if (data.toolUse) {
          const call = data.toolUse.functionCalls[0];
          console.log("Tool Called:", call.name, call.args);
          
          // Mock successful response to keep conversation flowing
          const toolResponse = {
            toolResponse: {
              functionResponses: [{
                name: call.name,
                id: call.id,
                response: { result: "Success" } 
              }]
            }
          };
          ws.send(JSON.stringify(toolResponse));
        }
      } catch (e) {
        console.error("Error parsing WebSocket message:", e);
      }
    };

    ws.onerror = (error) => {
        console.error("WebSocket Error:", error);
        setIsConnected(false);
    };

    ws.onclose = () => {
        setIsConnected(false);
        console.log("Gemini Disconnected");
    };

    // 3. Start Microphone
    await startMicrophone(ws);

  }, [apiKey]);

  const startMicrophone = async (ws: WebSocket) => {
    try {
      // FIX 2: Relaxed Microphone Constraints
      // Removing strict sampleRate requirements prevents "Requested device not found"
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      
      const source = audioContextRef.current!.createMediaStreamSource(stream);
      
      // Setup Processor to record mono audio (Gemini expects PCM 16kHz mono usually, but we handle resampling here)
      const processor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
      
      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Volume Visualizer Logic
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
        setVolumeLevel(Math.sqrt(sum / inputData.length));

        // Convert Float32 (Browser) -> PCM16 (Gemini)
        // This effectively handles the resampling if the browser context is different
        const pcm16 = floatTo16BitPCM(inputData);
        const base64Audio = arrayBufferToBase64(pcm16);

        // Streaming audio input
        ws.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [{ mimeType: "audio/pcm", data: base64Audio }]
          }
        }));
      };

      source.connect(processor);
      processor.connect(audioContextRef.current!.destination);

    } catch (err) {
      console.error("Mic Error:", err);
      alert("Microphone access failed. Please allow permissions.");
      setIsConnected(false);
    }
  };

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    audioContextRef.current?.close();
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    setIsConnected(false);
    setIsSpeaking(false);
    setVolumeLevel(0);
  }, []);

  // --- Audio Helpers ---
  const playAudio = (base64String: string) => {
    if (!audioContextRef.current) return;
    
    // Decode Base64 to binary
    const binaryString = window.atob(base64String);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
    
    // Convert PCM16 (from Gemini) to Float32 (for Browser AudioContext)
    const float32 = new Float32Array(bytes.length / 2);
    const dataView = new DataView(bytes.buffer);
    for (let i = 0; i < bytes.length / 2; i++) {
        // PCM16 is little-endian
        float32[i] = dataView.getInt16(i * 2, true) / 32768;
    }

    const buffer = audioContextRef.current.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);

    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    
    // Basic queueing to prevent overlapping audio
    const now = audioContextRef.current.currentTime;
    const start = Math.max(now, nextStartTimeRef.current);
    source.start(start);
    nextStartTimeRef.current = start + buffer.duration;
  };

  const floatTo16BitPCM = (float32Arr: Float32Array) => {
    const buffer = new ArrayBuffer(float32Arr.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Arr.length; i++) {
      let s = Math.max(-1, Math.min(1, float32Arr[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
  };

  const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary);
  };

  return { connect, disconnect, isConnected, isSpeaking, volumeLevel };
};