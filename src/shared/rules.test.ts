import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PILLAR_POS,
  distance2D,
  findNextPathPoint,
  hasLineOfSight,
  isWalkableWorld,
  resolveCircleWallCollision,
} from './map';
import {
  MIN_PLAYERS_TO_START,
  WARMUP_DURATION_MS,
  WRONG_GUESS_STUN_MS,
  canStartMatch,
  createInitialRoom,
  createPlayer,
  handlePillarCheckin,
  handleSeekerGuess,
  handleUseItem,
  handleUseSkill,
  shouldShowPlayerName,
  startMatch,
  transitionWarmupToPlaying,
} from './rules';

test('requires at least 3 players to start and picks exactly 1 seeker', () => {
  const now = 1000;
  const room = createInitialRoom('LEVEL-0', now);
  room.players['p1'] = createPlayer('p1', 'Minh', false, 0);
  room.players['p2'] = createPlayer('p2', 'Linh', false, 1);

  assert.equal(MIN_PLAYERS_TO_START, 3);
  assert.equal(canStartMatch(room).ok, false);

  room.players['p3'] = createPlayer('p3', 'Hùng', false, 2);
  assert.equal(canStartMatch(room).ok, true);

  const started = startMatch(room, now, () => 0.4);
  assert.equal(started.ok, true);
  assert.equal(room.phase, 'warmup');
  assert.equal(room.phaseEndsAt, now + WARMUP_DURATION_MS);

  const seekers = Object.values(room.players).filter((p) => p.role === 'seeker');
  const hiders = Object.values(room.players).filter((p) => p.role === 'hider');
  assert.equal(seekers.length, 1);
  assert.equal(hiders.length, 2);
});

test('names are visible in lobby, then hider names hide after 10s warmup', () => {
  const now = 5000;
  const room = createInitialRoom('LEVEL-0', now);
  room.players['p1'] = createPlayer('p1', 'An', false, 0);
  room.players['p2'] = createPlayer('p2', 'Bình', false, 1);
  room.players['p3'] = createPlayer('p3', 'Chi', false, 2);

  // Lobby: everyone sees everyone's name
  assert.equal(shouldShowPlayerName(room.players['p1'], room.players['p2'], 'lobby'), true);
  assert.equal(shouldShowPlayerName(room.players['p2'], room.players['p3'], 'lobby'), true);

  // Start -> Warmup (p1 becomes seeker with rng=0)
  startMatch(room, now, () => 0);
  assert.equal(room.players['p1'].role, 'seeker');

  // After 10s -> playing
  assert.equal(transitionWarmupToPlaying(room, now + 9_999), false);
  assert.equal(transitionWarmupToPlaying(room, now + 10_000), true);
  assert.equal(room.phase, 'playing');

  // Active hider names are hidden from seeker and from other active hiders
  assert.equal(shouldShowPlayerName(room.players['p1'], room.players['p2'], 'playing'), false);
  assert.equal(shouldShowPlayerName(room.players['p2'], room.players['p3'], 'playing'), false);
});

test('seeker spots hider, calls wrong name -> 5s stun penalty at pillar; calls right name -> eliminates hider', () => {
  const now = 10_000;
  const room = createInitialRoom('LEVEL-0', now);
  room.players['p1'] = createPlayer('p1', 'An', false, 0);
  room.players['p2'] = createPlayer('p2', 'Bình', false, 1);
  room.players['p3'] = createPlayer('p3', 'Chi', false, 2);

  startMatch(room, now, () => 0); // p1 is seeker
  const huntStart = now + WARMUP_DURATION_MS;
  transitionWarmupToPlaying(room, huntStart);

  // Place seeker and hider p2 in clear line of sight inside central atrium
  room.players['p1'].x = PILLAR_POS.x;
  room.players['p1'].z = PILLAR_POS.z + 2.2;
  room.players['p2'].x = PILLAR_POS.x + 3.0;
  room.players['p2'].z = PILLAR_POS.z + 2.2;

  // 1) Wrong guess: seeker tags p2 (Bình) as "Chi"
  const wrongCall = handleSeekerGuess(room, 'p1', 'p2', false, 'Chi', huntStart + 100);
  assert.equal(wrongCall.ok, true);
  assert.equal(room.claim?.guessedName, 'Chi');
  assert.equal(room.claim?.targetId, 'p2');

  // Seeker checks in at pillar -> stunned for 5s, p2 still active
  const wrongCheckin = handlePillarCheckin(room, 'p1', huntStart + 500);
  assert.equal(wrongCheckin.ok, true);
  assert.equal(wrongCheckin.kind, 'wrong_guess_stun');
  assert.equal(room.players['p1'].stunUntil, huntStart + 500 + WRONG_GUESS_STUN_MS);
  assert.equal(room.players['p2'].status, 'active');

  // Cannot guess again while stunned
  const blockedGuess = handleSeekerGuess(room, 'p1', 'p2', false, 'Bình', huntStart + 1000);
  assert.equal(blockedGuess.ok, false);

  // 2) After 5s penalty expires, seeker guesses correctly: "Bình"
  const afterStun = huntStart + 500 + WRONG_GUESS_STUN_MS + 100;
  const rightCall = handleSeekerGuess(room, 'p1', 'p2', false, 'Bình', afterStun);
  assert.equal(rightCall.ok, true);

  const rightCheckin = handlePillarCheckin(room, 'p1', afterStun + 200);
  assert.equal(rightCheckin.ok, true);
  assert.equal(rightCheckin.kind, 'elimination');
  assert.equal(room.players['p2'].status, 'eliminated');
  assert.equal(room.phase, 'playing'); // p3 still active!
});

test('hider racing to pillar first transforms into visitor and cancels pending seeker claim', () => {
  const now = 20_000;
  const room = createInitialRoom('LEVEL-0', now);
  room.players['p1'] = createPlayer('p1', 'An', false, 0);
  room.players['p2'] = createPlayer('p2', 'Bình', false, 1);
  room.players['p3'] = createPlayer('p3', 'Chi', false, 2);

  startMatch(room, now, () => 0); // p1 is seeker
  const huntStart = now + WARMUP_DURATION_MS;
  transitionWarmupToPlaying(room, huntStart);

  // Seeker spots p2 and calls right name "Bình"
  room.players['p1'].x = PILLAR_POS.x;
  room.players['p1'].z = PILLAR_POS.z + 5.0;
  room.players['p2'].x = PILLAR_POS.x + 1.8;
  room.players['p2'].z = PILLAR_POS.z + 1.2;

  const guess = handleSeekerGuess(room, 'p1', 'p2', false, 'Bình', huntStart + 100);
  assert.equal(guess.ok, true);
  assert.equal(room.claim?.targetId, 'p2');

  // Hider p2 checks in at pillar FIRST!
  const hiderCheckin = handlePillarCheckin(room, 'p2', huntStart + 300);
  assert.equal(hiderCheckin.ok, true);
  assert.equal(hiderCheckin.kind, 'visitor_win');
  assert.equal(room.players['p2'].status, 'visitor');
  assert.equal(room.claim, null); // Seeker claim cancelled!

  // Visitor can see everyone's names and others see visitor's name
  assert.equal(shouldShowPlayerName(room.players['p2'], room.players['p3'], 'playing'), true);
  assert.equal(shouldShowPlayerName(room.players['p1'], room.players['p2'], 'playing'), true);

  // Last remaining hider p3 also checks in -> match ends with Hiders winning
  room.players['p3'].x = PILLAR_POS.x - 1.5;
  room.players['p3'].z = PILLAR_POS.z;
  const lastCheckin = handlePillarCheckin(room, 'p3', huntStart + 600);
  assert.equal(lastCheckin.ok, true);
  assert.equal(lastCheckin.matchEnded, true);
  assert.equal(room.phase, 'gameover');
  assert.equal(room.summary?.winner, 'hiders');
  assert.equal(room.summary?.visitors.length, 2);
});

test('special skills (Decoy Echo) and items (Smoke Bomb) integrate with line-of-sight and baiting', () => {
  const now = 30_000;
  const room = createInitialRoom('LEVEL-0', now);
  room.players['p1'] = createPlayer('p1', 'An', false, 0);
  room.players['p2'] = createPlayer('p2', 'Bình', false, 1);
  room.players['p3'] = createPlayer('p3', 'Chi', false, 2);

  startMatch(room, now, () => 0);
  const huntStart = now + WARMUP_DURATION_MS;
  transitionWarmupToPlaying(room, huntStart);

  // Hider p2 uses Decoy Echo skill
  room.players['p2'].x = 4;
  room.players['p2'].z = 4;
  const skill = handleUseSkill(room, 'p2', huntStart + 100);
  assert.equal(skill.ok, true);
  assert.equal(room.decoys.length, 1);

  // Seeker gets baited by Decoy
  const bait = handleSeekerGuess(room, 'p1', room.decoys[0].id, true, 'Bình', huntStart + 200);
  assert.equal(bait.ok, true);
  assert.equal(bait.baitedByDecoy, true);
  assert.equal(room.decoys.length, 0);

  // Hider p3 deploys Smoke Bomb, blocking line-of-sight
  room.players['p3'].heldItem = 'smoke_bomb';
  room.players['p3'].x = 0;
  room.players['p3'].z = 4;
  const smokeRes = handleUseItem(room, 'p3', huntStart + 300);
  assert.equal(smokeRes.ok, true);
  assert.equal(hasLineOfSight(0, 0, 0, 8, room.smokes), false);
});

test('map geometry has open central atrium, valid collision push-out, and connected BFS path', () => {
  assert.equal(isWalkableWorld(PILLAR_POS.x + 2.0, PILLAR_POS.z), true);
  assert.equal(isWalkableWorld(PILLAR_POS.x - 2.0, PILLAR_POS.z), true);
  assert.equal(isWalkableWorld(PILLAR_POS.x, PILLAR_POS.z + 2.0), true);
  assert.equal(isWalkableWorld(PILLAR_POS.x, PILLAR_POS.z - 2.0), true);

  // Pushing into the central pillar pushes outside PILLAR_RADIUS + PLAYER_RADIUS
  const pushed = resolveCircleWallCollision(PILLAR_POS.x + 0.1, PILLAR_POS.z);
  assert.ok(distance2D(pushed.x, pushed.z, PILLAR_POS.x, PILLAR_POS.z) >= 1.25);

  // BFS finds a step from outer corridor back toward the central pillar
  const nextStep = findNextPathPoint(-32, -32, PILLAR_POS.x, PILLAR_POS.z);
  assert.equal(isWalkableWorld(nextStep.x, nextStep.z), true);
});
