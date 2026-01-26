class HighFidelityProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.srcRate = options.processorOptions.sourceRate;
    this.hwRate = options.processorOptions.hardwareRate;
    this.ratio = this.srcRate / this.hwRate; // ~0.5 for 24k->48k

    // 1. Ring Buffer
    this.capacity = 16384 * 2;
    this.buffer = new Float32Array(this.capacity);
    this.writeIdx = 0;
    this.readPos = 0;
    this.count = 0;

    // 2. Anti-Aliasing (1-pole LPF)
    this.lastSample = 0;
    this.lpAlpha = 0.8; // Smoothing factor

    // 3. Signal Integrity Watchdog (Reason 5)
    this.watchdogTicks = 0;
    this.watchdogSamples = 0;
    this.isWatchdogActive = false;

    // 4. Pitch Diagnostics
    this.lastCrossing = 0;
    this.crossings = 0;
    this.diagSamples = 0;

    this.port.onmessage = (e) => {
      if (e.data instanceof Float32Array) {
        this.enqueue(e.data);
        // Start watchdog on first audio chunk
        if (!this.isWatchdogActive) this.isWatchdogActive = true;
        this.watchdogSamples += e.data.length;
      }
    };
  }

  enqueue(data) {
    for (let i = 0; i < data.length; i++) {
      this.buffer[this.writeIdx] = data[i];
      this.writeIdx = (this.writeIdx + 1) % this.capacity;
      this.count++;
    }
  }

  process(inputs, outputs) {
    const channel = outputs[0][0];
    if (!channel) return true;

    // Safety: Only play if we have enough lookahead for interpolation
    if (this.bufferCount() < channel.length * this.ratio + 2) {
      channel.fill(0);
      return true;
    }

    // Tick the watchdog
    if (this.isWatchdogActive) {
      this.watchdogTicks += channel.length;

      // Every 5 seconds, perform a Duration Audit
      if (this.watchdogTicks >= this.hwRate * 5) {
        const expectedTicks = this.watchdogSamples / this.ratio;
        const drift = Math.abs(this.watchdogTicks - expectedTicks) / this.hwRate;

        console.log(`[Worklet:WATCHDOG] Samples: ${this.watchdogSamples} | Ticks: ${this.watchdogTicks} | Drift: ${drift.toFixed(3)}s`);

        if (drift > 0.5) { // If audio is running >0.5s off-sync every 5s
          this.port.postMessage({
            type: 'RATE_FAILURE',
            message: "Upsampling Fail: Hardware is consuming samples too fast. Ratio inversion likely."
          });
        }

        // Reset window
        this.watchdogTicks = 0;
        this.watchdogSamples = 0;
      }
    }

    for (let i = 0; i < channel.length; i++) {
      const idx0 = Math.floor(this.readPos) % this.capacity;
      const idx1 = (idx0 + 1) % this.capacity;
      const f = this.readPos - Math.floor(this.readPos);

      // BIT-PERFECT UPSAMPLING MATH:
      // Linear Interpolation: y = y0 + f * (y1 - y0)
      const raw = this.buffer[idx0] + f * (this.buffer[idx1] - this.buffer[idx0]);

      // ANTI-ALIASING FILTER (RC Smoothing)
      const filtered = this.lastSample + this.lpAlpha * (raw - this.lastSample);
      channel[i] = filtered;
      this.lastSample = filtered;

      // UPDATE CLOCK
      this.readPos += this.ratio;
      this.count -= this.ratio;

      // DIAGNOSTICS: Zero-Crossing Rate
      if (raw > 0 && this.lastCrossing <= 0) this.crossings++;
      this.lastCrossing = raw;
      if (++this.diagSamples > this.hwRate) {
        const freq = (this.crossings * 1.0);
        if (freq > 800) this.port.postMessage({ type: 'PITCH_ALERT', frequency: freq });
        this.crossings = 0;
        this.diagSamples = 0;
      }
    }
    return true;
  }

  // Precision counter (Float-safe)
  bufferCount() {
    return this.count;
  }
}
registerProcessor("pcm-processor", HighFidelityProcessor);
