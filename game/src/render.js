// Drawing only: the world's state and the current screen in, pixels out. The 1280x720
// playfield is scaled to fit the window and centred, the margin filled with the
// backdrop colour. Canvas shapes and text throughout: no image files, so the art is
// the code. Text that holds a number is rebuilt only when the number changes, so a
// frame allocates nothing.

import { EMBER, ENEMY, FIELD, FONT, PALETTE, UPGRADES, WIN_WAVE } from './config.js';
import { KIND_BRUTE, KIND_CINDER, KIND_DART, KIND_MITE, KIND_SPLITTER } from './world.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_DRAFT = 'draft';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_WON = 'won';

/** The draft cards' geometry, in field coordinates: the main loop hit-tests clicks here. */
export const DRAFT = { width: 300, height: 250, gap: 24, y: 250 };

export function draftCardRects() {
  const total = DRAFT.width * 3 + DRAFT.gap * 2;
  const x0 = (FIELD.width - total) / 2;
  return [0, 1, 2].map((i) => ({
    x: x0 + i * (DRAFT.width + DRAFT.gap),
    y: DRAFT.y,
    width: DRAFT.width,
    height: DRAFT.height,
  }));
}

function cachedLabel(prefix) {
  let value = -1;
  let text = '';
  return function label(next) {
    if (next !== value) {
      value = next;
      text = prefix + next;
    }
    return text;
  };
}

function starPoints(seed, count, minR, maxR) {
  const pts = [];
  let a = seed;
  for (let i = 0; i < count; i += 1) {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const r1 = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    a = (a + 0x6d2b79f5) | 0;
    t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const r2 = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    pts.push({ x: r1 * FIELD.width, y: r2 * FIELD.height, r: minR + r1 * (maxR - minR), tw: r2 * 6.28 });
  }
  return pts;
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const scoreLabel = cachedLabel('SCORE ');
  const bestLabel = cachedLabel('BEST ');
  const waveLabel = cachedLabel('WAVE ');
  const finalLabel = cachedLabel('SCORE ');
  const finalBestLabel = cachedLabel('BEST ');
  const stars = [starPoints(11, 90, 0.6, 1.4), starPoints(77, 60, 1.0, 2.0), starPoints(131, 30, 1.4, 2.6)];
  let time = 0;

  // The nebula is painted once to an offscreen canvas and blitted every frame.
  const nebula = document.createElement('canvas');
  nebula.width = FIELD.width;
  nebula.height = FIELD.height;
  {
    const n = nebula.getContext('2d');
    n.fillStyle = PALETTE.skyTop;
    n.fillRect(0, 0, FIELD.width, FIELD.height);
    const blobs = [
      [300, 170, 340, PALETTE.nebulaA, 0.5],
      [1020, 520, 380, PALETTE.nebulaB, 0.45],
      [760, 120, 260, PALETTE.nebulaB, 0.35],
      [180, 560, 280, PALETTE.nebulaA, 0.35],
    ];
    for (const [x, y, r, color, alpha] of blobs) {
      const g = n.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      n.globalAlpha = alpha;
      n.fillStyle = g;
      n.fillRect(x - r, y - r, r * 2, r * 2);
    }
    n.globalAlpha = 1;
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  const fonts = new Map();
  function text(value, x, y, size, color, align) {
    if (!fonts.has(size)) fonts.set(size, `${size}px ${FONT}`);
    context.font = fonts.get(size);
    context.fillStyle = color;
    context.textAlign = align;
    context.fillText(value, x, y);
  }

  function rrect(x, y, w, h, r) {
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + w, y, x + w, y + h, r);
    context.arcTo(x + w, y + h, x, y + h, r);
    context.arcTo(x, y + h, x, y, r);
    context.arcTo(x, y, x + w, y, r);
    context.closePath();
  }

  function drawBackground(dt) {
    time += dt;
    context.drawImage(nebula, 0, 0);
    // Three star layers drift down at different speeds and twinkle.
    for (let layer = 0; layer < 3; layer += 1) {
      const speed = 6 + layer * 12;
      context.fillStyle = layer === 2 ? '#dfe6ff' : '#aab4d4';
      for (const s of stars[layer]) {
        const y = (s.y + time * speed) % FIELD.height;
        const alpha = 0.45 + 0.4 * Math.sin(time * 1.5 + s.tw);
        context.globalAlpha = alpha;
        context.beginPath();
        context.arc(s.x, y, s.r, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.globalAlpha = 1;
  }

  function poly(points) {
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) context.lineTo(points[i][0], points[i][1]);
    context.closePath();
  }

  function drawEnemy(e) {
    const def = ENEMY[e.kind];
    context.fillStyle = def.color;
    context.strokeStyle = 'rgba(255,255,255,0.25)';
    context.lineWidth = 1.5;
    if (e.kind === KIND_CINDER) {
      // A jagged rock: seven points, each pulled in or out by the enemy's own seed.
      const pts = [];
      for (let i = 0; i < 7; i += 1) {
        const a = (i / 7) * Math.PI * 2 + e.seed;
        const r = e.radius * (0.75 + 0.25 * Math.abs(Math.sin(e.seed * 3 + i * 2.1)));
        pts.push([e.x + Math.cos(a) * r, e.y + Math.sin(a) * r]);
      }
      poly(pts);
      context.fill();
      context.stroke();
    } else if (e.kind === KIND_DART) {
      const a = Math.atan2(e.vy, e.vx);
      const c = Math.cos(a);
      const s = Math.sin(a);
      const nose = [e.x + c * e.radius * 1.4, e.y + s * e.radius * 1.4];
      const left = [e.x - c * e.radius + -s * e.radius * 0.8, e.y - s * e.radius + c * e.radius * 0.8];
      const right = [e.x - c * e.radius + s * e.radius * 0.8, e.y - s * e.radius - c * e.radius * 0.8];
      poly([nose, left, right]);
      context.fill();
    } else if (e.kind === KIND_SPLITTER) {
      const pts = [];
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2 + e.age * 0.8;
        pts.push([e.x + Math.cos(a) * e.radius, e.y + Math.sin(a) * e.radius]);
      }
      poly(pts);
      context.fill();
      context.stroke();
      context.fillStyle = '#fff3c4';
      context.beginPath();
      context.arc(e.x, e.y, e.radius * 0.32 * (1 + 0.15 * Math.sin(e.age * 5)), 0, Math.PI * 2);
      context.fill();
    } else if (e.kind === KIND_MITE) {
      const a = Math.atan2(e.vy, e.vx);
      const c = Math.cos(a);
      const s = Math.sin(a);
      poly([
        [e.x + c * e.radius * 1.5, e.y + s * e.radius * 1.5],
        [e.x - c * e.radius + -s * e.radius, e.y - s * e.radius + c * e.radius],
        [e.x - c * e.radius + s * e.radius, e.y - s * e.radius - c * e.radius],
      ]);
      context.fill();
    } else if (e.kind === KIND_BRUTE) {
      const pts = [];
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2 + e.age * 0.3;
        const r = e.radius * (0.85 + 0.15 * Math.sin(e.seed + i));
        pts.push([e.x + Math.cos(a) * r, e.y + Math.sin(a) * r]);
      }
      poly(pts);
      context.fill();
      context.stroke();
      context.fillStyle = '#ffd97a';
      context.beginPath();
      context.arc(e.x, e.y, e.radius * 0.3, 0, Math.PI * 2);
      context.fill();
    }
    // A hurt tough enemy shows its remaining hull.
    if (e.maxHp > 1 && e.hp < e.maxHp) {
      const w = e.radius * 2;
      context.fillStyle = 'rgba(0,0,0,0.5)';
      context.fillRect(e.x - w / 2, e.y - e.radius - 12, w, 5);
      context.fillStyle = '#ffd97a';
      context.fillRect(e.x - w / 2, e.y - e.radius - 12, w * (e.hp / e.maxHp), 5);
    }
  }

  function drawPlayer(p, dt) {
    const c = Math.cos(p.angle);
    const s = Math.sin(p.angle);
    // Engine flame, flickering.
    const flame = 14 + Math.sin(time * 40) * 5 + Math.hypot(p.vx, p.vy) * 0.02;
    context.fillStyle = '#ff9d45';
    poly([
      [p.x - c * 14 + -s * 7, p.y - s * 14 + c * 7],
      [p.x - c * (14 + flame), p.y - s * (14 + flame)],
      [p.x - c * 14 + s * 7, p.y - s * 14 - c * 7],
    ]);
    context.fill();
    // Hull: a sleek arrow with gold trim.
    context.fillStyle = PALETTE.player;
    poly([
      [p.x + c * 22, p.y + s * 22],
      [p.x - c * 14 + -s * 12, p.y - s * 14 + c * 12],
      [p.x - c * 6, p.y - s * 6],
      [p.x - c * 14 + s * 12, p.y - s * 14 - c * 12],
    ]);
    context.fill();
    context.strokeStyle = PALETTE.playerTrim;
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = '#0b2b26';
    context.beginPath();
    context.arc(p.x + c * 6, p.y + s * 6, 4.5, 0, Math.PI * 2);
    context.fill();
  }

  function drawField(state, dt) {
    drawBackground(dt);
    // Embers: small gold diamonds that pulse.
    for (const p of state.pickups) {
      if (!p.active) continue;
      const r = 7 + Math.sin(time * 6 + p.x) * 1.5;
      context.fillStyle = PALETTE.ember;
      poly([
        [p.x, p.y - r],
        [p.x + r * 0.7, p.y],
        [p.x, p.y + r],
        [p.x - r * 0.7, p.y],
      ]);
      context.fill();
    }
    for (const e of state.enemies) if (e.active) drawEnemy(e);
    // Bullets glow: a soft halo, then a bright core.
    context.globalCompositeOperation = 'lighter';
    for (const b of state.bullets) {
      if (!b.active) continue;
      context.fillStyle = 'rgba(255,217,122,0.35)';
      context.beginPath();
      context.arc(b.x, b.y, 9, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#fff3c4';
      context.beginPath();
      context.arc(b.x, b.y, 3.5, 0, Math.PI * 2);
      context.fill();
    }
    // Particles, additive, fading with their life.
    for (const p of state.particles) {
      if (!p.active) continue;
      context.globalAlpha = Math.max(0, p.life / p.maxLife);
      context.fillStyle = p.color;
      context.beginPath();
      context.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    drawPlayer(state.player, dt);
    // Floating score text.
    context.textBaseline = 'alphabetic';
    for (const t of state.texts) {
      if (!t.active) continue;
      context.globalAlpha = Math.max(0, t.life / 0.9);
      text(t.text, t.x, t.y, 17, t.color, 'center');
    }
    context.globalAlpha = 1;
  }

  function drawHullBar(state) {
    const x = FIELD.width - 244;
    const y = 22;
    const w = 200;
    const h = 18;
    context.fillStyle = 'rgba(0,0,0,0.55)';
    rrect(x - 4, y - 4, w + 8, h + 8, 6);
    context.fill();
    const ratio = state.player.hull / state.player.maxHull;
    context.fillStyle = ratio < 0.3 ? PALETTE.hullLow : PALETTE.hull;
    rrect(x, y, w * ratio, h, 4);
    context.fill();
    // The value sits left of the bar, in light text, so it reads at any hull level.
    text(`${Math.ceil(state.player.hull)} / ${state.player.maxHull}`, x - 12, y + 14, 14, PALETTE.text, 'right');
    // Nova charges as small diamonds under the bar.
    for (let i = 0; i < 3; i += 1) {
      const cx = x + 12 + i * 22;
      const cy = y + 36;
      context.fillStyle = i < state.player.novaCharges ? '#ffd97a' : 'rgba(255,255,255,0.18)';
      poly([[cx, cy - 7], [cx + 7, cy], [cx, cy + 7], [cx - 7, cy]]);
      context.fill();
    }
    text('NOVA [E]', x + 84, y + 41, 13, PALETTE.muted, 'left');
  }

  function drawHud(state, best) {
    context.textBaseline = 'top';
    text(scoreLabel(state.score), 24, 18, 28, PALETTE.text, 'left');
    text(bestLabel(best), 24, 50, 16, PALETTE.muted, 'left');
    if (state.multiplier > 1) text(`x${state.multiplier} COMBO`, 24, 74, 18, '#ffd97a', 'left');
    text(waveLabel(`${state.wave} / ${WIN_WAVE}`), FIELD.width / 2, 18, 28, PALETTE.text, 'center');
    let left = state.spawnQueue.length;
    for (const e of state.enemies) if (e.active) left += 1;
    text(`ENEMIES ${left}`, FIELD.width / 2, 50, 16, PALETTE.muted, 'center');
    drawHullBar(state);
    if (state.hintTimer > 0) {
      context.globalAlpha = Math.min(1, state.hintTimer);
      text('WASD or arrows to move · Mouse to aim · Hold click or Space to fire · E for nova · P to pause', FIELD.width / 2, FIELD.height - 34, 17, PALETTE.muted, 'center');
      context.globalAlpha = 1;
    }
  }

  function drawAim(aim) {
    if (aim === null) return;
    context.strokeStyle = 'rgba(238,241,245,0.65)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(aim.x, aim.y, 11, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(aim.x - 16, aim.y);
    context.lineTo(aim.x - 6, aim.y);
    context.moveTo(aim.x + 6, aim.y);
    context.lineTo(aim.x + 16, aim.y);
    context.moveTo(aim.x, aim.y - 16);
    context.lineTo(aim.x, aim.y - 6);
    context.moveTo(aim.x, aim.y + 6);
    context.lineTo(aim.x, aim.y + 16);
    context.stroke();
  }

  function drawPanel(title, lines, prompt, titleSize) {
    const width = 640;
    const lineH = 32;
    const height = 150 + lines.length * lineH + 56;
    const x = (FIELD.width - width) / 2;
    const y = (FIELD.height - height) / 2;
    context.fillStyle = PALETTE.panel;
    rrect(x, y, width, height, 14);
    context.fill();
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    context.stroke();
    context.textBaseline = 'alphabetic';
    text(title, FIELD.width / 2, y + 74, titleSize || 46, PALETTE.text, 'center');
    for (let i = 0; i < lines.length; i += 1) {
      text(lines[i], FIELD.width / 2, y + 128 + i * lineH, 20, PALETTE.muted, 'center');
    }
    text(prompt, FIELD.width / 2, y + height - 30, 22, '#ffd97a', 'center');
  }

  function drawDraft(state, mouse) {
    context.fillStyle = 'rgba(4,6,14,0.72)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    context.textBaseline = 'alphabetic';
    text('WAVE CLEARED', FIELD.width / 2, 150, 52, PALETTE.text, 'center');
    text('Choose one upgrade — click it, or press 1, 2 or 3', FIELD.width / 2, 196, 20, PALETTE.muted, 'center');
    const rects = draftCardRects();
    for (let i = 0; i < state.draft.length; i += 1) {
      const id = state.draft[i];
      const up = UPGRADES[id];
      const r = rects[i];
      const hover = mouse !== null && mouse.x >= r.x && mouse.x <= r.x + r.width && mouse.y >= r.y && mouse.y <= r.y + r.height;
      context.fillStyle = hover ? '#1d2540' : PALETTE.panel;
      rrect(r.x, r.y, r.width, r.height, 12);
      context.fill();
      context.strokeStyle = hover ? '#ffd97a' : PALETTE.panelEdge;
      context.lineWidth = hover ? 3 : 2;
      context.stroke();
      text(`${i + 1}`, r.x + r.width / 2, r.y + 44, 20, PALETTE.muted, 'center');
      text(up.name, r.x + r.width / 2, r.y + 92, 24, PALETTE.text, 'center');
      text(up.desc, r.x + r.width / 2, r.y + 132, 17, PALETTE.muted, 'center');
      const taken = state.taken[id] || 0;
      for (let p = 0; p < up.max; p += 1) {
        context.fillStyle = p < taken ? '#ffd97a' : 'rgba(255,255,255,0.18)';
        context.beginPath();
        context.arc(r.x + r.width / 2 + (p - (up.max - 1) / 2) * 22, r.y + 178, 6, 0, Math.PI * 2);
        context.fill();
      }
      text(`Level ${taken + 1} of ${up.max}`, r.x + r.width / 2, r.y + 218, 15, PALETTE.muted, 'center');
    }
  }

  /** Paint one frame: the field, then the HUD or a panel for the screen the game is on. */
  function draw(state, screen, best, aim, dt) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const shakeX = state.shake > 0 ? (Math.random() - 0.5) * state.shake : 0;
    const shakeY = state.shake > 0 ? (Math.random() - 0.5) * state.shake : 0;
    context.setTransform(view.scale, 0, 0, view.scale, view.x + shakeX * view.scale, view.y + shakeY * view.scale);
    drawField(state, dt);
    if (screen === SCREEN_TITLE) {
      context.textBaseline = 'alphabetic';
      text('EMBERLINE', FIELD.width / 2, 218, 84, PALETTE.text, 'center');
      text('Hold the line through 10 waves of the cinder swarm.', FIELD.width / 2, 268, 22, PALETTE.muted, 'center');
      text('Move with WASD or arrows. Aim with the mouse. Hold click or Space to fire.', FIELD.width / 2, 312, 20, PALETTE.muted, 'center');
      text('Clear a wave, pick an upgrade, and press E to unleash a nova.', FIELD.width / 2, 344, 20, PALETTE.muted, 'center');
      text(bestLabel(best), FIELD.width / 2, 396, 20, '#ffd97a', 'center');
      text('Press Space or click to start', FIELD.width / 2, 470, 24, '#ffd97a', 'center');
      return;
    }
    if (screen === SCREEN_DRAFT) {
      drawDraft(state, aim);
      return;
    }
    drawHud(state, best);
    if (screen === SCREEN_PLAY) drawAim(aim);
    else if (screen === SCREEN_PAUSED) {
      context.fillStyle = 'rgba(4,6,14,0.6)';
      context.fillRect(0, 0, FIELD.width, FIELD.height);
      drawPanel('Paused', ['The swarm will wait for you.'], 'Press P to resume');
    } else if (screen === SCREEN_OVER) {
      context.fillStyle = 'rgba(4,6,14,0.55)';
      context.fillRect(0, 0, FIELD.width, FIELD.height);
      drawPanel('The line has fallen', [finalLabel(state.score), finalBestLabel(best), `You reached wave ${state.wave} of ${WIN_WAVE}.`], 'Press Space or click to try again');
    } else if (screen === SCREEN_WON) {
      context.fillStyle = 'rgba(4,6,14,0.55)';
      context.fillRect(0, 0, FIELD.width, FIELD.height);
      drawPanel('You held the line!', [finalLabel(state.score), finalBestLabel(best), `All ${WIN_WAVE} waves cleared. ${state.kills} of the swarm destroyed.`], 'Press Space or click to play again');
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return {
    draw,
    /** Canvas CSS pixels (relative to the canvas's top-left) to field coordinates. */
    toField(cx, cy) {
      const ratio = window.devicePixelRatio || 1;
      const px = cx * ratio;
      const py = cy * ratio;
      return { x: (px - view.x) / view.scale, y: (py - view.y) / view.scale };
    },
  };
}
