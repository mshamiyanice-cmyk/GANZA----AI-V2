/**
 * High-Fidelity Jitter Buffer & Resampling Processor
 * FIXED: Proper frame tracking with bounded indices to prevent cumulative drift.
 */

class HighFidelityProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    // 1. Identify Sample Rates
    this.sourceRate = 24000;
    this.hardwareRate = options.processorOptions?.sampleRate || 48000;
    this.resampleRatio = this.sourceRate / this.hardwareRate;

    // 2. Buffer Configuration (250ms capacity)
    const bufferMs = 250;
    this.bufferFrames = Math.ceil((this.sourceRate * bufferMs) / 1000);
    // Use power of 2 for fast bitwise modulo
    this.bufferLength = Math.pow(2, Math.ceil(Math.log2(this.bufferFrames * 2)));
    this.bufferMask = this.bufferLength - 1;
    this.buffer = new Float32Array(this.bufferLength);

    // 3. Monotonic Tracking (Prevents Drift)
    this.writeIndex = 0;        // Integer [0, mask]
    this.readPosition = 0;      // Float, used for interpolation
    this.framesWritten = 0;     // Monotonic total
    this.framesRead = 0;        // Monotonic total

    // 4. State Machine (100ms Pre-roll)
    this.preRollFrames = Math.floor((this.sourceRate * 100) / 1000);
    this.isBuffering = true;

    this.port.onmessage = (event) => {
      if (event.data === "interrupt") {
        this.reset();
      } else if (event.data instanceof Float32Array) {
        this.enqueue(event.data);
      }
    };
  }

  reset() {
    this.buffer.fill(0);
    this.writeIndex = 0;
    this.readPosition = 0;
    this.framesWritten = 0;
    this.framesRead = 0;
    this.isBuffering = true;
  }

  enqueue(audioData) {
    for (let i = 0; i < audioData.length; i++) {
      this.buffer[this.writeIndex] = audioData[i];
      this.writeIndex = (this.writeIndex + 1) & this.bufferMask;
      this.framesWritten++;
    }

    const framesAvailable = this.framesWritten - this.framesRead;

    if (this.isBuffering && framesAvailable >= this.preRollFrames) {
      this.isBuffering = false;
      this.port.postMessage({ type: 'started', buffered: framesAvailable });
    }
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (output.length === 0) return true;
    const channel = output[0];

    const framesAvailable = this.framesWritten - this.framesRead;
    const framesNeeded = Math.ceil(channel.length * this.resampleRatio) + 1;

    if (this.isBuffering || framesAvailable < framesNeeded) {
      if (!this.isBuffering && framesAvailable < framesNeeded) {
        this.isBuffering = true;
        this.port.postMessage({ type: 'underrun', available: framesAvailable, needed: framesNeeded });
      }
      channel.fill(0);
      return true;
    }

    const startReadPosition = this.readPosition;

    // Linear Interpolation Resampling Loop
    for (let i = 0; i < channel.length; i++) {
      const idx = Math.floor(this.readPosition);
      const fraction = this.readPosition - idx;

      const curIdx = idx & this.bufferMask;
      const nextIdx = (idx + 1) & this.bufferMask;

      const curSample = this.buffer[curIdx];
      const nextSample = this.buffer[nextIdx];

      channel[i] = curSample * (1 - fraction) + nextSample * fraction;

      this.readPosition += this.resampleRatio;
    }

    const framesConsumed = Math.floor(this.readPosition) - Math.floor(startReadPosition);
    this.framesRead += framesConsumed;

    // Normalize readPosition to prevent floating point precision loss
    if (this.readPosition > this.bufferLength * 2) {
      this.readPosition -= this.bufferLength;
    }

    return true;
  }
}

registerProcessor("pcm-processor", HighFidelityProcessor);
