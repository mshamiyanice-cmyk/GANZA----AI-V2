class HighFidelityProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // 1. MIGRATION-AWARE RATE DETECTION
    const opts = options.processorOptions || {};

    let usingLegacy = false;
    this.srcRate = opts.srcRate;
    if (this.srcRate === undefined) {
      this.srcRate = opts.sourceRate;
      if (this.srcRate !== undefined) usingLegacy = true;
    }

    this.hwRate = opts.hwRate;
    if (this.hwRate === undefined) {
      this.hwRate = opts.hardwareRate ?? opts.sampleRate;
      if (this.hwRate !== undefined) usingLegacy = true;
    }

    // 2. SANITY BOUNDS & FAIL-FAST
    this.isFatal = false;
    const MIN_RATE = 8000;
    const MAX_RATE = 192000;

    const isInvalid = (rate) => !rate || rate < MIN_RATE || rate > MAX_RATE;

    if (isInvalid(this.srcRate) || isInvalid(this.hwRate)) {
      const errorMsg = `❌ FATAL RATE ERROR: Invalid/Insane configuration (src:${this.srcRate}, hw:${this.hwRate})`;
      console.error(errorMsg);
      this.isFatal = true;
      // Fallback only to keep system from crashing, remains fatal
      this.srcRate = this.srcRate || 24000;
      this.hwRate = this.hwRate || 48000;
    }

    this.ratio = this.srcRate / this.hwRate;

    // Decisive bounds check
    if (isNaN(this.ratio) || this.ratio <= 0 || this.ratio > 4.0) {
      console.error(`❌ FATAL RATIO ERROR: Ratio ${this.ratio} is out of bounds.`);
      this.isFatal = true;
    }

    // 3. THE IRREFUTABLE PROOF (Truth Table)
    const BUILD_ID = "2026-01-29.02-RUTHLESS";
    console.log(`[Worklet] 🛠️ Truth Table: BUILD=${BUILD_ID} srcRate=${this.srcRate} hwRate=${this.hwRate} ratio=${this.ratio.toFixed(4)} readStep=${this.ratio.toFixed(4)} legacy=${usingLegacy}`);

    if (this.isFatal) {
      console.error(`[Worklet] ❌ FATAL ERROR: Resampler is in KILL-SWITCH mode (Silence only).`);
    } else {
      console.log(`[Worklet] 🚀 RESAMPLER ACTIVE: Resampling ${this.srcRate}Hz -> ${this.hwRate}Hz`);
    }

    // Ring Buffer
    this.capacity = 16384 * 2;
    this.buffer = new Float32Array(this.capacity);
    this.writeIdx = 0;
    this.readPos = 0;
    this.count = 0;

    // Anti-Aliasing (1-pole LPF)
    this.lastSample = 0;
    this.lpAlpha = 0.8;

    // Signal Integrity Watchdog
    // DEFINITIONS:
    // watchdogSamples: Input samples received from Gemini
    // watchdogTicks: Hardware time slots processed by worklet
    this.watchdogTicks = 0;
    this.watchdogSamples = 0;
    this.isWatchdogActive = false;

    // Pitch Diagnostics
    this.lastCrossing = 0;
    this.crossings = 0;
    this.diagSamples = 0;

    this.port.onmessage = (e) => {
      if (e.data instanceof Float32Array) {
        this.enqueue(e.data);
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

    // Kill-Switch: If configuration is fatal, output silence
    if (this.isFatal) {
      channel.fill(0);
      return true;
    }

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
