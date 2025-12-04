class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.bufferSize = 2048; // Send ~128ms chunks (at 16kHz)
      this.buffer = new Float32Array(this.bufferSize);
      this.byteCount = 0;
    }
  
    process(inputs, outputs, parameters) {
      const input = inputs[0];
      if (input && input.length > 0) {
        const channel = input[0];
        
        for (let i = 0; i < channel.length; i++) {
          this.buffer[this.byteCount++] = channel[i];
          
          if (this.byteCount >= this.bufferSize) {
            // Send full buffer to main thread
            this.port.postMessage(this.buffer);
            this.byteCount = 0;
          }
        }
      }
      return true;
    }
  }
  
  registerProcessor('audio-processor', AudioProcessor);