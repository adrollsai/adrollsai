/**
 * Microphone capture on the audio thread.
 *
 * The old main-thread capture node is deprecated and can glitch the uplink during a
 * React render. This worklet posts fixed-size frames of mono Float32 samples back to
 * the page instead, and does nothing else — converting and encoding happen outside,
 * where they cannot stall audio.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // 2048 samples @ 16 kHz is the frame size the page expects (128 ms), matching the
    // chunk size the previous main-thread capture node used, so nothing downstream
    // changes.
    this.frameSize = (options && options.processorOptions && options.processorOptions.frameSize) || 2048;
    this.buffer = new Float32Array(this.frameSize);
    this.filled = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'flush') {
        this.filled = 0;
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const samples = input[0];
    for (let i = 0; i < samples.length; i++) {
      this.buffer[this.filled++] = samples[i];
      if (this.filled === this.frameSize) {
        // Copy out: the buffer is reused, and the consumer may hold onto the frame.
        this.port.postMessage(this.buffer.slice(0));
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
