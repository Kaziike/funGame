export type RoomPhase = 'lobby' | 'warmup' | 'playing' | 'gameover';

export type PlayerRole = 'hider' | 'seeker';

export type PlayerStatus = 'active' | 'visitor' | 'eliminated';

export type ItemType = 'almond_water' | 'smoke_bomb' | 'emf_scanner' | 'static_cloak';

export interface Vec2 {
  x: number;
  z: number;
}

export interface PlayerState {
  id: string;
  name: string;
  isBot: boolean;
  suitColor: string;
  accentColor: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  speed: number;
  crouching: boolean;
  role: PlayerRole;
  status: PlayerStatus;
  heldItem: ItemType | null;
  skillCooldownUntil: number;
  speedBoostUntil: number;
  cloakUntil: number;
  stunUntil: number;
  emfUntil: number;
  echoSenseUntil: number;
  checkedInAt: number | null;
  eliminatedAt: number | null;
}

export interface SeekerClaim {
  seekerId: string;
  targetId: string;
  targetIsDecoy: boolean;
  guessedName: string;
  actualTargetName: string;
  createdAt: number;
}

export interface WorldItem {
  id: string;
  type: ItemType;
  x: number;
  z: number;
  active: boolean;
  respawnAt: number;
}

export interface DecoyEntity {
  id: string;
  ownerId: string;
  x: number;
  z: number;
  yaw: number;
  suitColor: string;
  accentColor: string;
  expiresAt: number;
}

export interface SmokeCloud {
  id: string;
  x: number;
  z: number;
  radius: number;
  expiresAt: number;
}

export interface FeedNotification {
  id: string;
  text: string;
  tone: 'info' | 'warning' | 'danger' | 'success';
  createdAt: number;
}

export interface MatchSummary {
  winner: 'seeker' | 'hiders';
  reason: 'all_eliminated' | 'all_resolved' | 'time_up';
  durationSec: number;
  seekerId: string;
  seekerName: string;
  correctGuesses: number;
  wrongGuesses: number;
  visitors: Array<{ id: string; name: string; checkedInSec: number }>;
  survivors: Array<{ id: string; name: string }>;
  eliminated: Array<{ id: string; name: string }>;
}

export interface RoomState {
  roomCode: string;
  hostId: string | null;
  phase: RoomPhase;
  phaseEndsAt: number;
  matchStartedAt: number;
  serverNow: number;
  blackoutUntil: number;
  nextBlackoutAt: number;
  players: Record<string, PlayerState>;
  claim: SeekerClaim | null;
  items: WorldItem[];
  decoys: DecoyEntity[];
  smokes: SmokeCloud[];
  correctGuesses: number;
  wrongGuesses: number;
  summary: MatchSummary | null;
  notifications: FeedNotification[];
}

export interface PublicPlayerSnapshot {
  id: string;
  /** Visible name or null when hidden from this viewer */
  displayName: string | null;
  /** Only populated in lobby, gameover, or for self/visitors/eliminated */
  actualName: string | null;
  isBot: boolean;
  suitColor: string;
  accentColor: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  speed: number;
  crouching: boolean;
  role: PlayerRole;
  status: PlayerStatus;
  heldItem: ItemType | null;
  skillCooldownMs: number;
  speedBoostMs: number;
  cloakMs: number;
  stunMs: number;
  emfMs: number;
  echoSenseMs: number;
}

export interface PublicClaimSnapshot {
  seekerId: string;
  targetId: string;
  guessedName: string;
  /** True only for the spotted Hider so they know what name the Seeker called on them */
  isTargetingMe: boolean;
}

export interface RadarPing {
  x: number;
  z: number;
  distance: number;
  kind: 'seeker' | 'hider' | 'footstep';
}

export interface RoomSnapshot {
  roomCode: string;
  yourId: string;
  hostId: string | null;
  phase: RoomPhase;
  timeRemainingMs: number;
  serverNow: number;
  isBlackout: boolean;
  blackoutRemainingMs: number;
  players: PublicPlayerSnapshot[];
  /** List of active Hider names available in the Seeker's Name Guess Panel */
  activeHiderNames: string[];
  claim: PublicClaimSnapshot | null;
  items: Array<{ id: string; type: ItemType; x: number; z: number }>;
  decoys: Array<{
    id: string;
    x: number;
    z: number;
    yaw: number;
    suitColor: string;
    accentColor: string;
  }>;
  smokes: Array<{ id: string; x: number; z: number; radius: number }>;
  radarPings: RadarPing[];
  summary: MatchSummary | null;
  notifications: FeedNotification[];
}

export type ClientMessage =
  | { type: 'join'; roomCode: string; name: string }
  | { type: 'move'; x: number; y: number; z: number; yaw: number; pitch: number; speed: number; crouching: boolean }
  | { type: 'start_game' }
  | { type: 'add_bot' }
  | { type: 'remove_bot' }
  | { type: 'guess_target'; targetId: string; targetIsDecoy: boolean; guessedName: string }
  | { type: 'checkin_pillar' }
  | { type: 'pickup_item'; itemId: string }
  | { type: 'use_item' }
  | { type: 'use_skill' }
  | { type: 'return_lobby' }
  | { type: 'ping'; t: number };

export type ServerMessage =
  | { type: 'welcome'; yourId: string; roomCode: string }
  | { type: 'state'; snapshot: RoomSnapshot }
  | {
      type: 'event';
      kind:
        | 'warmup_start'
        | 'hunt_start'
        | 'claim_made'
        | 'claim_targeted_you'
        | 'decoy_baited'
        | 'elimination'
        | 'wrong_guess_stun'
        | 'visitor_win'
        | 'item_pickup'
        | 'skill_used'
        | 'blackout_start'
        | 'match_end';
      message: string;
      payload?: Record<string, string | number | boolean>;
    }
  | { type: 'error'; message: string }
  | { type: 'pong'; t: number };

export const ITEM_META: Record<
  ItemType,
  { name: string; shortDesc: string; color: string }
> = {
  almond_water: {
    name: 'Nước Hạnh Nhân',
    shortDesc: 'Hồi đầy thể lực + Tăng 35% tốc chạy (6s)',
    color: '#60a5fa',
  },
  smoke_bomb: {
    name: 'Bom Khói Huỳnh Quang',
    shortDesc: 'Thả màn khói che tầm nhìn người tìm (8s)',
    color: '#d4c98a',
  },
  emf_scanner: {
    name: 'Máy Quét EMF',
    shortDesc: 'Định vị khoảng cách mục tiêu gần nhất (5s)',
    color: '#34d399',
  },
  static_cloak: {
    name: 'Áo Choàng Nhiễu',
    shortDesc: 'Làm mờ hình dáng & ẩn màu áo (7s)',
    color: '#a78bfa',
  },
};
