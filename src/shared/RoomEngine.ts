import {
  PILLAR_INTERACT_RADIUS,
  PILLAR_POS,
  distance2D,
  findNextPathPoint,
  getAllWalkableCells,
  getHidingSpots,
  hasLineOfSight,
  resolveCircleWallCollision,
} from './map';
import {
  BLACKOUT_DURATION_MS,
  BLACKOUT_INTERVAL_MS,
  ITEM_PICKUP_RADIUS,
  checkAndFinalizeMatchEnd,
  createInitialRoom,
  createPlayer,
  handlePickupItem,
  handlePillarCheckin,
  handleSeekerGuess,
  handleUseItem,
  handleUseSkill,
  pushNotification,
  resetRoomToLobby,
  shouldShowPlayerName,
  startMatch,
  transitionWarmupToPlaying,
} from './rules';
import type {
  ClientMessage,
  PlayerState,
  PublicPlayerSnapshot,
  RadarPing,
  RoomSnapshot,
  RoomState,
  ServerMessage,
} from './types';

export interface RoomClientSocket {
  send: (msg: ServerMessage) => void;
}

interface BotBrain {
  policy: 'stealth_hider' | 'pillar_runner' | 'seeker_hunter';
  goalX: number;
  goalZ: number;
  rethinkAt: number;
  lastGuessAt: number;
}

interface ConnectedClient {
  socket: RoomClientSocket;
  playerId: string;
  roomCode: string;
}

const BOT_NAMES = [
  'Nam [BOT]',
  'Linh [BOT]',
  'Khánh [BOT]',
  'Huy [BOT]',
  'Trang [BOT]',
  'Đức [BOT]',
];

const HIDING_SPOTS = getHidingSpots();
const WALKABLE_CELLS = getAllWalkableCells();

/**
 * Transport-agnostic authoritative Room Engine.
 * Runs identically inside Node.js WebSocket server AND inside a P2P Host browser via PeerJS!
 */
export class RoomEngine {
  private rooms = new Map<string, RoomState>();
  private clients = new Map<string, ConnectedClient>();
  private pendingSockets = new Map<string, RoomClientSocket>();
  private botBrains = new Map<string, BotBrain>();
  private nextClientSeq = 1;
  private nextBotSeq = 1;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  startLoop(): void {
    if (this.tickTimer) return;
    let lastMs = Date.now();
    this.tickTimer = setInterval(() => {
      const nowMs = Date.now();
      const dt = Math.min((nowMs - lastMs) / 1000, 0.1);
      lastMs = nowMs;
      this.tickAllRooms(nowMs, dt);
    }, 50);
  }

  stopLoop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  dispose(): void {
    this.stopLoop();
    this.rooms.clear();
    this.clients.clear();
    this.pendingSockets.clear();
    this.botBrains.clear();
  }

  /**
   * Registers a transport client (WebSocket or PeerJS DataConnection or in-memory local Host)
   * and returns its assigned unique playerId.
   */
  registerClient(socket: RoomClientSocket): string {
    const playerId = `p-${Date.now().toString(36)}-${this.nextClientSeq++}`;
    this.pendingSockets.set(playerId, socket);
    return playerId;
  }

  /**
   * Advances simulation manually by a controlled timestamp/delta (useful for deterministic unit tests).
   */
  stepSimulation(nowMs: number, dt: number): void {
    this.tickAllRooms(nowMs, dt);
  }

  private getOrCreateRoom(roomCode: string, nowMs: number): RoomState {
    const clean =
      roomCode
        .toUpperCase()
        .replace(/[^A-Z0-9-_]/g, '')
        .slice(0, 14) || 'LEVEL-0';
    let room = this.rooms.get(clean);
    if (!room) {
      room = createInitialRoom(clean, nowMs);
      this.rooms.set(clean, room);
    }
    return room;
  }

  private safeSend(socket: RoomClientSocket | undefined, msg: ServerMessage): void {
    if (!socket) return;
    try {
      socket.send(msg);
    } catch {
      // ignore transient closed channel errors
    }
  }

  private broadcastEvent(
    room: RoomState,
    kind: Extract<ServerMessage, { type: 'event' }>['kind'],
    message: string,
    payload?: Record<string, string | number | boolean>,
    onlyPlayerId?: string,
  ): void {
    for (const conn of this.clients.values()) {
      if (conn.roomCode !== room.roomCode) continue;
      if (onlyPlayerId && conn.playerId !== onlyPlayerId) continue;
      this.safeSend(conn.socket, { type: 'event', kind, message, payload });
    }
  }

  handleMessage(playerId: string, msg: ClientMessage, nowMs: number = Date.now()): void {
    const socket = this.clients.get(playerId)?.socket ?? this.pendingSockets.get(playerId);
    if (!socket) return;

    if (msg.type === 'ping') {
      this.safeSend(socket, { type: 'pong', t: msg.t });
      return;
    }

    if (msg.type === 'join') {
      if (this.clients.has(playerId)) {
        this.handleDisconnect(playerId, nowMs);
        this.pendingSockets.set(playerId, socket);
      }

      const room = this.getOrCreateRoom(msg.roomCode || 'LEVEL-0', nowMs);
      const existingCount = Object.keys(room.players).length;
      if (existingCount >= 10) {
        this.safeSend(socket, { type: 'error', message: 'Phòng đã đầy (tối đa 10 người).' });
        return;
      }

      const cleanName = this.ensureUniqueName(room, msg.name || `Khách ${existingCount + 1}`);
      const player = createPlayer(playerId, cleanName, false, existingCount);
      if (room.phase === 'playing' || room.phase === 'warmup') {
        player.status = 'visitor';
      }

      room.players[playerId] = player;
      if (!room.hostId || !room.players[room.hostId] || room.players[room.hostId].isBot) {
        room.hostId = playerId;
      }

      this.pendingSockets.delete(playerId);
      this.clients.set(playerId, { socket, playerId, roomCode: room.roomCode });
      pushNotification(
        room,
        `${player.name} đã bước vào Backrooms (${room.roomCode}).`,
        'info',
        nowMs,
      );

      this.safeSend(socket, { type: 'welcome', yourId: playerId, roomCode: room.roomCode });
      this.broadcastRoomState(room, nowMs);
      return;
    }

    const conn = this.clients.get(playerId);
    if (!conn) return;
    const room = this.rooms.get(conn.roomCode);
    if (!room) return;
    const player = room.players[playerId];
    if (!player) return;

    if (msg.type === 'move') {
      const isSeekerWarmupLocked = room.phase === 'warmup' && player.role === 'seeker';
      const isStunned = nowMs < player.stunUntil;
      if (isSeekerWarmupLocked || isStunned) {
        player.yaw = msg.yaw;
        player.pitch = msg.pitch;
        player.speed = 0;
        return;
      }

      const resolved = resolveCircleWallCollision(msg.x, msg.z);
      player.x = resolved.x;
      player.y = 0;
      player.z = resolved.z;
      player.yaw = msg.yaw;
      player.pitch = msg.pitch;
      player.speed = Math.min(Math.max(msg.speed, 0), 15);
      player.crouching = Boolean(msg.crouching);
      return;
    }

    if (msg.type === 'add_bot') {
      if (room.hostId !== playerId || (room.phase !== 'lobby' && room.phase !== 'gameover')) {
        return;
      }
      const existingCount = Object.keys(room.players).length;
      if (existingCount >= 8) {
        this.safeSend(socket, { type: 'error', message: 'Đã đạt giới hạn 8 người trong phòng.' });
        return;
      }
      const botId = `bot-${this.nextBotSeq++}`;
      const baseName = BOT_NAMES[(this.nextBotSeq - 2) % BOT_NAMES.length];
      const uniqueName = this.ensureUniqueName(room, baseName);
      room.players[botId] = createPlayer(botId, uniqueName, true, existingCount);
      this.botBrains.set(botId, {
        policy: existingCount % 2 === 0 ? 'stealth_hider' : 'pillar_runner',
        goalX: PILLAR_POS.x,
        goalZ: PILLAR_POS.z,
        rethinkAt: 0,
        lastGuessAt: 0,
      });
      pushNotification(room, `Đã thêm ${uniqueName} vào phòng.`, 'info', nowMs);
      this.broadcastRoomState(room, nowMs);
      return;
    }

    if (msg.type === 'remove_bot') {
      if (room.hostId !== playerId || (room.phase !== 'lobby' && room.phase !== 'gameover')) {
        return;
      }
      const botIds = Object.values(room.players)
        .filter((p) => p.isBot)
        .map((p) => p.id);
      const lastBotId = botIds[botIds.length - 1];
      if (lastBotId) {
        const botName = room.players[lastBotId].name;
        delete room.players[lastBotId];
        this.botBrains.delete(lastBotId);
        pushNotification(room, `Đã gỡ ${botName} khỏi phòng.`, 'info', nowMs);
        this.broadcastRoomState(room, nowMs);
      }
      return;
    }

    if (msg.type === 'start_game') {
      if (room.hostId !== playerId) {
        this.safeSend(socket, {
          type: 'error',
          message: 'Chỉ chủ phòng mới có thể bắt đầu ván.',
        });
        return;
      }
      const res = startMatch(room, nowMs);
      if (!res.ok) {
        this.safeSend(socket, { type: 'error', message: res.reason ?? 'Không thể bắt đầu.' });
        return;
      }
      this.assignBotPolicies(room);
      this.broadcastEvent(
        room,
        'warmup_start',
        `${room.players[res.seekerId!].name} là Người Đi Tìm! 10 giây chạy trốn!`,
        { seekerId: res.seekerId! },
      );
      this.broadcastRoomState(room, nowMs);
      return;
    }

    if (msg.type === 'guess_target') {
      const res = handleSeekerGuess(
        room,
        playerId,
        msg.targetId,
        msg.targetIsDecoy,
        msg.guessedName,
        nowMs,
      );
      if (!res.ok) {
        this.safeSend(socket, { type: 'error', message: res.reason ?? 'Không thể điểm mặt.' });
        return;
      }
      if (res.baitedByDecoy) {
        this.broadcastEvent(room, 'decoy_baited', 'Bị lừa bởi Bóng Ma Phân Thân!', {
          seekerId: playerId,
        });
      } else if (res.targetId && res.guessedName) {
        this.broadcastEvent(
          room,
          'claim_made',
          `${player.name} đã gọi tên "${res.guessedName}" và đang chạy về Cột!`,
          { seekerId: playerId, guessedName: res.guessedName },
        );
        this.broadcastEvent(
          room,
          'claim_targeted_you',
          `BẠN BỊ ĐIỂM MẶT! Người tìm gọi tên bạn là "${res.guessedName}" — Chạy về Cột ngay!`,
          { guessedName: res.guessedName },
          res.targetId,
        );
      }
      this.broadcastRoomState(room, nowMs);
      return;
    }

    if (msg.type === 'checkin_pillar') {
      const outcome = handlePillarCheckin(room, playerId, nowMs);
      if (!outcome.ok) {
        this.safeSend(socket, { type: 'error', message: outcome.reason ?? 'Chưa thể Check-in.' });
        return;
      }
      if (outcome.kind === 'elimination') {
        this.broadcastEvent(
          room,
          'elimination',
          `${outcome.targetName} đã bị loại tại Cột Điểm Danh!`,
          { targetId: outcome.targetId ?? '', targetName: outcome.targetName ?? '' },
        );
      } else if (outcome.kind === 'wrong_guess_stun') {
        this.broadcastEvent(
          room,
          'wrong_guess_stun',
          `Đoán sai "${outcome.guessedName}"! ${outcome.actorName} bị phạt đứng yên 5 giây!`,
          { seekerId: playerId },
        );
      } else if (outcome.kind === 'visitor_win') {
        this.broadcastEvent(
          room,
          'visitor_win',
          `${outcome.actorName} đã về Cột thành công — Trở thành VISITOR (Đã Thắng)!`,
          { playerId },
        );
      }
      if (outcome.matchEnded) {
        this.broadcastEvent(room, 'match_end', 'Trận đấu đã kết thúc!');
      }
      this.broadcastRoomState(room, nowMs);
      return;
    }

    if (msg.type === 'pickup_item') {
      const res = handlePickupItem(room, playerId, msg.itemId, nowMs);
      if (res.ok && res.itemType) {
        this.broadcastEvent(
          room,
          'item_pickup',
          'Đã nhặt vật phẩm!',
          { itemType: res.itemType },
          playerId,
        );
        this.broadcastRoomState(room, nowMs);
      }
      return;
    }

    if (msg.type === 'use_item') {
      const res = handleUseItem(room, playerId, nowMs);
      if (!res.ok) {
        this.safeSend(socket, {
          type: 'error',
          message: res.reason ?? 'Không dùng được vật phẩm.',
        });
        return;
      }
      this.broadcastEvent(
        room,
        'skill_used',
        'Đã kích hoạt vật phẩm!',
        { itemType: res.itemType ?? '' },
        playerId,
      );
      this.broadcastRoomState(room, nowMs);
      return;
    }

    if (msg.type === 'use_skill') {
      const res = handleUseSkill(room, playerId, nowMs);
      if (!res.ok) {
        this.safeSend(socket, {
          type: 'error',
          message: res.reason ?? 'Chưa thể dùng kỹ năng.',
        });
        return;
      }
      this.broadcastEvent(
        room,
        'skill_used',
        `Kích hoạt kỹ năng: ${res.skillName}`,
        { skillName: res.skillName ?? '' },
        playerId,
      );
      this.broadcastRoomState(room, nowMs);
      return;
    }

    if (msg.type === 'return_lobby') {
      if (room.hostId !== playerId) return;
      resetRoomToLobby(room, nowMs);
      this.broadcastRoomState(room, nowMs);
      return;
    }
  }

  handleDisconnect(playerId: string, nowMs: number = Date.now()): void {
    this.pendingSockets.delete(playerId);
    const conn = this.clients.get(playerId);
    if (!conn) return;
    this.clients.delete(playerId);

    const room = this.rooms.get(conn.roomCode);
    if (!room) return;
    const leaving = room.players[playerId];

    if (leaving) {
      delete room.players[playerId];
      pushNotification(room, `${leaving.name} đã rời khỏi phòng.`, 'info', nowMs);

      if (room.claim && (room.claim.seekerId === playerId || room.claim.targetId === playerId)) {
        room.claim = null;
      }

      if (leaving.role === 'seeker' && (room.phase === 'warmup' || room.phase === 'playing')) {
        resetRoomToLobby(room, nowMs);
        pushNotification(
          room,
          'Người Đi Tìm đã thoát — phòng trở về Sảnh Chờ.',
          'warning',
          nowMs,
        );
      } else if (room.phase === 'playing') {
        checkAndFinalizeMatchEnd(room, nowMs);
      }
    }

    const humans = Object.values(room.players).filter((p) => !p.isBot);
    if (humans.length === 0) {
      for (const pid of Object.keys(room.players)) {
        this.botBrains.delete(pid);
      }
      this.rooms.delete(room.roomCode);
      return;
    }

    if (room.hostId === playerId || !room.players[room.hostId ?? '']) {
      room.hostId = humans[0].id;
    }

    this.broadcastRoomState(room, nowMs);
  }

  private ensureUniqueName(room: RoomState, raw: string): string {
    const base = raw.trim().slice(0, 16) || 'Khách';
    const existing = new Set(Object.values(room.players).map((p) => p.name.toLowerCase()));
    if (!existing.has(base.toLowerCase())) return base;
    let n = 2;
    while (existing.has(`${base} ${n}`.toLowerCase())) n++;
    return `${base} ${n}`;
  }

  private assignBotPolicies(room: RoomState): void {
    let hiderBotIdx = 0;
    for (const p of Object.values(room.players)) {
      if (!p.isBot) continue;
      if (p.role === 'seeker') {
        this.botBrains.set(p.id, {
          policy: 'seeker_hunter',
          goalX: PILLAR_POS.x,
          goalZ: PILLAR_POS.z + 8,
          rethinkAt: 0,
          lastGuessAt: 0,
        });
      } else {
        const spot =
          HIDING_SPOTS[
            (hiderBotIdx * 3 + Math.floor(Math.random() * 2)) % HIDING_SPOTS.length
          ];
        this.botBrains.set(p.id, {
          policy: hiderBotIdx % 2 === 0 ? 'stealth_hider' : 'pillar_runner',
          goalX: spot.x,
          goalZ: spot.z,
          rethinkAt: 0,
          lastGuessAt: 0,
        });
        hiderBotIdx++;
      }
    }
  }

  private tickAllRooms(nowMs: number, dt: number): void {
    for (const room of this.rooms.values()) {
      room.serverNow = nowMs;

      if (room.phase === 'warmup') {
        if (transitionWarmupToPlaying(room, nowMs)) {
          this.broadcastEvent(
            room,
            'hunt_start',
            'Hết 10 giây! Tên người trốn đã bị ẩn — Người Đi Tìm xuất phát!',
          );
        }
      } else if (room.phase === 'playing') {
        for (const item of room.items) {
          if (!item.active && item.respawnAt > 0 && nowMs >= item.respawnAt) {
            item.active = true;
            item.respawnAt = 0;
          }
        }
        room.decoys = room.decoys.filter((d) => d.expiresAt > nowMs);
        room.smokes = room.smokes.filter((s) => s.expiresAt > nowMs);

        if (nowMs >= room.nextBlackoutAt) {
          room.blackoutUntil = nowMs + BLACKOUT_DURATION_MS;
          room.nextBlackoutAt = nowMs + BLACKOUT_INTERVAL_MS;
          pushNotification(
            room,
            'SỰ CỐ TẮT ĐÈN! Đèn huỳnh quang chập chờn trong 8 giây — Bật đèn pin!',
            'warning',
            nowMs,
          );
          this.broadcastEvent(room, 'blackout_start', 'Sự cố tắt đèn Level 0!');
        }

        if (checkAndFinalizeMatchEnd(room, nowMs)) {
          this.broadcastEvent(room, 'match_end', 'Hết giờ! Trận đấu kết thúc!');
        }
      }

      this.tickBots(room, nowMs, dt);
      this.broadcastRoomState(room, nowMs);
    }
  }

  private tickBots(room: RoomState, nowMs: number, dt: number): void {
    if (room.phase === 'lobby' || room.phase === 'gameover') {
      for (const p of Object.values(room.players)) {
        if (!p.isBot) continue;
        p.speed = 0;
        p.yaw = Math.atan2(PILLAR_POS.x - p.x, PILLAR_POS.z - p.z);
      }
      return;
    }

    const seeker = Object.values(room.players).find((p) => p.role === 'seeker');
    const activeHiders = Object.values(room.players).filter(
      (p) => p.role === 'hider' && p.status === 'active',
    );
    const activeSmokes = room.smokes.filter((s) => s.expiresAt > nowMs);

    for (const bot of Object.values(room.players)) {
      if (!bot.isBot) continue;
      if (bot.status !== 'active') {
        bot.speed = 0;
        continue;
      }
      if (nowMs < bot.stunUntil || (room.phase === 'warmup' && bot.role === 'seeker')) {
        bot.speed = 0;
        continue;
      }

      const brain = this.botBrains.get(bot.id);
      if (!brain) continue;

      const baseSpeed = bot.role === 'seeker' ? 5.2 : 4.65;
      const moveSpeed = nowMs < bot.speedBoostUntil ? baseSpeed * 1.32 : baseSpeed;

      if (bot.role === 'seeker') {
        if (room.claim && room.claim.seekerId === bot.id) {
          brain.goalX = PILLAR_POS.x + 1.6;
          brain.goalZ = PILLAR_POS.z + 1.6;
          if (
            distance2D(bot.x, bot.z, PILLAR_POS.x, PILLAR_POS.z) <=
            PILLAR_INTERACT_RADIUS - 0.3
          ) {
            const outcome = handlePillarCheckin(room, bot.id, nowMs);
            if (outcome.ok && outcome.kind === 'elimination') {
              this.broadcastEvent(room, 'elimination', `${outcome.targetName} đã bị loại!`);
            } else if (outcome.ok && outcome.kind === 'wrong_guess_stun') {
              this.broadcastEvent(
                room,
                'wrong_guess_stun',
                `${bot.name} đoán sai và bị phạt 5s!`,
              );
            }
            continue;
          }
        } else {
          let spotted: PlayerState | null = null;
          for (const h of activeHiders) {
            const d = distance2D(bot.x, bot.z, h.x, h.z);
            if (d < 15 && hasLineOfSight(bot.x, bot.z, h.x, h.z, activeSmokes)) {
              spotted = h;
              break;
            }
          }
          if (spotted && nowMs - brain.lastGuessAt > 3500) {
            brain.lastGuessAt = nowMs;
            const isCloaked = nowMs < spotted.cloakUntil;
            const correctChance = isCloaked ? 0.3 : 0.65;
            let guessedName = spotted.name;
            if (Math.random() > correctChance && activeHiders.length > 1) {
              const others = activeHiders.filter((h) => h.id !== spotted!.id);
              guessedName = others[Math.floor(Math.random() * others.length)].name;
            }
            const res = handleSeekerGuess(room, bot.id, spotted.id, false, guessedName, nowMs);
            if (res.ok && res.targetId && res.guessedName) {
              this.broadcastEvent(
                room,
                'claim_targeted_you',
                `BẠN BỊ ĐIỂM MẶT! ${bot.name} gọi tên bạn là "${res.guessedName}" — Chạy về Cột ngay!`,
                { guessedName: res.guessedName },
                res.targetId,
              );
            }
          } else if (
            nowMs >= brain.rethinkAt ||
            distance2D(bot.x, bot.z, brain.goalX, brain.goalZ) < 1.8
          ) {
            const randCell = WALKABLE_CELLS[Math.floor(Math.random() * WALKABLE_CELLS.length)];
            brain.goalX = randCell.x;
            brain.goalZ = randCell.z;
            brain.rethinkAt = nowMs + 7000;
          }
        }
      } else {
        const isTargetedByClaim = room.claim?.targetId === bot.id;
        const seekerDistToPillar = seeker
          ? distance2D(seeker.x, seeker.z, PILLAR_POS.x, PILLAR_POS.z)
          : 99;
        const myDistToPillar = distance2D(bot.x, bot.z, PILLAR_POS.x, PILLAR_POS.z);

        if (!bot.heldItem) {
          const nearbyItem = room.items.find(
            (it) => it.active && distance2D(bot.x, bot.z, it.x, it.z) <= ITEM_PICKUP_RADIUS,
          );
          if (nearbyItem) {
            handlePickupItem(room, bot.id, nearbyItem.id, nowMs);
          }
        }

        if (
          room.phase === 'playing' &&
          (isTargetedByClaim ||
            (brain.policy === 'pillar_runner' && seekerDistToPillar > 12 && myDistToPillar < 26) ||
            (seekerDistToPillar > 16 && myDistToPillar < 16))
        ) {
          if (bot.heldItem === 'almond_water') {
            handleUseItem(room, bot.id, nowMs);
          }
          brain.goalX = PILLAR_POS.x + 1.5;
          brain.goalZ = PILLAR_POS.z + 1.5;

          if (myDistToPillar <= PILLAR_INTERACT_RADIUS - 0.35) {
            const outcome = handlePillarCheckin(room, bot.id, nowMs);
            if (outcome.ok && outcome.kind === 'visitor_win') {
              this.broadcastEvent(
                room,
                'visitor_win',
                `${bot.name} đã Check-in thành công — VISITOR!`,
              );
            }
            continue;
          }
        } else {
          const distToSeeker = seeker ? distance2D(bot.x, bot.z, seeker.x, seeker.z) : 99;
          if (room.phase === 'playing' && distToSeeker < 8.5) {
            if (nowMs >= bot.skillCooldownUntil) {
              handleUseSkill(room, bot.id, nowMs);
            } else if (bot.heldItem === 'smoke_bomb' || bot.heldItem === 'static_cloak') {
              handleUseItem(room, bot.id, nowMs);
            }
            let bestSpot = HIDING_SPOTS[0];
            let bestScore = -1;
            for (const s of HIDING_SPOTS) {
              const sd = seeker ? distance2D(s.x, s.z, seeker.x, seeker.z) : 10;
              if (sd > bestScore) {
                bestScore = sd;
                bestSpot = s;
              }
            }
            brain.goalX = bestSpot.x;
            brain.goalZ = bestSpot.z;
            brain.rethinkAt = nowMs + 4500;
          } else if (
            nowMs >= brain.rethinkAt &&
            distance2D(bot.x, bot.z, brain.goalX, brain.goalZ) < 1.8
          ) {
            if (brain.policy === 'stealth_hider' && room.phase === 'playing') {
              bot.crouching = true;
              bot.speed = 0;
              brain.rethinkAt = nowMs + 6000;
              continue;
            }
            const nextSpot = HIDING_SPOTS[Math.floor(Math.random() * HIDING_SPOTS.length)];
            brain.goalX = nextSpot.x;
            brain.goalZ = nextSpot.z;
            brain.rethinkAt = nowMs + 8000;
          }
        }
      }

      bot.crouching = false;
      const distGoal = distance2D(bot.x, bot.z, brain.goalX, brain.goalZ);
      if (distGoal > 0.6) {
        const nextPt = findNextPathPoint(bot.x, bot.z, brain.goalX, brain.goalZ);
        const dx = nextPt.x - bot.x;
        const dz = nextPt.z - bot.z;
        const len = Math.hypot(dx, dz) || 1;
        const step = Math.min(moveSpeed * dt, len);
        const resolved = resolveCircleWallCollision(
          bot.x + (dx / len) * step,
          bot.z + (dz / len) * step,
        );
        bot.x = resolved.x;
        bot.z = resolved.z;
        bot.yaw = Math.atan2(dx, dz);
        bot.speed = moveSpeed;
      } else {
        bot.speed = 0;
      }
    }
  }

  private buildSnapshotForViewer(
    room: RoomState,
    viewerId: string,
    nowMs: number,
  ): RoomSnapshot {
    const viewer = room.players[viewerId];
    const activeHiderNames = Object.values(room.players)
      .filter((p) => p.role === 'hider' && p.status === 'active')
      .map((p) => p.name)
      .sort((a, b) => a.localeCompare(b, 'vi'));

    const players: PublicPlayerSnapshot[] = Object.values(room.players).map((p) => {
      const showName = shouldShowPlayerName(viewer, p, room.phase);
      const isCloaked = nowMs < p.cloakUntil && p.id !== viewerId && room.phase === 'playing';
      return {
        id: p.id,
        displayName: showName ? p.name : null,
        actualName:
          showName || p.id === viewerId || room.phase === 'lobby' || room.phase === 'gameover'
            ? p.name
            : null,
        isBot: p.isBot,
        suitColor: isCloaked ? '#cfc378' : p.suitColor,
        accentColor: isCloaked ? '#cfc378' : p.accentColor,
        x: Number(p.x.toFixed(2)),
        y: Number(p.y.toFixed(2)),
        z: Number(p.z.toFixed(2)),
        yaw: Number(p.yaw.toFixed(3)),
        pitch: Number(p.pitch.toFixed(3)),
        speed: Number(p.speed.toFixed(2)),
        crouching: p.crouching,
        role: p.role,
        status: p.status,
        heldItem: p.id === viewerId ? p.heldItem : null,
        skillCooldownMs: Math.max(0, p.skillCooldownUntil - nowMs),
        speedBoostMs: Math.max(0, p.speedBoostUntil - nowMs),
        cloakMs: Math.max(0, p.cloakUntil - nowMs),
        stunMs: Math.max(0, p.stunUntil - nowMs),
        emfMs: Math.max(0, p.emfUntil - nowMs),
        echoSenseMs: Math.max(0, p.echoSenseUntil - nowMs),
      };
    });

    const radarPings: RadarPing[] = [];
    if (viewer && room.phase === 'playing') {
      const hasEmf = nowMs < viewer.emfUntil;
      const hasEcho = nowMs < viewer.echoSenseUntil;
      if (hasEmf || hasEcho) {
        for (const other of Object.values(room.players)) {
          if (other.id === viewer.id || other.status !== 'active') continue;
          const dist = distance2D(viewer.x, viewer.z, other.x, other.z);
          if (viewer.role === 'seeker' && other.role === 'hider') {
            if (hasEmf || (hasEcho && dist <= 22)) {
              radarPings.push({
                x: other.x,
                z: other.z,
                distance: Math.round(dist),
                kind: hasEcho ? 'footstep' : 'hider',
              });
            }
          } else if (viewer.role === 'hider' && other.role === 'seeker' && hasEmf) {
            radarPings.push({
              x: other.x,
              z: other.z,
              distance: Math.round(dist),
              kind: 'seeker',
            });
          }
        }
      }
    }

    return {
      roomCode: room.roomCode,
      yourId: viewerId,
      hostId: room.hostId,
      phase: room.phase,
      timeRemainingMs: Math.max(0, room.phaseEndsAt - nowMs),
      serverNow: nowMs,
      isBlackout: nowMs < room.blackoutUntil,
      blackoutRemainingMs: Math.max(0, room.blackoutUntil - nowMs),
      players,
      activeHiderNames,
      claim: room.claim
        ? {
            seekerId: room.claim.seekerId,
            targetId: room.claim.targetId,
            guessedName: room.claim.guessedName,
            isTargetingMe: room.claim.targetId === viewerId,
          }
        : null,
      items: room.items
        .filter((it) => it.active)
        .map((it) => ({ id: it.id, type: it.type, x: it.x, z: it.z })),
      decoys: room.decoys
        .filter((d) => d.expiresAt > nowMs)
        .map((d) => ({
          id: d.id,
          x: d.x,
          z: d.z,
          yaw: d.yaw,
          suitColor: d.suitColor,
          accentColor: d.accentColor,
        })),
      smokes: room.smokes
        .filter((s) => s.expiresAt > nowMs)
        .map((s) => ({ id: s.id, x: s.x, z: s.z, radius: s.radius })),
      radarPings,
      summary: room.summary,
      notifications: room.notifications.filter((n) => nowMs - n.createdAt < 10_000),
    };
  }

  private broadcastRoomState(room: RoomState, nowMs: number): void {
    for (const conn of this.clients.values()) {
      if (conn.roomCode !== room.roomCode) continue;
      const snapshot = this.buildSnapshotForViewer(room, conn.playerId, nowMs);
      this.safeSend(conn.socket, { type: 'state', snapshot });
    }
  }
}
