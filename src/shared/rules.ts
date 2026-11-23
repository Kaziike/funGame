import {
  LOBBY_SPAWNS,
  PILLAR_INTERACT_RADIUS,
  PILLAR_POS,
  distance2D,
  getItemSpawnPoints,
  hasLineOfSight,
} from './map';
import type {
  FeedNotification,
  ItemType,
  MatchSummary,
  PlayerState,
  RoomPhase,
  RoomState,
  WorldItem,
} from './types';

export const MIN_PLAYERS_TO_START = 3;
export const WARMUP_DURATION_MS = 10_000;
export const MATCH_DURATION_MS = 180_000;
export const WRONG_GUESS_STUN_MS = 5_000;
export const SPOT_MAX_DISTANCE = 22.0;
export const ITEM_PICKUP_RADIUS = 2.0;
export const ITEM_RESPAWN_MS = 28_000;
export const SKILL_COOLDOWN_MS = 18_000;
export const BLACKOUT_INTERVAL_MS = 45_000;
export const BLACKOUT_DURATION_MS = 8_000;

export const SUIT_PALETTE: Array<{ suit: string; accent: string }> = [
  { suit: '#d8b643', accent: '#dc2626' }, // Classic Backrooms Hazmat + Crimson strap
  { suit: '#cfb34e', accent: '#2563eb' }, // Ochre Hazmat + Cobalt strap
  { suit: '#c8ab44', accent: '#16a34a' }, // Mustard Hazmat + Emerald strap
  { suit: '#d4b856', accent: '#ea580c' }, // Amber Hazmat + Rust strap
  { suit: '#c9b458', accent: '#9333ea' }, // Khaki Hazmat + Plum strap
  { suit: '#d1b54a', accent: '#0891b2' }, // Yellow Hazmat + Teal strap
  { suit: '#c6ad48', accent: '#db2777' }, // Olive-gold Hazmat + Magenta strap
  { suit: '#d5bd60', accent: '#4f46e5' }, // Pale-yellow Hazmat + Indigo strap
];

const ITEM_ROTATION: ItemType[] = [
  'almond_water',
  'smoke_bomb',
  'emf_scanner',
  'static_cloak',
];

let notifSeq = 1;

export function pushNotification(
  room: RoomState,
  text: string,
  tone: FeedNotification['tone'],
  nowMs: number,
): FeedNotification {
  const notif: FeedNotification = {
    id: `n-${nowMs}-${notifSeq++}`,
    text,
    tone,
    createdAt: nowMs,
  };
  room.notifications = [notif, ...room.notifications].slice(0, 6);
  return notif;
}

export function createInitialRoom(roomCode: string, nowMs: number): RoomState {
  return {
    roomCode,
    hostId: null,
    phase: 'lobby',
    phaseEndsAt: 0,
    matchStartedAt: 0,
    serverNow: nowMs,
    blackoutUntil: 0,
    nextBlackoutAt: 0,
    players: {},
    claim: null,
    items: buildInitialItems(),
    decoys: [],
    smokes: [],
    correctGuesses: 0,
    wrongGuesses: 0,
    summary: null,
    notifications: [],
  };
}

export function buildInitialItems(): WorldItem[] {
  const spawns = getItemSpawnPoints();
  return spawns.map((pt, idx) => ({
    id: `item-${idx}`,
    type: ITEM_ROTATION[idx % ITEM_ROTATION.length],
    x: pt.x,
    z: pt.z,
    active: true,
    respawnAt: 0,
  }));
}

export function createPlayer(
  id: string,
  name: string,
  isBot: boolean,
  index: number,
): PlayerState {
  const spawn = LOBBY_SPAWNS[index % LOBBY_SPAWNS.length];
  const palette = SUIT_PALETTE[index % SUIT_PALETTE.length];
  return {
    id,
    name: name.trim().slice(0, 18) || `Khách ${index + 1}`,
    isBot,
    suitColor: palette.suit,
    accentColor: palette.accent,
    x: spawn.x,
    y: 0,
    z: spawn.z,
    yaw: spawn.yaw,
    pitch: 0,
    speed: 0,
    crouching: false,
    role: 'hider',
    status: 'active',
    heldItem: null,
    skillCooldownUntil: 0,
    speedBoostUntil: 0,
    cloakUntil: 0,
    stunUntil: 0,
    emfUntil: 0,
    echoSenseUntil: 0,
    checkedInAt: null,
    eliminatedAt: null,
  };
}

export function canStartMatch(room: RoomState): { ok: boolean; reason?: string } {
  if (room.phase !== 'lobby' && room.phase !== 'gameover') {
    return { ok: false, reason: 'Trận đấu đang diễn ra.' };
  }
  const count = Object.keys(room.players).length;
  if (count < MIN_PLAYERS_TO_START) {
    return {
      ok: false,
      reason: `Cần ít nhất ${MIN_PLAYERS_TO_START} người chơi để bắt đầu (hiện có ${count}/${MIN_PLAYERS_TO_START}).`,
    };
  }
  return { ok: true };
}

export function startMatch(
  room: RoomState,
  nowMs: number,
  rng: () => number = Math.random,
): { ok: boolean; seekerId?: string; reason?: string } {
  const check = canStartMatch(room);
  if (!check.ok) return check;

  const ids = Object.keys(room.players);
  const seekerIndex = Math.floor(rng() * ids.length) % ids.length;
  const seekerId = ids[seekerIndex];

  room.phase = 'warmup';
  room.matchStartedAt = nowMs;
  room.phaseEndsAt = nowMs + WARMUP_DURATION_MS;
  room.blackoutUntil = 0;
  room.nextBlackoutAt = nowMs + WARMUP_DURATION_MS + BLACKOUT_INTERVAL_MS;
  room.claim = null;
  room.decoys = [];
  room.smokes = [];
  room.items = buildInitialItems();
  room.correctGuesses = 0;
  room.wrongGuesses = 0;
  room.summary = null;

  ids.forEach((pid, idx) => {
    const p = room.players[pid];
    const spawn = LOBBY_SPAWNS[idx % LOBBY_SPAWNS.length];
    p.role = pid === seekerId ? 'seeker' : 'hider';
    p.status = 'active';
    p.heldItem = null;
    p.skillCooldownUntil = 0;
    p.speedBoostUntil = 0;
    p.cloakUntil = 0;
    p.stunUntil = 0;
    p.emfUntil = 0;
    p.echoSenseUntil = 0;
    p.checkedInAt = null;
    p.eliminatedAt = null;
    p.crouching = false;

    if (p.role === 'seeker') {
      // Seeker starts near the Check-in Pillar facing OUTWARD down the open South corridor
      p.x = PILLAR_POS.x;
      p.z = PILLAR_POS.z + 3.2;
      p.yaw = Math.PI;
      p.pitch = 0;
    } else {
      // Hiders start around the atrium facing outward toward the open corridors
      p.x = spawn.x * 1.15;
      p.z = spawn.z * 1.15;
      p.yaw = Math.atan2(-p.x, -p.z);
      p.pitch = 0;
    }
  });

  const seekerName = room.players[seekerId].name;
  pushNotification(
    room,
    `${seekerName} được chọn làm Người Đi Tìm! 10 giây khởi động bắt đầu!`,
    'warning',
    nowMs,
  );

  return { ok: true, seekerId };
}

export function transitionWarmupToPlaying(room: RoomState, nowMs: number): boolean {
  if (room.phase !== 'warmup' || nowMs < room.phaseEndsAt) return false;
  room.phase = 'playing';
  room.phaseEndsAt = nowMs + MATCH_DURATION_MS;
  pushNotification(
    room,
    'Hết 10 giây! Tên người trốn đã bị ẩn — Cuộc đi tìm bắt đầu!',
    'danger',
    nowMs,
  );
  return true;
}

/**
 * Determines whether `viewer` can see `target`'s floating name tag.
 * - Lobby: EVERYONE sees EVERYONE's names.
 * - Warmup (10s): Hiders still see names; Seeker is blindfolded at pillar.
 * - Playing (after 10s): ALL active hider names are hidden! Visitors & eliminated spectators can see names;
 *   Visitors display their name + Visitor badge so everyone knows they already won.
 * - Game Over: Everyone sees all names.
 */
export function shouldShowPlayerName(
  viewer: PlayerState | undefined,
  target: PlayerState,
  phase: RoomPhase,
): boolean {
  if (!viewer) return phase === 'lobby' || phase === 'gameover';
  if (viewer.id === target.id) return true;
  if (phase === 'lobby' || phase === 'gameover') return true;
  if (phase === 'warmup') {
    return viewer.role !== 'seeker';
  }
  // phase === 'playing'
  if (viewer.status === 'visitor' || viewer.status === 'eliminated') return true;
  if (target.status === 'visitor') return true;
  if (target.role === 'seeker') return true;
  // Active hiders' names are strictly hidden during 'playing'!
  return false;
}

export interface GuessResult {
  ok: boolean;
  reason?: string;
  baitedByDecoy?: boolean;
  targetId?: string;
  guessedName?: string;
}

export function handleSeekerGuess(
  room: RoomState,
  seekerId: string,
  targetId: string,
  targetIsDecoy: boolean,
  guessedName: string,
  nowMs: number,
): GuessResult {
  if (room.phase !== 'playing') {
    return { ok: false, reason: 'Chưa vào giai đoạn đi tìm.' };
  }
  const seeker = room.players[seekerId];
  if (!seeker || seeker.role !== 'seeker') {
    return { ok: false, reason: 'Chỉ người đi tìm mới có thể điểm mặt.' };
  }
  if (nowMs < seeker.stunUntil) {
    return { ok: false, reason: 'Bạn đang bị phạt đứng yên!' };
  }

  // Check if seeker aimed at a Hider's Decoy Echo!
  if (targetIsDecoy) {
    const decoyIdx = room.decoys.findIndex((d) => d.id === targetId);
    if (decoyIdx === -1) {
      return { ok: false, reason: 'Bóng ma đã biến mất.' };
    }
    room.decoys.splice(decoyIdx, 1);
    pushNotification(
      room,
      `${seeker.name} bị lừa bởi Bóng Ma Phân Thân!`,
      'warning',
      nowMs,
    );
    return { ok: true, baitedByDecoy: true };
  }

  const target = room.players[targetId];
  if (!target || target.role !== 'hider' || target.status !== 'active') {
    return { ok: false, reason: 'Mục tiêu không hợp lệ hoặc đã rời cuộc chơi.' };
  }

  const dist = distance2D(seeker.x, seeker.z, target.x, target.z);
  if (dist > SPOT_MAX_DISTANCE) {
    return { ok: false, reason: 'Mục tiêu quá xa để điểm mặt!' };
  }

  const activeSmokes = room.smokes.filter((s) => s.expiresAt > nowMs);
  if (!hasLineOfSight(seeker.x, seeker.z, target.x, target.z, activeSmokes)) {
    return { ok: false, reason: 'Tầm nhìn bị tường hoặc khói che khuất!' };
  }

  room.claim = {
    seekerId,
    targetId,
    targetIsDecoy: false,
    guessedName,
    actualTargetName: target.name,
    createdAt: nowMs,
  };

  pushNotification(
    room,
    `${seeker.name} đã điểm mặt một người trốn là "${guessedName}" và đang chạy về Cột!`,
    'warning',
    nowMs,
  );

  return { ok: true, targetId, guessedName };
}

export interface CheckinOutcome {
  ok: boolean;
  reason?: string;
  kind?: 'elimination' | 'wrong_guess_stun' | 'visitor_win';
  actorName?: string;
  targetId?: string;
  targetName?: string;
  guessedName?: string;
  matchEnded?: boolean;
}

export function handlePillarCheckin(
  room: RoomState,
  playerId: string,
  nowMs: number,
): CheckinOutcome {
  if (room.phase !== 'playing') {
    return { ok: false, reason: 'Chỉ có thể Check-in khi đang trong trận.' };
  }
  const player = room.players[playerId];
  if (!player) return { ok: false, reason: 'Người chơi không tồn tại.' };
  if (nowMs < player.stunUntil) {
    return { ok: false, reason: 'Bạn đang bị phạt đứng yên!' };
  }

  const distToPillar = distance2D(player.x, player.z, PILLAR_POS.x, PILLAR_POS.z);
  if (distToPillar > PILLAR_INTERACT_RADIUS) {
    return { ok: false, reason: 'Hãy lại gần Cột Điểm Danh hơn nữa!' };
  }

  // Case 1: Seeker checking in their active Name Guess
  if (player.role === 'seeker') {
    if (!room.claim || room.claim.seekerId !== player.id) {
      return { ok: false, reason: 'Hãy chỉ tâm chuột điểm mặt người trốn trước khi về cột!' };
    }
    const claim = room.claim;
    room.claim = null;

    const target = room.players[claim.targetId];
    if (!target || target.status !== 'active') {
      return { ok: false, reason: 'Mục tiêu đã về cột hoặc rời trận trước đó!' };
    }

    if (claim.guessedName === target.name) {
      // CORRECT GUESS -> Target is eliminated!
      target.status = 'eliminated';
      target.eliminatedAt = nowMs;
      room.correctGuesses += 1;
      pushNotification(
        room,
        `CHÍNH XÁC! ${player.name} đã chốt đúng "${target.name}" tại Cột — ${target.name} bị loại!`,
        'danger',
        nowMs,
      );
      const ended = checkAndFinalizeMatchEnd(room, nowMs);
      return {
        ok: true,
        kind: 'elimination',
        actorName: player.name,
        targetId: target.id,
        targetName: target.name,
        guessedName: claim.guessedName,
        matchEnded: ended,
      };
    } else {
      // WRONG GUESS -> 5-second stun penalty!
      player.stunUntil = nowMs + WRONG_GUESS_STUN_MS;
      room.wrongGuesses += 1;
      pushNotification(
        room,
        `ĐOÁN SAI! "${claim.guessedName}" không đúng — ${player.name} bị phạt đứng yên 5 giây!`,
        'info',
        nowMs,
      );
      return {
        ok: true,
        kind: 'wrong_guess_stun',
        actorName: player.name,
        targetId: target.id,
        targetName: target.name,
        guessedName: claim.guessedName,
        matchEnded: false,
      };
    }
  }

  // Case 2: Active Hider checking in BEFORE being eliminated -> becomes VISITOR (Won!)
  if (player.role === 'hider') {
    if (player.status !== 'active') {
      return { ok: false, reason: 'Bạn không còn ở trạng thái người trốn.' };
    }
    player.status = 'visitor';
    player.checkedInAt = nowMs;

    // Cancel pending seeker claim if it was targeting this hider
    if (room.claim && room.claim.targetId === player.id) {
      room.claim = null;
    }

    pushNotification(
      room,
      `${player.name} đã Check-in Cột thành công và hóa thân thành VISITOR (Đã Thắng)!`,
      'success',
      nowMs,
    );

    const ended = checkAndFinalizeMatchEnd(room, nowMs);
    return {
      ok: true,
      kind: 'visitor_win',
      actorName: player.name,
      matchEnded: ended,
    };
  }

  return { ok: false, reason: 'Không thể Check-in.' };
}

export function checkAndFinalizeMatchEnd(room: RoomState, nowMs: number): boolean {
  if (room.phase !== 'playing') return false;

  const hiders = Object.values(room.players).filter((p) => p.role === 'hider');
  const activeHiders = hiders.filter((p) => p.status === 'active');
  const timeUp = nowMs >= room.phaseEndsAt;

  if (activeHiders.length > 0 && !timeUp) {
    return false;
  }

  const seeker = Object.values(room.players).find((p) => p.role === 'seeker');
  const visitors = hiders
    .filter((p) => p.status === 'visitor')
    .map((p) => ({
      id: p.id,
      name: p.name,
      checkedInSec: Math.max(
        1,
        Math.round(((p.checkedInAt ?? nowMs) - (room.matchStartedAt + WARMUP_DURATION_MS)) / 1000),
      ),
    }));
  const survivors = activeHiders.map((p) => ({ id: p.id, name: p.name }));
  const eliminated = hiders
    .filter((p) => p.status === 'eliminated')
    .map((p) => ({ id: p.id, name: p.name }));

  const allEliminated = hiders.length > 0 && eliminated.length === hiders.length;
  const winner: MatchSummary['winner'] = allEliminated ? 'seeker' : 'hiders';
  const reason: MatchSummary['reason'] = allEliminated
    ? 'all_eliminated'
    : activeHiders.length === 0
      ? 'all_resolved'
      : 'time_up';

  const durationSec = Math.max(
    1,
    Math.round((nowMs - (room.matchStartedAt + WARMUP_DURATION_MS)) / 1000),
  );

  room.summary = {
    winner,
    reason,
    durationSec,
    seekerId: seeker?.id ?? '',
    seekerName: seeker?.name ?? 'Người Tìm',
    correctGuesses: room.correctGuesses,
    wrongGuesses: room.wrongGuesses,
    visitors,
    survivors,
    eliminated,
  };
  room.phase = 'gameover';
  room.claim = null;

  pushNotification(
    room,
    winner === 'seeker'
      ? `HẾT TRẬN! Người Đi Tìm ${seeker?.name ?? ''} đã loại toàn bộ người trốn!`
      : `HẾT TRẬN! Phe Người Trốn chiến thắng (${visitors.length} Visitor, ${survivors.length} sống sót)!`,
    winner === 'seeker' ? 'danger' : 'success',
    nowMs,
  );

  return true;
}

export function handlePickupItem(
  room: RoomState,
  playerId: string,
  itemId: string,
  nowMs: number,
): { ok: boolean; itemType?: ItemType; reason?: string } {
  if (room.phase !== 'playing' && room.phase !== 'warmup') {
    return { ok: false, reason: 'Chưa thể nhặt vật phẩm.' };
  }
  const player = room.players[playerId];
  if (!player || player.status !== 'active') {
    return { ok: false, reason: 'Chỉ người chơi đang thi đấu mới nhặt được.' };
  }
  const item = room.items.find((it) => it.id === itemId && it.active);
  if (!item) return { ok: false, reason: 'Vật phẩm không còn ở đây.' };
  if (distance2D(player.x, player.z, item.x, item.z) > ITEM_PICKUP_RADIUS + 0.8) {
    return { ok: false, reason: 'Hãy lại gần vật phẩm hơn.' };
  }

  item.active = false;
  item.respawnAt = nowMs + ITEM_RESPAWN_MS;
  player.heldItem = item.type;
  return { ok: true, itemType: item.type };
}

export function handleUseItem(
  room: RoomState,
  playerId: string,
  nowMs: number,
): { ok: boolean; itemType?: ItemType; reason?: string } {
  if (room.phase !== 'playing' && room.phase !== 'warmup') {
    return { ok: false, reason: 'Không thể dùng vật phẩm lúc này.' };
  }
  const player = room.players[playerId];
  if (!player || player.status !== 'active' || !player.heldItem) {
    return { ok: false, reason: 'Bạn không có vật phẩm nào.' };
  }
  if (nowMs < player.stunUntil) {
    return { ok: false, reason: 'Bạn đang bị phạt đứng yên!' };
  }

  const itemType = player.heldItem;
  player.heldItem = null;

  if (itemType === 'almond_water') {
    player.speedBoostUntil = nowMs + 6_000;
  } else if (itemType === 'smoke_bomb') {
    room.smokes.push({
      id: `smoke-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
      x: player.x,
      z: player.z,
      radius: 3.4,
      expiresAt: nowMs + 8_000,
    });
  } else if (itemType === 'emf_scanner') {
    player.emfUntil = nowMs + 5_000;
  } else if (itemType === 'static_cloak') {
    player.cloakUntil = nowMs + 7_000;
  }

  return { ok: true, itemType };
}

export function handleUseSkill(
  room: RoomState,
  playerId: string,
  nowMs: number,
): { ok: boolean; skillName?: string; reason?: string } {
  if (room.phase !== 'playing') {
    return { ok: false, reason: 'Kỹ năng mở khóa sau 10s khởi động!' };
  }
  const player = room.players[playerId];
  if (!player || player.status !== 'active') {
    return { ok: false, reason: 'Không thể kích hoạt kỹ năng.' };
  }
  if (nowMs < player.stunUntil) {
    return { ok: false, reason: 'Đang bị phạt đứng yên!' };
  }
  if (nowMs < player.skillCooldownUntil) {
    return { ok: false, reason: 'Kỹ năng đang hồi chiêu.' };
  }

  player.skillCooldownUntil = nowMs + SKILL_COOLDOWN_MS;

  if (player.role === 'hider') {
    // Decoy Echo: drops a Hazmat hologram right where the hider stands!
    room.decoys.push({
      id: `decoy-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
      ownerId: player.id,
      x: player.x,
      z: player.z,
      yaw: player.yaw,
      suitColor: player.suitColor,
      accentColor: player.accentColor,
      expiresAt: nowMs + 9_000,
    });
    return { ok: true, skillName: 'Bóng Ma Phân Thân' };
  } else {
    // Seeker Echo Sense: sonar reveals nearby movement + short sprint adrenaline
    player.echoSenseUntil = nowMs + 4_500;
    player.speedBoostUntil = Math.max(player.speedBoostUntil, nowMs + 3_000);
    return { ok: true, skillName: 'Cảm Biến Hơi Thở' };
  }
}

export function resetRoomToLobby(room: RoomState, nowMs: number): void {
  room.phase = 'lobby';
  room.phaseEndsAt = 0;
  room.claim = null;
  room.decoys = [];
  room.smokes = [];
  room.blackoutUntil = 0;
  room.summary = null;
  room.items = buildInitialItems();

  Object.values(room.players).forEach((p, idx) => {
    const spawn = LOBBY_SPAWNS[idx % LOBBY_SPAWNS.length];
    p.role = 'hider';
    p.status = 'active';
    p.x = spawn.x;
    p.z = spawn.z;
    p.yaw = spawn.yaw;
    p.pitch = 0;
    p.heldItem = null;
    p.skillCooldownUntil = 0;
    p.speedBoostUntil = 0;
    p.cloakUntil = 0;
    p.stunUntil = 0;
    p.emfUntil = 0;
    p.echoSenseUntil = 0;
    p.checkedInAt = null;
    p.eliminatedAt = null;
  });

  pushNotification(room, 'Phòng đã quay lại Sảnh Chờ. Mọi tên nhân vật đã hiển thị lại.', 'info', nowMs);
}
