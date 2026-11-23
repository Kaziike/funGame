/**
 * 100% procedural Web Audio API sound synthesizer for Backrooms Level 0.
 * Zero external audio files / zero 404s.
 */
export class BackroomsAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private humGain: GainNode | null = null;
  private humOscA: OscillatorNode | null = null;
  private humOscB: OscillatorNode | null = null;
  private muted = false;
  private started = false;
  private lastHeartbeatAt = 0;

  unlock(): void {
    if (this.started) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.42;
      this.masterGain.connect(this.ctx.destination);

      // Iconic Backrooms 60Hz + 120Hz fluorescent ballast hum
      const humFilter = this.ctx.createBiquadFilter();
      humFilter.type = 'lowpass';
      humFilter.frequency.value = 240;

      this.humGain = this.ctx.createGain();
      this.humGain.gain.value = 0.08;

      this.humOscA = this.ctx.createOscillator();
      this.humOscA.type = 'sawtooth';
      this.humOscA.frequency.value = 60;

      this.humOscB = this.ctx.createOscillator();
      this.humOscB.type = 'sine';
      this.humOscB.frequency.value = 120.4;

      this.humOscA.connect(humFilter);
      this.humOscB.connect(humFilter);
      humFilter.connect(this.humGain);
      this.humGain.connect(this.masterGain);

      this.humOscA.start();
      this.humOscB.start();
      this.started = true;
    } catch {
      // Ignore autoplay restrictions until next user gesture
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.42, this.ctx.currentTime, 0.04);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  setBlackoutModulation(isBlackout: boolean): void {
    if (!this.humGain || !this.ctx) return;
    const target = isBlackout ? 0.02 + Math.random() * 0.14 : 0.08;
    this.humGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.06);
  }

  playFootstep(sprinting: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    const baseFreq = sprinting ? 92 : 68;
    const jitter = 0.92 + Math.random() * 0.16;
    osc.frequency.setValueAtTime(baseFreq * jitter, t);
    osc.frequency.exponentialRampToValueAtTime(34, t + 0.075);

    g.gain.setValueAtTime(sprinting ? 0.18 : 0.09, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.085);
  }

  tickProximityHeartbeat(distanceToSeeker: number): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (distanceToSeeker > 14) return;
    const now = performance.now();
    const interval = Math.max(320, 320 + (distanceToSeeker / 14) * 620);
    if (now - this.lastHeartbeatAt < interval) return;
    this.lastHeartbeatAt = now;

    const strength = Math.max(0.06, (1 - distanceToSeeker / 14) * 0.34);
    this.playThump(0, strength, 56);
    this.playThump(0.14, strength * 0.72, 48);
  }

  private playThump(offsetSec: number, volume: number, freq: number): void {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime + offsetSec;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.12);
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  playTone(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.2): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  playWarmupTick(): void {
    this.playTone(640, 0.08, 'square', 0.12);
  }

  playHuntStart(): void {
    this.playTone(220, 0.45, 'sawtooth', 0.24);
    setTimeout(() => this.playTone(165, 0.65, 'sawtooth', 0.28), 160);
  }

  playTargetLock(): void {
    this.playTone(980, 0.06, 'sine', 0.1);
  }

  playTargetedAlert(): void {
    this.playTone(880, 0.14, 'sawtooth', 0.25);
    setTimeout(() => this.playTone(660, 0.18, 'sawtooth', 0.26), 150);
    setTimeout(() => this.playTone(880, 0.22, 'sawtooth', 0.28), 320);
  }

  playClaimMade(): void {
    this.playTone(520, 0.12, 'triangle', 0.22);
    setTimeout(() => this.playTone(780, 0.2, 'triangle', 0.24), 110);
  }

  playElimination(): void {
    this.playTone(140, 0.5, 'sawtooth', 0.34);
    setTimeout(() => this.playTone(92, 0.65, 'square', 0.3), 120);
  }

  playWrongGuessStun(): void {
    this.playTone(185, 0.28, 'sawtooth', 0.28);
    setTimeout(() => this.playTone(138, 0.45, 'sawtooth', 0.3), 240);
  }

  playVisitorWin(): void {
    this.playTone(523.25, 0.18, 'triangle', 0.22);
    setTimeout(() => this.playTone(659.25, 0.18, 'triangle', 0.22), 120);
    setTimeout(() => this.playTone(783.99, 0.24, 'triangle', 0.25), 240);
    setTimeout(() => this.playTone(1046.5, 0.48, 'sine', 0.28), 380);
  }

  playPickup(): void {
    this.playTone(620, 0.09, 'sine', 0.18);
    setTimeout(() => this.playTone(920, 0.14, 'sine', 0.2), 75);
  }

  playSkill(): void {
    this.playTone(340, 0.12, 'triangle', 0.22);
    setTimeout(() => this.playTone(680, 0.22, 'sine', 0.22), 90);
  }

  dispose(): void {
    try {
      this.humOscA?.stop();
      this.humOscB?.stop();
      void this.ctx?.close();
    } catch {
      // ignore
    }
    this.ctx = null;
    this.started = false;
  }
}
