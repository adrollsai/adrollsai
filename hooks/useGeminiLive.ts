import { useState, useRef, useCallback, useEffect } from 'react';

export const useGeminiLive = (apiKey: string) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  
  // Two separate contexts for Input (16kHz) and Output (24kHz)
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  
  // Analysers for the Orb
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const connect = useCallback(async (systemInstruction: string, tools: any[]) => {
    if (!apiKey) return alert("API Key required");

    // 1. Initialize Audio Contexts
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    
    // INPUT: 16kHz (Required by Gemini)
    inputContextRef.current = new AudioContextClass({ sampleRate: 16000 });
    
    // OUTPUT: 24kHz (Required by Gemini)
    outputContextRef.current = new AudioContextClass({ sampleRate: 24000 });

    // Setup Analysers
    inputAnalyserRef.current = inputContextRef.current.createAnalyser();
    inputAnalyserRef.current.fftSize = 32;
    inputAnalyserRef.current.smoothingTimeConstant = 0.1;

    outputAnalyserRef.current = outputContextRef.current.createAnalyser();
    outputAnalyserRef.current.fftSize = 32;
    outputAnalyserRef.current.smoothingTimeConstant = 0.1;

    // 2. WebSocket Setup
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("Gemini Connected");
      setIsConnected(true);
      nextStartTimeRef.current = outputContextRef.current?.currentTime || 0;
      
      const setupMsg = {
        setup: {
          model: "models/gemini-2.0-flash-exp",
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
        let textData = "";
        if (event.data instanceof Blob) {
          textData = await event.data.text();
        } else {
          textData = event.data as string;
        }

        const data = JSON.parse(textData);
        
        // Handle Audio
        if (data.serverContent?.modelTurn?.parts?.[0]?.inlineData) {
          const audioData = data.serverContent.modelTurn.parts[0].inlineData.data;
          playAudio(audioData);
          setIsSpeaking(true);
        }

        // Handle Turn Complete
        if (data.serverContent?.turnComplete) {
          setIsSpeaking(false);
        }

        // Handle Interruption
        if (data.serverContent?.interrupted) {
            console.log("Interrupted!");
            // Clear the audio queue
            // In a real app, you would cancel the current buffer source nodes here
            // For simplicity, we just reset the speaking state visually
            setIsSpeaking(false);
        }

        // Handle Tool Calls
        if (data.toolUse) {
          const call = data.toolUse.functionCalls[0];
          console.log("Tool Triggered:", call.name, call.args);
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
        console.error("Parse Error:", e);
      }
    };

    ws.onclose = () => setIsConnected(false);

    await startMicrophone(ws);

  }, [apiKey]);

  const startMicrophone = async (ws: WebSocket) => {
    try {
      // Get Mic Stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      
      // Connect stream to the 16kHz Input Context
      const source = inputContextRef.current!.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
      source.connect(inputAnalyserRef.current!);

      // Use Buffer Size 256 for ultra-low latency (~16ms)
      // This matches the Google Demo implementation
      const processor = inputContextRef.current!.createScriptProcessor(256, 1, 1);
      scriptProcessorRef.current = processor;
      
      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Volume Calculation
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
        setVolumeLevel(Math.sqrt(sum / inputData.length));

        // Convert to PCM16
        // Since inputContext is 16kHz, this data is ALREADY 16kHz. 
        // No manual resampling needed.
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // Base64 Encode
        let binary = '';
        const bytes = new Uint8Array(pcm16.buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
        const base64Audio = window.btoa(binary);

        ws.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [{ mimeType: "audio/pcm", data: base64Audio }]
          }
        }));
      };

      source.connect(processor);
      processor.connect(inputContextRef.current!.destination);

    } catch (err) {
      console.error("Mic Error:", err);
      setIsConnected(false);
    }
  };

  const playAudio = (base64String: string) => {
    if (!outputContextRef.current) return;
    
    // Decode Base64 -> PCM16 -> Float32
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
    
    // "Catch Up" Logic: If we are falling behind, jump to now
    const now = outputContextRef.current.currentTime;
    if (nextStartTimeRef.current < now) {
        nextStartTimeRef.current = now;
    }
    
    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += buffer.duration;
  };

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    
    // Clean up Audio Nodes
    scriptProcessorRef.current?.disconnect();
    sourceNodeRef.current?.disconnect();
    
    // Close Contexts
    inputContextRef.current?.close();
    outputContextRef.current?.close();
    
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    
    setIsConnected(false);
    setIsSpeaking(false);
    setVolumeLevel(0);
  }, []);

  return { 
    connect, 
    disconnect, 
    isConnected, 
    isSpeaking, 
    volumeLevel,
    inputAnalyser: inputAnalyserRef.current,
    outputAnalyser: outputAnalyserRef.current
  };
};