// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s
// steps (several in a slow frame, none in a fast one), and the renderer paints what is
// there. The game moves between six screens: title, play, draft, paused, game over
// and victory.
//
// ?seed=N fixes the swarm's pattern. ?shot=start|play|win|end (with &seed=N) stages
// that scene instead of running the loop, paints it twice and sets window.__shotReady
// for a screenshot.
import { BEST_KEY, FIELD, STEP } from './config.js';
import { createRandom } from './random.js';
import { createWorld, EVENT_HIT, EVENT_KILL, EVENT_OVER, EVENT_PICKUP, EVENT_SHOOT, EVENT_WAVE_CLEAR, EVENT_WIN } from './world.js';
import { ACTION_CONFIRM, ACTION_MUTE, ACTION_NOVA, ACTION_PAUSE, createInput } from './input.js';
import { createAudio } from './audio.js';
import { SCREEN_DRAFT, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WON, createRenderer, draftCardRects } from './render.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const audio = createAudio();
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.best, null, STEP);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  // Park the ship low on the title screen so it never covers the instructions.
  world.state.player.x = FIELD.width / 2;
  world.state.player.y = FIELD.height - 140;

  // Screen readers (and anyone watching the page's text) hear the screen changes and each hit.
  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    audio.unlock();
    world.reset();
    accumulator = 0;
    screen = SCREEN_PLAY;
    announce('Playing. Hold the line through 10 waves.');
  }

  function endGame(won) {
    screen = won ? SCREEN_WON : SCREEN_OVER;
    if (world.state.score > best) {
      best = world.state.score;
      saveBest(best);
    }
    if (won) {
      audio.win();
      announce(`Victory. Score ${world.state.score}. Best ${best}.`);
    } else {
      audio.gameOver();
      announce(`Game over. Score ${world.state.score}. Best ${best}.`);
    }
    // A Space held to fire in the last play frame must not restart the game at once.
    input.takeActions();
  }

  function pickUpgrade(index) {
    if (world.chooseUpgrade(index)) {
      audio.waveClear();
      screen = SCREEN_PLAY;
      announce(`Wave ${world.state.wave}. Upgrade taken.`);
    }
  }

  // One frame's worth of one-shot presses, taken once and shared by every step below.
  function handleActions(actions) {
    if (actions & ACTION_MUTE) {
      const muted = audio.toggleMute();
      announce(muted ? 'Sound off.' : 'Sound on.');
    }
    if (actions & ACTION_CONFIRM) audio.unlock();
    if (screen === SCREEN_TITLE || screen === SCREEN_OVER || screen === SCREEN_WON) {
      if (actions & ACTION_CONFIRM) startGame();
      return;
    }
    if (screen === SCREEN_DRAFT) {
      const digit = input.takeDigit();
      if (digit >= 0) pickUpgrade(digit);
      const click = input.takeClick();
      if (click !== null) {
        const field = renderer.toField(click.x, click.y);
        const rects = draftCardRects();
        for (let i = 0; i < rects.length; i += 1) {
          const r = rects[i];
          if (field.x >= r.x && field.x <= r.x + r.width && field.y >= r.y && field.y <= r.y + r.height) pickUpgrade(i);
        }
      }
      return;
    }
    if (actions & ACTION_PAUSE) {
      if (screen === SCREEN_PLAY) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
    }
  }

  function step(actions) {
    if (screen === SCREEN_TITLE) {
      world.step(STEP, { moveX: 0, moveY: 0, aimX: 640, aimY: 360, firing: false, nova: false }, true);
      return;
    }
    if (screen !== SCREEN_PLAY) return;
    const move = input.move();
    const aimField = renderer.toField(input.mouse.x, input.mouse.y);
    const events = world.step(STEP, {
      moveX: move.x,
      moveY: move.y,
      aimX: aimField.x,
      aimY: aimField.y,
      firing: input.firing(),
      nova: Boolean(actions & ACTION_NOVA),
    }, false);
    if (events & EVENT_SHOOT) audio.shoot();
    if (events & EVENT_KILL) audio.explosion();
    if (events & EVENT_PICKUP) audio.pickup();
    if (events & EVENT_HIT) {
      audio.hit();
      announce(world.state.player.hull <= 25 ? `Hull ${Math.ceil(world.state.player.hull)}. Careful.` : `Hit. Hull ${Math.ceil(world.state.player.hull)}.`);
    }
    if (events & EVENT_WAVE_CLEAR) {
      audio.waveClear();
      screen = SCREEN_DRAFT;
      announce(`Wave ${world.state.wave} cleared. Choose an upgrade.`);
    }
    if (events & EVENT_WIN) endGame(true);
    else if (events & EVENT_OVER) endGame(false);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const actions = input.takeActions();
    handleActions(actions);
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step(actions);
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    const aimField = screen === SCREEN_PLAY ? renderer.toField(input.mouse.x, input.mouse.y) : null;
    renderer.draw(world.state, screen, best, aimField, STEP);
  }

  // Leaving the tab pauses a running game rather than letting the swarm close in unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Emberline. Press Space or click to start.');
  // A small debug handle for automated play tests (read-only state).
  window.__emberline = {
    get state() { return world.state; },
    get screen() { return screen; },
  };
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
