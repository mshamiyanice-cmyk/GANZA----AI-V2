/**
 * High-Fidelity Jitter Buffer & Resampling Processor (Level 2 Ironclad)
 * FIXED: Monotonic tracking, Bitwise masking, and Unified Ingestion support.
 */

class HighFidelityProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    // 1. Identify Sample Rates (Level 2: Support for live-toggling)
    this.sourceRate = options.processorOptions?.sourceRate || 24000;
    this.hardwareRate = options.processorOptions?.sampleRate || 48000;
    this.resampleRatio = this.sourceRate / this.hardwareRate;

    // Level 2 Telemetry: Shout state to console
    console.log(`[Worklet:TELEMETRY] Source: ${this.sourceRate}Hz | Hardware: ${this.hardwareRate}Hz | Ratio: ${this.resampleRatio.toFixed(4)}`);

    // 2. Buffer Configuration (300ms capacity - Level 2 Resilience)
    const bufferMs = 300;
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

    // 4. State Machine (200ms Pre-roll - Level 2 Safety)
    this.preRollFrames = Math.floor((this.sourceRate * 200) / 1000);
    this.isBuffering = true;

    this.port.onmessage = (event) => {
      if (event.data === "interrupt") {
        this.reset();
      } else if (event.data instanceof Float32Array) {
        this.enqueue(event.data);
      } else if (event.data?.type === "updateConfig") {
        // Allow dynamic rate updates
        if (event.data.sourceRate) {
          this.sourceRate = event.data.sourceRate;
          this.resampleRatio = this.sourceRate / this.hardwareRate;
          this.preRollFrames = Math.floor((this.sourceRate * 200) / 1000);
        }
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
      // this.port.postMessage({ type: 'started', buffered: framesAvailable });
    }
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (output.length === 0) return true;
    const channel = output[0];

    // Current density check
    const framesAvailable = this.framesWritten - this.framesRead;

    // Lookahead needed for linear interpolation (nextIdx = idx + 1)
    const framesNeeded = Math.ceil(channel.length * this.resampleRatio) + 1;

    // Handle Buffering or Underrun
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

      // Bitwise wrap-around indices
      const curIdx = idx & this.bufferMask;
      const nextIdx = (idx + 1) & this.bufferMask;

      const curSample = this.buffer[curIdx];
      const nextSample = this.buffer[nextIdx];

      // Linear Interpolation y = y0 + fraction * (y1 - y0)
      channel[i] = curSample * (1 - fraction) + nextSample * fraction;

      this.readPosition += this.resampleRatio;
    }

    // Calculate integer frames consumed based on read position advancement
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
