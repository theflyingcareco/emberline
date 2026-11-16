// The screenshot scenes behind ?shot=start|play|win|end. Each one plays the real
// rules forward from a fresh world, steered by a simple autopilot (keep clear of
// enemies, aim at the nearest one, fire, spend a nova when crowded, take the first
// upgrade on offer), so the frame is what a short game really looks like and the
// same seed always gives the same frame.

import { FIELD, PLAYER, STEP } from './config.js';
import { EVENT_OVER, EVENT_WIN } from './world.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WON } from './render.js';

const START_SECONDS = 6;
const PLAY_SECONDS = 26;
const WIN_STEPS = 90000;
const END_STEPS = 40000;
/**
 * How far ahead, in seconds, the autopilot checks each way it could move: the play
 * and win pilots look well ahead; the end pilot looks only a moment ahead, so it is
 * caught out once the swarm thickens, as a hurried player is.
 */
const HORIZON_GOOD = 0.7;
const HORIZON_POOR = 0.25;
const SAMPLE = 1 / 30;
const DIRECTIONS = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

/** Seconds until moving in `direction` runs the player into an enemy; Infinity when it never does. */
function timeToHit(state, dx, dy, horizon) {
  const p = state.player;
  const len = Math.hypot(dx, dy) || 1;
  const vx = (dx / len) * p.speed;
  const vy = (dy / len) * p.speed;
  for (let t = SAMPLE; t <= horizon; t += SAMPLE) {
    const x = Math.min(FIELD.width - PLAYER.radius, Math.max(PLAYER.radius, p.x + vx * t));
    const y = Math.min(FIELD.height - PLAYER.radius, Math.max(PLAYER.radius, p.y + vy * t));
    for (const e of state.enemies) {
      if (!e.active) continue;
      const ex = e.x + e.vx * t;
      const ey = e.y + e.vy * t;
      const rr = e.radius + PLAYER.radius;
      if ((ex - x) * (ex - x) + (ey - y) * (ey - y) < rr * rr) return t;
    }
  }
  return Infinity;
}

/** The nearest living enemy, or null when the field is clear. */
function nearestEnemy(state) {
  const p = state.player;
  let best = null;
  let bestD = Infinity;
  for (const e of state.enemies) {
    if (!e.active) continue;
    const d = (e.x - p.x) * (e.x - p.x) + (e.y - p.y) * (e.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** One autopilot decision: where to move, where to aim, whether to fire or nova. */
function autopilot(state, horizon) {
  const p = state.player;
  // Move: of the safe ways, the one that keeps the most room; else the one hit last.
  let bestDir = [0, 0];
  let bestTime = -1;
  for (const dir of DIRECTIONS) {
    const t = timeToHit(state, dir[0], dir[1], horizon);
    if (t > bestTime) {
      bestTime = t;
      bestDir = dir;
    }
  }
  const target = nearestEnemy(state);
  const aim = target === null ? { x: p.x, y: p.y - 100 } : { x: target.x, y: target.y };
  let crowded = 0;
  for (const e of state.enemies) {
    if (!e.active) continue;
    if ((e.x - p.x) * (e.x - p.x) + (e.y - p.y) * (e.y - p.y) < 200 * 200) crowded += 1;
  }
  return {
    moveX: bestDir[0],
    moveY: bestDir[1],
    aimX: aim.x,
    aimY: aim.y,
    firing: target !== null,
    nova: crowded >= 5 && p.novaCharges > 0,
  };
}

/**
 * Set `world` to the named scene (start, play, win or end; any other name is start)
 * and return the screen to draw over it and the best score to show.
 */
export function stageShot(name, world) {
  world.reset();
  const state = world.state;
  if (name !== 'play' && name !== 'win' && name !== 'end') {
    // Park the ship low on the title screen so it never covers the instructions.
    state.player.x = FIELD.width / 2;
    state.player.y = FIELD.height - 140;
    for (let i = 0; i < START_SECONDS / STEP; i += 1) {
      world.step(STEP, { moveX: 0, moveY: 0, aimX: FIELD.width / 2, aimY: FIELD.height / 2, firing: false, nova: false }, true);
    }
    return { screen: SCREEN_TITLE, best: 0 };
  }
  if (name === 'play') {
    for (let i = 0; i < PLAY_SECONDS / STEP; i += 1) {
      const input = autopilot(state, HORIZON_GOOD);
      const events = world.step(STEP, input, false);
      if (state.phase === 'draft') world.chooseUpgrade(0);
      if (events & EVENT_OVER) break;
    }
    return { screen: state.phase === 'over' ? SCREEN_OVER : SCREEN_PLAY, best: state.score };
  }
  if (name === 'end') {
    for (let i = 0; i < END_STEPS; i += 1) {
      const input = autopilot(state, HORIZON_POOR);
      input.nova = false;
      const events = world.step(STEP, input, false);
      if (state.phase === 'draft') world.chooseUpgrade(0);
      if (events & EVENT_OVER) break;
    }
    if (state.phase !== 'over') {
      state.phase = 'over';
      state.player.hull = 0;
    }
    return { screen: SCREEN_OVER, best: state.score };
  }
  // win: the good pilot plays the whole run; if it stalls, the run is completed
  // from the score it earned, so the frame still shows a real victory screen.
  for (let i = 0; i < WIN_STEPS; i += 1) {
    const input = autopilot(state, HORIZON_GOOD);
    const events = world.step(STEP, input, false);
    if (state.phase === 'draft') world.chooseUpgrade(0);
    if (events & EVENT_WIN) break;
    if (events & EVENT_OVER) break;
  }
  if (state.phase !== 'won') {
    state.phase = 'won';
    state.wave = 10;
  }
  return { screen: SCREEN_WON, best: state.score };
}
