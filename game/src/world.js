// The game's rules and state, with no drawing and no browser in it: the player's
// ship, bullets, enemies, embers, particles and floating text, waves, the upgrade
// draft between waves, score and the combo multiplier. step() advances one fixed
// step and returns what happened as bit flags, so the caller can react (sounds,
// announcements) without the world knowing about screens or sound. Nothing here
// allocates after createWorld returns: every pool is filled once, at boot.

import {
  COMBO,
  EMBER,
  ENEMY,
  FIELD,
  PLAYER,
  POOLS,
  UPGRADES,
  WIN_WAVE,
  spawnInterval,
  waveComposition,
} from './config.js';

export const KIND_CINDER = 'cinder';
export const KIND_DART = 'dart';
export const KIND_SPLITTER = 'splitter';
export const KIND_MITE = 'mite';
export const KIND_BRUTE = 'brute';

export const EVENT_HIT = 1;
export const EVENT_KILL = 2;
export const EVENT_PICKUP = 4;
export const EVENT_WAVE_CLEAR = 8;
export const EVENT_OVER = 16;
export const EVENT_WIN = 32;
export const EVENT_NOVA = 64;
export const EVENT_SHOOT = 128;

const TWO_PI = Math.PI * 2;

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function createWorld(random) {
  const player = {
    x: FIELD.width / 2,
    y: FIELD.height / 2,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    hull: PLAYER.hull,
    maxHull: PLAYER.hull,
    fireTimer: 0,
    novaCharges: PLAYER.novaCharges,
    speed: PLAYER.maxSpeed,
    fireRate: 1,
    projectiles: 1,
    pierce: 0,
    crit: 0,
    magnet: 1,
  };
  const bullets = [];
  for (let i = 0; i < POOLS.bullets; i += 1) bullets.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, damage: 1, pierce: 0, life: 0 });
  const enemies = [];
  for (let i = 0; i < POOLS.enemies; i += 1) enemies.push({ active: false, kind: KIND_CINDER, x: 0, y: 0, vx: 0, vy: 0, hp: 1, maxHp: 1, radius: 16, speed: 60, damage: 10, score: 10, age: 0, seed: 0, drift: false });
  const particles = [];
  for (let i = 0; i < POOLS.particles; i += 1) particles.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 2, color: '#fff' });
  const pickups = [];
  for (let i = 0; i < POOLS.pickups; i += 1) pickups.push({ active: false, x: 0, y: 0, vx: 0, vy: 0 });
  const texts = [];
  for (let i = 0; i < POOLS.texts; i += 1) texts.push({ active: false, x: 0, y: 0, life: 0, text: '', color: '#fff' });

  const state = {
    player,
    bullets,
    enemies,
    particles,
    pickups,
    texts,
    score: 0,
    best: 0,
    combo: 0,
    multiplier: 1,
    wave: 1,
    phase: 'fight', // fight | draft | won | over
    spawnQueue: [],
    spawnTimer: 0,
    kills: 0,
    elapsed: 0,
    shake: 0,
    draft: [],
    taken: {},
    hintTimer: 6,
  };

  function free(pool) {
    for (let i = 0; i < pool.length; i += 1) if (!pool[i].active) return pool[i];
    return null;
  }

  function burst(x, y, color, count, speed) {
    for (let i = 0; i < count; i += 1) {
      const p = free(particles);
      if (p === null) return;
      const angle = random() * TWO_PI;
      const v = speed * (0.3 + random() * 0.7);
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * v;
      p.vy = Math.sin(angle) * v;
      p.maxLife = 0.35 + random() * 0.4;
      p.life = p.maxLife;
      p.size = 2 + random() * 3;
      p.color = color;
    }
  }

  function floatText(x, y, text, color) {
    const t = free(texts);
    if (t === null) return;
    t.active = true;
    t.x = x;
    t.y = y;
    t.life = 0.9;
    t.text = text;
    t.color = color;
  }

  function reset() {
    player.x = FIELD.width / 2;
    player.y = FIELD.height / 2;
    player.vx = 0;
    player.vy = 0;
    player.angle = -Math.PI / 2;
    player.hull = PLAYER.hull;
    player.maxHull = PLAYER.hull;
    player.fireTimer = 0;
    player.novaCharges = PLAYER.novaCharges;
    player.speed = PLAYER.maxSpeed;
    player.fireRate = 1;
    player.projectiles = 1;
    player.pierce = 0;
    player.crit = 0;
    player.magnet = 1;
    for (const b of bullets) b.active = false;
    for (const e of enemies) e.active = false;
    for (const p of particles) p.active = false;
    for (const p of pickups) p.active = false;
    for (const t of texts) t.active = false;
    state.score = 0;
    state.combo = 0;
    state.multiplier = 1;
    state.wave = 1;
    state.phase = 'fight';
    state.kills = 0;
    state.elapsed = 0;
    state.shake = 0;
    state.draft = [];
    state.taken = {};
    state.hintTimer = 6;
    startWave(1);
  }

  function startWave(wave) {
    const comp = waveComposition(wave);
    const queue = [];
    for (const kind of [KIND_CINDER, KIND_DART, KIND_SPLITTER, KIND_BRUTE]) {
      for (let i = 0; i < comp[kind]; i += 1) queue.push(kind);
    }
    // Shuffle the queue so the wave never arrives in kind order.
    for (let i = queue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const tmp = queue[i];
      queue[i] = queue[j];
      queue[j] = tmp;
    }
    state.spawnQueue = queue;
    state.spawnTimer = 0.8;
    state.phase = 'fight';
  }

  function spawnEnemy(kind, drift) {
    const e = free(enemies);
    if (e === null) return;
    const def = ENEMY[kind];
    // Enter from a random edge, never on top of the player.
    const edge = Math.floor(random() * 4);
    if (edge === 0) { e.x = random() * FIELD.width; e.y = -def.radius; }
    else if (edge === 1) { e.x = random() * FIELD.width; e.y = FIELD.height + def.radius; }
    else if (edge === 2) { e.x = -def.radius; e.y = random() * FIELD.height; }
    else { e.x = FIELD.width + def.radius; e.y = random() * FIELD.height; }
    e.active = true;
    e.kind = kind;
    e.hp = def.hp;
    e.maxHp = def.hp;
    e.radius = def.radius;
    e.speed = def.speed * (1 + (state.wave - 1) * 0.04);
    e.damage = def.damage;
    e.score = def.score;
    e.age = 0;
    e.seed = random() * TWO_PI;
    e.vx = 0;
    e.vy = 0;
    e.drift = drift === true;
  }

  function dropEmber(x, y) {
    if (random() > EMBER.dropChance) return;
    const p = free(pickups);
    if (p === null) return;
    p.active = true;
    p.x = x;
    p.y = y;
    const angle = random() * TWO_PI;
    p.vx = Math.cos(angle) * 40;
    p.vy = Math.sin(angle) * 40;
  }

  function killEnemy(e, award) {
    e.active = false;
    state.kills += 1;
    burst(e.x, e.y, ENEMY[e.kind].color, e.kind === KIND_BRUTE ? 22 : 10, 190);
    if (e.kind === KIND_SPLITTER) {
      for (let i = 0; i < 2; i += 1) {
        const m = free(enemies);
        if (m === null) break;
        const def = ENEMY.mite;
        m.active = true;
        m.kind = KIND_MITE;
        m.x = e.x + (random() - 0.5) * 30;
        m.y = e.y + (random() - 0.5) * 30;
        m.hp = def.hp;
        m.maxHp = def.hp;
        m.radius = def.radius;
        m.speed = def.speed;
        m.damage = def.damage;
        m.score = def.score;
        m.age = 0;
        m.seed = random() * TWO_PI;
        m.drift = false;
      }
    }
    if (award) {
      state.combo += 1;
      state.multiplier = Math.min(COMBO.max, 1 + Math.floor(state.combo / COMBO.perStep));
      const gained = e.score * state.multiplier;
      state.score += gained;
      floatText(e.x, e.y - e.radius, `+${gained}`, '#ffd97a');
      dropEmber(e.x, e.y);
    }
  }

  function offerDraft() {
    const ids = Object.keys(UPGRADES).filter((id) => (state.taken[id] || 0) < UPGRADES[id].max);
    const draft = [];
    while (draft.length < 3 && ids.length > 0) {
      const index = Math.floor(random() * ids.length);
      draft.push(ids.splice(index, 1)[0]);
    }
    state.draft = draft;
    state.phase = 'draft';
  }

  /** Apply one of the offered upgrades, then start the next wave. */
  function chooseUpgrade(index) {
    const id = state.draft[index];
    if (id === undefined) return false;
    state.taken[id] = (state.taken[id] || 0) + 1;
    if (id === 'rapid') player.fireRate *= 1.25;
    else if (id === 'twin') player.projectiles += 1;
    else if (id === 'pierce') player.pierce += 1;
    else if (id === 'hull') {
      player.maxHull += 40;
      player.hull = Math.min(player.maxHull, player.hull + 40);
    } else if (id === 'magnet') player.magnet += 1;
    else if (id === 'swift') player.speed *= 1.18;
    else if (id === 'nova') player.novaCharges = Math.min(PLAYER.novaMaxCharges, player.novaCharges + 1);
    else if (id === 'crit') player.crit += 0.1;
    state.draft = [];
    state.wave += 1;
    startWave(state.wave);
    return true;
  }

  function fireBullet(angle) {
    const b = free(bullets);
    if (b === null) return;
    b.active = true;
    b.x = player.x + Math.cos(angle) * (PLAYER.radius + 6);
    b.y = player.y + Math.sin(angle) * (PLAYER.radius + 6);
    b.vx = Math.cos(angle) * PLAYER.bulletSpeed;
    b.vy = Math.sin(angle) * PLAYER.bulletSpeed;
    b.damage = random() < player.crit ? PLAYER.bulletDamage * 2 : PLAYER.bulletDamage;
    b.pierce = player.pierce;
    b.life = PLAYER.bulletLife;
  }

  function fireNova() {
    if (player.novaCharges <= 0) return 0;
    player.novaCharges -= 1;
    let events = EVENT_NOVA;
    burst(player.x, player.y, '#ffd97a', 40, 420);
    state.shake = 10;
    for (const e of enemies) {
      if (!e.active) continue;
      if (dist2(e.x, e.y, player.x, player.y) > PLAYER.novaRadius * PLAYER.novaRadius) continue;
      e.hp -= PLAYER.novaDamage;
      if (e.hp <= 0) {
        killEnemy(e, true);
        events |= EVENT_KILL;
      }
    }
    return events;
  }

  function damagePlayer(amount, x, y) {
    player.hull -= amount;
    state.combo = 0;
    state.multiplier = 1;
    state.shake = 8;
    burst(x, y, '#4fe3c1', 12, 160);
    if (player.hull <= 0) {
      player.hull = 0;
      state.phase = 'over';
      burst(player.x, player.y, '#4fe3c1', 46, 320);
      return EVENT_HIT | EVENT_OVER;
    }
    return EVENT_HIT;
  }

  /**
   * One fixed step of play. `input` is { moveX, moveY, aimX, aimY, firing, nova }.
   * With `harmless` set (the title screen's backdrop) things drift but nothing
   * touches the player and nothing scores.
   */
  function step(dt, input, harmless) {
    let events = 0;
    state.elapsed += dt;
    if (state.hintTimer > 0) state.hintTimer -= dt;
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 30);

    // The player: accelerate toward the held direction, drag when idle, stay in the field.
    const mx = input.moveX;
    const my = input.moveY;
    const len = Math.hypot(mx, my);
    if (len > 0) {
      player.vx += (mx / len) * PLAYER.accel * dt;
      player.vy += (my / len) * PLAYER.accel * dt;
    }
    const damp = Math.max(0, 1 - PLAYER.drag * dt);
    player.vx *= damp;
    player.vy *= damp;
    const speed = Math.hypot(player.vx, player.vy);
    if (speed > player.speed) {
      player.vx = (player.vx / speed) * player.speed;
      player.vy = (player.vy / speed) * player.speed;
    }
    player.x = Math.min(FIELD.width - PLAYER.radius, Math.max(PLAYER.radius, player.x + player.vx * dt));
    player.y = Math.min(FIELD.height - PLAYER.radius, Math.max(PLAYER.radius, player.y + player.vy * dt));
    player.angle = Math.atan2(input.aimY - player.y, input.aimX - player.x);

    if (!harmless && input.nova) events |= fireNova();

    // Firing: a volley spreads evenly around the aim angle.
    player.fireTimer -= dt;
    if (!harmless && input.firing && player.fireTimer <= 0) {
      const interval = PLAYER.fireInterval / player.fireRate;
      player.fireTimer += interval;
      const spread = 0.14;
      const n = player.projectiles;
      for (let i = 0; i < n; i += 1) {
        const offset = n === 1 ? 0 : (i - (n - 1) / 2) * spread;
        fireBullet(player.angle + offset);
      }
      events |= EVENT_SHOOT;
    }

    // Spawning, one at a time from the wave's queue.
    if (!harmless && state.phase === 'fight' && state.spawnQueue.length > 0) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        spawnEnemy(state.spawnQueue.shift());
        state.spawnTimer += spawnInterval(state.wave);
      }
    }
    // The title screen's backdrop: a few embers drift down, never fighting.
    if (harmless) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        spawnEnemy(random() < 0.6 ? KIND_CINDER : KIND_DART, true);
        state.spawnTimer += 1.1;
      }
    }

    // Bullets fly straight and die off the field or when their life ends.
    for (const b of bullets) {
      if (!b.active) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < -20 || b.x > FIELD.width + 20 || b.y < -20 || b.y > FIELD.height + 20) b.active = false;
    }

    // Enemies steer at the player (darts weave), then drift. Backdrop drifters
    // on the title screen only fall straight down and fade out at the bottom.
    for (const e of enemies) {
      if (!e.active) continue;
      e.age += dt;
      if (e.drift) {
        e.y += e.speed * 0.5 * dt;
        if (e.y > FIELD.height + 50) e.active = false;
        continue;
      }
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      let ax = dx / d;
      let ay = dy / d;
      if (e.kind === KIND_DART) {
        const weave = Math.sin(e.age * 6 + e.seed) * 0.9;
        const px = -ay;
        const py = ax;
        ax += px * weave;
        ay += py * weave;
        const al = Math.hypot(ax, ay) || 1;
        ax /= al;
        ay /= al;
      }
      e.vx = ax * e.speed;
      e.vy = ay * e.speed;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      // Keep them inside the field once they have entered it.
      e.x = Math.min(FIELD.width + 40, Math.max(-40, e.x));
      e.y = Math.min(FIELD.height + 40, Math.max(-40, e.y));
    }

    // Enemies keep a little room from each other instead of stacking.
    for (let i = 0; i < enemies.length; i += 1) {
      const a = enemies[i];
      if (!a.active) continue;
      for (let j = i + 1; j < enemies.length; j += 1) {
        const b = enemies[j];
        if (!b.active) continue;
        const min = a.radius + b.radius;
        const d2 = dist2(a.x, a.y, b.x, b.y);
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) / 2;
        const nx = (a.x - b.x) / d;
        const ny = (a.y - b.y) / d;
        a.x += nx * push;
        a.y += ny * push;
        b.x -= nx * push;
        b.y -= ny * push;
      }
    }

    // Bullets against enemies.
    for (const b of bullets) {
      if (!b.active) continue;
      for (const e of enemies) {
        if (!e.active) continue;
        const rr = e.radius + 4;
        if (dist2(b.x, b.y, e.x, e.y) > rr * rr) continue;
        e.hp -= b.damage;
        burst(b.x, b.y, '#ffd97a', 3, 90);
        if (e.hp <= 0) {
          killEnemy(e, !harmless);
          events |= EVENT_KILL;
        }
        if (b.pierce > 0) {
          b.pierce -= 1;
        } else {
          b.active = false;
        }
        break;
      }
    }

    // Enemies against the player.
    if (!harmless) {
      for (const e of enemies) {
        if (!e.active) continue;
        const rr = e.radius + PLAYER.radius - 2;
        if (dist2(e.x, e.y, player.x, player.y) > rr * rr) continue;
        const dmg = e.damage;
        const ex = e.x;
        const ey = e.y;
        if (e.kind !== KIND_BRUTE) {
          e.active = false;
          burst(ex, ey, ENEMY[e.kind].color, 8, 140);
        } else {
          e.hp -= 2;
          if (e.hp <= 0) {
            killEnemy(e, true);
            events |= EVENT_KILL;
          }
        }
        events |= damagePlayer(dmg, ex, ey);
        if (events & EVENT_OVER) break;
      }
    }

    // Embers drift, then fly to the player when the magnet reaches them.
    const magnetR = EMBER.magnetRadius * player.magnet;
    for (const p of pickups) {
      if (!p.active) continue;
      const d2 = dist2(p.x, p.y, player.x, player.y);
      if (!harmless && d2 < magnetR * magnetR) {
        const d = Math.sqrt(d2) || 1;
        const pull = 520 * (1 - d / (magnetR + 1));
        p.vx += ((player.x - p.x) / d) * pull * dt * 4;
        p.vy += ((player.y - p.y) / d) * pull * dt * 4;
      } else {
        p.vx *= Math.max(0, 1 - 2 * dt);
        p.vy *= Math.max(0, 1 - 2 * dt);
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (!harmless && d2 < 30 * 30) {
        p.active = false;
        state.score += EMBER.score * state.multiplier;
        player.hull = Math.min(player.maxHull, player.hull + EMBER.heal);
        events |= EVENT_PICKUP;
      }
    }

    // Particles fade; floating texts rise and fade.
    for (const p of particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.max(0, 1 - 3 * dt);
      p.vy *= Math.max(0, 1 - 3 * dt);
    }
    for (const t of texts) {
      if (!t.active) continue;
      t.life -= dt;
      t.y -= 34 * dt;
      if (t.life <= 0) t.active = false;
    }

    // Wave cleared: nothing left to spawn and nothing alive.
    if (!harmless && state.phase === 'fight' && state.spawnQueue.length === 0) {
      let alive = false;
      for (const e of enemies) if (e.active) { alive = true; break; }
      if (!alive) {
        if (state.wave >= WIN_WAVE) {
          state.phase = 'won';
          events |= EVENT_WIN;
        } else {
          offerDraft();
          events |= EVENT_WAVE_CLEAR;
        }
      }
    }
    return events;
  }

  reset();
  return { state, reset, step, chooseUpgrade, startWave };
}
