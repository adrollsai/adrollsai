import { useState, useRef, useCallback } from 'react';

export const useGeminiLive = (apiKey: string) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const connect = useCallback(async (systemInstruction: string, tools: any[]) => {
    if (!apiKey) return alert("API Key required");

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    
    // LOW LATENCY INPUT
    inputContextRef.current = new AudioContextClass({ 
        sampleRate: 16000,
        latencyHint: 'interactive' 
    });
    
    // LOW LATENCY OUTPUT
    outputContextRef.current = new AudioContextClass({ 
        sampleRate: 24000,
        latencyHint: 'interactive'
    });

    // Analysers
    inputAnalyserRef.current = inputContextRef.current.createAnalyser();
    inputAnalyserRef.current.fftSize = 32;
    inputAnalyserRef.current.smoothingTimeConstant = 0.1;

    outputAnalyserRef.current = outputContextRef.current.createAnalyser();
    outputAnalyserRef.current.fftSize = 32;
    outputAnalyserRef.current.smoothingTimeConstant = 0.1;

    // WebSocket
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("Gemini Connected");
      setIsConnected(true);
      nextStartTimeRef.current = outputContextRef.current?.currentTime || 0;
      
      const setupMsg = {
        setup: {
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
        let textData = "";
        if (event.data instanceof Blob) {
          textData = await event.data.text();
        } else {
          textData = event.data as string;
        }

        const data = JSON.parse(textData);
        
        if (data.serverContent?.modelTurn?.parts?.[0]?.inlineData) {
          playAudio(data.serverContent.modelTurn.parts[0].inlineData.data);
          setIsSpeaking(true);
        }

        if (data.serverContent?.turnComplete) {
          setIsSpeaking(false);
        }

        if (data.serverContent?.interrupted) {
            console.log("Interrupted!");
            setIsSpeaking(false);
            // Cancel current audio to stop talking immediately
            // (In a full implementation, you'd track and stop source nodes here)
        }

        if (data.toolUse) {
          const call = data.toolUse.functionCalls[0];
          // We can emit this event to the UI if needed
          console.log("Tool Triggered:", call.name);
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      
      const source = inputContextRef.current!.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
      source.connect(inputAnalyserRef.current!);

      // BUFFER SIZE 256 for 16ms latency (Ultra Fast)
      const processor = inputContextRef.current!.createScriptProcessor(256, 1, 1);
      scriptProcessorRef.current = processor;
      
      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Volume
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
        setVolumeLevel(Math.sqrt(sum / inputData.length));

        // Float32 -> PCM16 (16kHz already guaranteed by Context)
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
    
    // Latency Compensation: Jump to now if drifting
    const now = outputContextRef.current.currentTime;
    if (nextStartTimeRef.current < now) {
        nextStartTimeRef.current = now;
    }
    
    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += buffer.duration;
  };

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    scriptProcessorRef.current?.disconnect();
    sourceNodeRef.current?.disconnect();
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