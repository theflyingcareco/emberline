// Emberline: every tuning number and colour in one place.
// The playfield is a fixed 1280x720 logical area; the renderer scales it to the
// window, so no rule below depends on the screen size.

export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** How many waves make a full run: clear wave 10 and the run is won. */
export const WIN_WAVE = 10;

export const PLAYER = {
  radius: 16,
  accel: 2600,
  maxSpeed: 340,
  drag: 4.5,
  hull: 100,
  fireInterval: 0.16,
  bulletSpeed: 760,
  bulletDamage: 1,
  bulletLife: 1.1,
  novaRadius: 330,
  novaDamage: 3,
  novaCharges: 1,
  novaMaxCharges: 3,
};

/** Contact damage each enemy kind deals, and the score it is worth. */
export const ENEMY = {
  cinder: { radius: 16, hp: 1, speed: 62, damage: 10, score: 10, color: '#e5534b' },
  dart: { radius: 12, hp: 1, speed: 175, damage: 10, score: 15, color: '#b678f0' },
  splitter: { radius: 22, hp: 3, speed: 55, damage: 15, score: 20, color: '#f2a541' },
  mite: { radius: 8, hp: 1, speed: 205, damage: 8, score: 5, color: '#ff8a5c' },
  brute: { radius: 28, hp: 8, speed: 44, damage: 25, score: 40, color: '#c73e6e' },
};

/** What a wave is made of: counts grow with the wave number. */
export function waveComposition(wave) {
  return {
    cinder: 6 + wave * 3,
    dart: wave >= 2 ? 2 + wave : 0,
    splitter: wave >= 3 ? 1 + Math.floor(wave / 2) : 0,
    brute: wave >= 4 ? Math.floor((wave - 2) / 2) : 0,
  };
}

/** Seconds between spawns at wave 1, shrinking as waves go on. */
export function spawnInterval(wave) {
  return Math.max(0.35, 1.05 - wave * 0.07);
}

export const UPGRADES = {
  rapid: { name: 'Rapid Coils', desc: '+25% fire rate', max: 5 },
  twin: { name: 'Twin Barrels', desc: '+1 shot per volley', max: 3 },
  pierce: { name: 'Piercing Rounds', desc: 'Shots pass through +1 enemy', max: 3 },
  hull: { name: 'Reinforced Hull', desc: '+40 max hull, repair 40', max: 5 },
  magnet: { name: 'Magnet Core', desc: 'Embers fly to you from farther away', max: 3 },
  swift: { name: 'Swift Thrusters', desc: '+18% move speed', max: 4 },
  nova: { name: 'Nova Cell', desc: '+1 nova charge (press E)', max: 3 },
  crit: { name: 'Lucky Core', desc: '+10% chance a shot deals double damage', max: 4 },
};

/** Kills in a row without taking a hit raise the score multiplier. */
export const COMBO = { perStep: 8, max: 5 };

export const EMBER = { score: 5, heal: 1, dropChance: 0.3, magnetRadius: 280 };

export const POOLS = { bullets: 128, enemies: 48, particles: 256, pickups: 32, texts: 24 };

export const PALETTE = {
  backdrop: '#070a16',
  skyTop: '#0d1230',
  skyBottom: '#070a16',
  nebulaA: '#3b1d5e',
  nebulaB: '#0e3a4a',
  player: '#4fe3c1',
  playerTrim: '#f2c94c',
  bullet: '#ffd97a',
  text: '#eef1f5',
  muted: '#9aa3b5',
  panel: '#141a2e',
  panelEdge: '#2c3552',
  hull: '#4fe3c1',
  hullLow: '#e5534b',
  ember: '#ffb347',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'emberline.best';
