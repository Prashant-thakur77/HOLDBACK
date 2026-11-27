/**
 * Interface sounds, synthesised in the browser: the click of a ticket punch,
 * a stamp's thud, one gong when the bowl sinks. No audio files.
 *
 * Sound is off until the visitor turns it on, and the choice is remembered.
 * The audio context is created inside that click, as browsers require.
 */
const STORAGE_KEY = 'holdback.sound';

export type SoundName = 'punch' | 'stamp' | 'gong' | 'lift';

let context: AudioContext | null = null;
let enabled = false;
const listeners = new Set<(on: boolean) => void>();

export function soundEnabled(): boolean {
  return enabled;
}

/** Reads the saved choice. Call once on the client; storage may be blocked. */
export function restoreSound(): boolean {
  try {
    enabled = window.localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    enabled = false;
  }
  return enabled;
}

export function onSoundChange(listener: (on: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // The choice still holds for this visit.
  }
  if (on) {
    audio();
    playSound('punch');
  }
  listeners.forEach((listener) => listener(on));
}

function audio(): AudioContext | null {
  if (context) return context;
  const Ctor = window.AudioContext;
  if (!Ctor) return null;
  context = new Ctor();
  return context;
}

/** A short burst of filtered noise: paper and metal. */
function noise(ctx: AudioContext, at: number, length: number, frequency: number, gain: number) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * length), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index++) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / data.length) ** 2;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = frequency;
  const volume = ctx.createGain();
  volume.gain.value = gain;
  source.connect(filter).connect(volume).connect(ctx.destination);
  source.start(at);
}

/** A decaying tone: a thud when low and short, a gong when it rings. */
function tone(ctx: AudioContext, at: number, frequency: number, length: number, gain: number) {
  const oscillator = ctx.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, at);
  const volume = ctx.createGain();
  volume.gain.setValueAtTime(gain, at);
  volume.gain.exponentialRampToValueAtTime(0.0001, at + length);
  oscillator.connect(volume).connect(ctx.destination);
  oscillator.start(at);
  oscillator.stop(at + length);
}

/** Plays one sound if the visitor has turned sound on. Never throws. */
export function playSound(name: SoundName): void {
  if (!enabled) return;
  try {
    const ctx = audio();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    if (name === 'punch') {
      // Two parts, as a real punch has: the bite, then the release.
      noise(ctx, now, 0.035, 2600, 0.5);
      noise(ctx, now + 0.09, 0.05, 1500, 0.3);
    } else if (name === 'stamp') {
      tone(ctx, now, 110, 0.16, 0.5);
      noise(ctx, now, 0.05, 500, 0.4);
    } else if (name === 'gong') {
      tone(ctx, now, 196, 1.8, 0.28);
      tone(ctx, now, 293.7, 1.3, 0.1);
    } else {
      noise(ctx, now, 0.18, 900, 0.18);
      tone(ctx, now, 520, 0.2, 0.06);
    }
  } catch {
    // Sound is decoration; a failure here must not affect the page.
  }
}
