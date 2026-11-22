const rink = document.querySelector('#rink');
const goal = document.querySelector('#goal');
const ball = document.querySelector('#ball');
const keeper = document.querySelector('#keeper');
const marker = document.querySelector('#marker');
const powerMeter = document.querySelector('#power');
const powerValue = document.querySelector('#power-value');
const result = document.querySelector('#result');
const scoreDisplay = document.querySelector('#score');
const scoreLabel = document.querySelector('#score-label');
const levelDisplay = document.querySelector('#level');
const challenge = document.querySelector('#challenge');
const shotsDisplay = document.querySelector('#shots');
const roundClock = document.querySelector('#round-clock');
const advance = document.querySelector('#advance');
const startScreen = document.querySelector('#start-screen');
const playScreen = document.querySelector('#play-screen');
const scoreboard = document.querySelector('#scoreboard');

const distanceDisplay = document.querySelector('#distance');
const distances = [
  { depth: 81, extraPower: 0, aimScale: 1 },
  { depth: 88, extraPower: 0.075, aimScale: 1.25 }
];

const levels = [
  { target: 8, width: 23, height: 32, hint: 'Mindre hörn' },
  { target: 13, width: 21, height: 29, hint: 'Snabb målvakt', keeper: true, keeperSpeed: '1.5s' },
  { target: 15, width: 20, height: 27, hint: 'Utan siktpunkt', keeper: true, hard: true }
];
const shotsPerLevel = 5;
const roundTime = 15_000;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

let distance = 0;
let level = 0;
let score = 0;
let shots = 0;
let drag = null;
let flight = null;
let advanceTimer;
let timedMode = false;
let deadline = null;
let clockInterval;
let keyboardAim = { direction: 0, power: 0.54 };

function updateScoreboard() {
  const remaining = shotsPerLevel - shots;
  shotsDisplay.textContent = `${remaining} skott kvar`;
  scoreDisplay.textContent = score;
}

function placeBall() {
  rink.style.setProperty('--shot-depth', `${distances[distance].depth}%`);
  keyboardAim = { direction: 0, power: 0.54 };
}

function stopClock() {
  clearInterval(clockInterval);
  deadline = null;
}

// Tiden räknas från en sluttid, så den blir rätt även om fliken varit i bakgrunden.
function updateClock() {
  if (deadline === null) return true;
  const remaining = Math.max(0, deadline - performance.now());
  const seconds = (Math.ceil(remaining / 100) / 10).toFixed(1).replace('.', ',');
  roundClock.textContent = `${seconds} s`;
  roundClock.classList.toggle('low-time', remaining <= 3_000);
  if (remaining > 0) return true;

  stopClock();
  clearDrag();
  flight?.cancel();
  flight = null;
  ball.disabled = true;
  result.textContent = 'Tiden är slut! Försök igen.';
  advance.textContent = 'Försök igen';
  advance.hidden = false;
  return false;
}

function startRound(newLevel) {
  clearTimeout(advanceTimer);
  stopClock();
  clearDrag();
  flight?.cancel();
  flight = null;
  level = newLevel;
  score = 0;
  shots = 0;
  const settings = levels[level];

  distanceDisplay.textContent = `Avstånd ${distance + 1} av ${distances.length}`;
  rink.classList.toggle('long-distance', distance > 0);
  levelDisplay.textContent = `Nivå ${level + 1}`;
  scoreLabel.textContent = `Poäng av ${settings.target}`;
  challenge.textContent = settings.hint;
  keeper.hidden = !settings.keeper;
  keeper.style.animationDuration = settings.keeperSpeed ?? '';
  goal.style.setProperty('--corner-width', `${settings.width}%`);
  goal.style.setProperty('--corner-height', `${settings.height}%`);
  result.textContent = '';
  advance.hidden = true;
  ball.disabled = false;
  placeBall();
  updateScoreboard();

  roundClock.hidden = !timedMode;
  if (timedMode) {
    deadline = performance.now() + roundTime;
    updateClock();
    clockInterval = setInterval(updateClock, 50);
  }
}

function goalOpening() {
  const bounds = goal.getBoundingClientRect();
  return {
    left: bounds.left + goal.clientLeft,
    top: bounds.top + goal.clientTop,
    width: goal.clientWidth,
    height: goal.clientHeight
  };
}

// Procenttalen för hörnen styr både rutornas storlek och poängräkningen.
function pointsAt(x, y) {
  const bounds = goalOpening();
  const across = (x - bounds.left) / bounds.width;
  const down = (y - bounds.top) / bounds.height;
  if (across < 0 || across > 1 || down < 0 || down > 1) return 0;

  const settings = levels[level];
  const nearSide = across <= settings.width / 100 || across >= 1 - settings.width / 100;
  if (nearSide && down <= settings.height / 100) return 5;
  if (nearSide && down >= 1 - settings.height / 100) return 3;
  return 1;
}

function targetAt(direction, power, launchX) {
  const bounds = goalOpening();
  const settings = distances[distance];
  return {
    x: launchX - direction * bounds.width * 0.95 * settings.aimScale,
    // Ett skott längre bak behöver mer kraft för att nå samma höjd.
    y: bounds.top + bounds.height * (1.17 + settings.extraPower - power * 1.28),
    power
  };
}

function aimAt(clientX, clientY) {
  const down = Math.max(0, clientY - drag.startY);
  const sideways = clientX - drag.startX;
  const maxPull = Math.min(100, rink.clientHeight * 0.16);
  const pull = Math.hypot(sideways, down);
  const power = Math.min(1, pull / maxPull);

  return {
    ...targetAt(sideways / Math.max(down, 12), power, drag.launchX),
    offsetX: sideways * Math.min(1, maxPull / Math.max(pull, 1)) * 0.7,
    offsetY: Math.min(down * 0.32, maxPull * 0.32, drag.availableSpace),
    ready: down >= 12
  };
}

function showPower(power) {
  const percent = Math.round(power * 100);
  powerMeter.value = percent;
  powerValue.textContent = `${percent} %`;
}

function previewAim(aim) {
  showPower(aim.power);
  const bounds = rink.getBoundingClientRect();
  marker.style.left = `${aim.x - bounds.left - rink.clientLeft}px`;
  marker.style.top = `${aim.y - bounds.top - rink.clientTop}px`;
  marker.hidden = !aim.ready || Boolean(levels[level].hard);
}

function clearDrag() {
  drag = null;
  ball.style.transform = '';
  marker.hidden = true;
  showPower(0);
}

function keeperStops(x, y) {
  if (keeper.hidden) return false;
  // Kontrollera utrustningen så att luckorna runt armar och knän kan ge mål.
  return Array.from(keeper.children).some((part) => {
    const bounds = part.getBoundingClientRect();
    return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  });
}

async function shoot({ x, y, power, offsetX = 0, offsetY = 0 }) {
  if (!updateClock()) return;
  const points = pointsAt(x, y);
  const overBar = y < goalOpening().top;
  clearDrag();
  showPower(power);
  const start = ball.getBoundingClientRect();
  const dx = x - (start.left + start.width / 2);
  const dy = y - (start.top + start.height / 2);
  result.textContent = '';

  const animation = ball.animate([
    { transform: `translate(${offsetX}px, ${offsetY}px) rotate(0deg) scale(1)` },
    { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 24}px) rotate(220deg) scale(.65)` },
    { transform: `translate(${dx}px, ${dy}px) rotate(470deg) scale(.30)` }
  ], { duration: reducedMotion.matches ? 1 : 890 - power * 490, easing: 'ease-out' });

  flight = animation;
  try {
    await animation.finished;
  } catch {
    return; // Börja om kan avbryta ett skott som redan är i luften.
  }

  flight = null;
  if (!updateClock()) return;
  const saved = points > 0 && keeperStops(x, y);
  const earned = saved ? 0 : points;
  score += earned;
  shots += 1;
  updateScoreboard();

  let feedback = 'Miss! 0 poäng';
  if (earned) feedback = `+${earned} poäng!`;
  else if (saved) feedback = 'Målvakten räddar!';
  else if (overBar) feedback = 'Över ribban!';

  const passed = score >= levels[level].target;
  if (!passed && shots < shotsPerLevel) {
    result.textContent = feedback;
    placeBall();
    return;
  }

  stopClock();
  ball.disabled = true;
  const distanceCleared = passed && level === levels.length - 1;
  const won = distanceCleared && distance === distances.length - 1;
  if (passed && !won) {
    result.textContent = `${feedback} ${distanceCleared ? 'Nästa avstånd!' : 'Nivån klarad!'}`;
    advanceTimer = setTimeout(advanceRound, 650);
    return;
  }

  result.textContent = `${feedback} ${won ? 'Båda avstånden klarade!' : 'Försök igen!'}`;
  advance.textContent = won ? 'Spela igen' : 'Försök igen';
  advance.hidden = false;
}

ball.addEventListener('pointerdown', (event) => {
  if (flight || drag || ball.disabled || event.button !== 0) return;
  const bounds = ball.getBoundingClientRect();
  drag = {
    id: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    launchX: bounds.left + bounds.width / 2,
    availableSpace: Math.max(0, rink.getBoundingClientRect().bottom - bounds.bottom - 2)
  };
  showPower(0);
  ball.setPointerCapture(event.pointerId);
});

ball.addEventListener('pointermove', (event) => {
  if (drag?.id !== event.pointerId) return;
  const aim = aimAt(event.clientX, event.clientY);
  ball.style.transform = `translate(${aim.offsetX}px, ${aim.offsetY}px)`;
  previewAim(aim);
});

ball.addEventListener('pointerup', (event) => {
  if (drag?.id !== event.pointerId) return;
  const aim = aimAt(event.clientX, event.clientY);
  if (aim.ready) shoot(aim);
  else clearDrag();
});

for (const type of ['pointercancel', 'lostpointercapture']) {
  ball.addEventListener(type, (event) => {
    if (drag?.id === event.pointerId) clearDrag();
  });
}

function keyboardTarget() {
  const bounds = ball.getBoundingClientRect();
  return targetAt(keyboardAim.direction, keyboardAim.power, bounds.left + bounds.width / 2);
}

ball.addEventListener('keydown', (event) => {
  if (flight || drag || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'ArrowLeft') keyboardAim.direction += 0.08;
  if (event.key === 'ArrowRight') keyboardAim.direction -= 0.08;
  if (event.key === 'ArrowUp') keyboardAim.power += 0.07;
  if (event.key === 'ArrowDown') keyboardAim.power -= 0.07;
  keyboardAim.direction = Math.max(-1.5, Math.min(1.5, keyboardAim.direction));
  keyboardAim.power = Math.max(0.12, Math.min(1, keyboardAim.power));
  previewAim({ ...keyboardTarget(), ready: true });
});

ball.addEventListener('blur', () => {
  if (!drag) clearDrag();
});

ball.addEventListener('click', (event) => {
  if (event.detail !== 0 || flight || drag || ball.disabled) return;
  shoot(keyboardTarget());
});

function advanceRound() {
  let nextLevel = level;
  if (score >= levels[level].target) {
    nextLevel = (level + 1) % levels.length;
    if (nextLevel === 0) distance = (distance + 1) % distances.length;
  }
  startRound(nextLevel);
  ball.focus();
}

advance.addEventListener('click', advanceRound);

function startChallenge() {
  distance = 0;
  startRound(0);
  ball.focus();
}

function openGame(withTimer) {
  timedMode = withTimer;
  startScreen.hidden = true;
  playScreen.hidden = false;
  scoreboard.hidden = false;
  startChallenge();
}

document.querySelector('#reset').addEventListener('click', startChallenge);
document.querySelector('#start').addEventListener('click', () => openGame(false));
document.querySelector('#start-timed').addEventListener('click', () => openGame(true));

document.querySelector('#home').addEventListener('click', () => {
  clearTimeout(advanceTimer);
  stopClock();
  clearDrag();
  flight?.cancel();
  flight = null;
  playScreen.hidden = true;
  scoreboard.hidden = true;
  startScreen.hidden = false;
  document.querySelector('#start-heading').focus();
});
