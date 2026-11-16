// Sound, made in code: every effect is a small WebAudio patch, so the game ships
// no audio files. The audio context is created on the first user gesture (browsers
// refuse sound before one) and stays silent until then. M toggles mute.

export function createAudio() {
  let context = null;
  let master = null;
  let drone = null;
  let muted = false;

  function ensure() {
    if (context !== null) {
      if (context.state === 'suspended') context.resume();
      return true;
    }
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return false;
      context = new Ctor();
      master = context.createGain();
      master.gain.value = 0.35;
      master.connect(context.destination);
      // A low ambient drone under the game: two detuned sines through a slow swell.
      drone = context.createOscillator();
      const drone2 = context.createOscillator();
      const droneGain = context.createGain();
      droneGain.gain.value = 0.045;
      drone.frequency.value = 55;
      drone2.frequency.value = 55.7;
      drone.connect(droneGain);
      drone2.connect(droneGain);
      droneGain.connect(master);
      drone.start();
      drone2.start();
      return true;
    } catch {
      return false;
    }
  }

  function tone(freq, dur, type, vol, slideTo) {
    if (!ensure() || muted) return;
    const now = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), now + dur);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  function noise(dur, vol, filterFreq) {
    if (!ensure() || muted) return;
    const now = context.currentTime;
    const length = Math.max(1, Math.floor(context.sampleRate * dur));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = context.createGain();
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(now);
  }

  return {
    unlock() {
      ensure();
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    shoot() {
      tone(720, 0.07, 'square', 0.08, 340);
    },
    explosion() {
      noise(0.28, 0.5, 900);
      tone(140, 0.22, 'sine', 0.3, 45);
    },
    hit() {
      tone(110, 0.18, 'sawtooth', 0.25, 55);
      noise(0.12, 0.3, 500);
    },
    pickup() {
      tone(880, 0.09, 'sine', 0.14, 1320);
    },
    waveClear() {
      tone(523, 0.14, 'sine', 0.16);
      setTimeout(() => tone(784, 0.2, 'sine', 0.16), 110);
    },
    nova() {
      noise(0.5, 0.5, 2400);
      tone(220, 0.45, 'sine', 0.25, 880);
    },
    win() {
      [523, 659, 784, 1047].forEach((freq, i) => setTimeout(() => tone(freq, 0.3, 'sine', 0.18), i * 130));
    },
    gameOver() {
      [392, 330, 262, 196].forEach((freq, i) => setTimeout(() => tone(freq, 0.32, 'triangle', 0.18), i * 160));
    },
  };
}
