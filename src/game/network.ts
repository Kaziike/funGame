import { Peer, type DataConnection, type PeerJSOption } from 'peerjs';
import { RoomEngine } from '../shared/RoomEngine';
import type { ClientMessage, ServerMessage } from '../shared/types';

export type NetworkMode = 'p2p' | 'ws';
export type P2PRole = 'host' | 'join';

export interface ConnectOptions {
  mode: NetworkMode;
  p2pRole?: P2PRole;
  roomCode: string;
  name: string;
}

export interface TransportErrorInfo {
  message: string;
  suggestWsFallback?: boolean;
}

export interface NetworkCallbacks {
  onOpen?: () => void;
  onClose?: () => void;
  onMessage: (msg: ServerMessage) => void;
  onLatency?: (ms: number | null) => void;
  onTransportError?: (err: TransportErrorInfo) => void;
  onHostDisconnected?: (reason: string) => void;
}

const PEER_PREFIX = 'bkr-hs-v1-';
const P2P_CONNECT_TIMEOUT_MS = 10_000;
const PING_INTERVAL_MS = 3_000;

const PEER_OPTIONS: PeerJSOption = {
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  },
};

export function sanitizeRoomCode(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 14);
  return cleaned || 'LEVEL-0';
}

function toPeerId(roomCode: string): string {
  return `${PEER_PREFIX}${sanitizeRoomCode(roomCode)}`;
}

function isRecordMessage(data: unknown): data is { type: string } {
  return Boolean(data && typeof data === 'object' && 'type' in data && typeof (data as { type?: unknown }).type === 'string');
}

export class GameNetworkClient {
  private callbacks: NetworkCallbacks;
  private disposed = false;
  private sessionId = 0;

  private activeMode: NetworkMode = 'p2p';
  private activeP2PRole: P2PRole = 'host';

  // WebSocket transport state
  private ws: WebSocket | null = null;
  private pendingWsJoin: { roomCode: string; name: string } | null = null;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // PeerJS P2P transport state
  private peer: Peer | null = null;
  private hostEngine: RoomEngine | null = null;
  private localHostPlayerId: string | null = null;
  private guestConns = new Map<DataConnection, string>();
  private guestToHostConn: DataConnection | null = null;

  // Shared timers
  private connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(callbacks: NetworkCallbacks) {
    this.callbacks = callbacks;
  }

  connect(options: ConnectOptions): void {
    if (this.disposed) return;

    const cleanRoom = sanitizeRoomCode(options.roomCode);
    const cleanName = options.name.trim().slice(0, 16) || 'Khách';

    this.teardownCurrentSession();
    const sid = ++this.sessionId;
    this.activeMode = options.mode;
    this.activeP2PRole = options.p2pRole ?? 'host';
    this.callbacks.onLatency?.(null);

    if (options.mode === 'ws') {
      this.pendingWsJoin = { roomCode: cleanRoom, name: cleanName };
      this.openWebSocket(sid);
      return;
    }

    if (this.activeP2PRole === 'host') {
      this.startP2PHost(sid, cleanRoom, cleanName);
    } else {
      this.startP2PJoin(sid, cleanRoom, cleanName);
    }
  }

  /** Backwards-compatible helper for WebSocket-only calls */
  connectAndJoin(roomCode: string, name: string): void {
    this.connect({ mode: 'ws', roomCode, name });
  }

  private startPingLoop(sid: number): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    const sendPing = () => {
      if (this.disposed || sid !== this.sessionId) return;
      this.send({ type: 'ping', t: performance.now() });
    };
    sendPing();
    this.pingTimer = setInterval(sendPing, PING_INTERVAL_MS);
  }

  private openWebSocket(sid: number): void {
    if (this.disposed || sid !== this.sessionId) return;

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;

    let opened = false;

    ws.onopen = () => {
      if (this.disposed || sid !== this.sessionId) {
        ws.close();
        return;
      }
      opened = true;
      this.callbacks.onOpen?.();
      if (this.pendingWsJoin) {
        this.send({
          type: 'join',
          roomCode: this.pendingWsJoin.roomCode,
          name: this.pendingWsJoin.name,
        });
      }
      this.startPingLoop(sid);
    };

    ws.onmessage = (ev) => {
      if (this.disposed || sid !== this.sessionId) return;
      try {
        const msg = JSON.parse(String(ev.data)) as ServerMessage;
        if (msg.type === 'pong') {
          const rtt = Math.max(0, Math.round(performance.now() - msg.t));
          this.callbacks.onLatency?.(rtt);
          return;
        }
        this.callbacks.onMessage(msg);
      } catch {
        // ignore malformed packets
      }
    };

    ws.onerror = () => {
      if (this.disposed || sid !== this.sessionId) return;
      if (!opened) {
        this.callbacks.onTransportError?.({
          message: 'Không thể kết nối tới WebSocket Server.',
          suggestWsFallback: false,
        });
      }
    };

    ws.onclose = () => {
      if (this.disposed || sid !== this.sessionId) return;
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      this.callbacks.onClose?.();
      if (this.pendingWsJoin && opened) {
        if (this.wsReconnectTimer) clearTimeout(this.wsReconnectTimer);
        this.wsReconnectTimer = setTimeout(() => {
          if (!this.disposed && sid === this.sessionId && this.pendingWsJoin) {
            this.openWebSocket(sid);
          }
        }, 1800);
      }
    };
  }

  private startP2PHost(sid: number, roomCode: string, name: string): void {
    const peerId = toPeerId(roomCode);
    let opened = false;

    this.connectTimeoutTimer = setTimeout(() => {
      if (this.disposed || sid !== this.sessionId || opened) return;
      this.teardownCurrentSession();
      this.callbacks.onTransportError?.({
        message: 'Hết thời gian mở phòng P2P qua PeerJS Cloud. Bạn có thể chuyển sang WebSocket Server.',
        suggestWsFallback: true,
      });
    }, P2P_CONNECT_TIMEOUT_MS);

    let peer: Peer;
    try {
      peer = new Peer(peerId, PEER_OPTIONS);
    } catch {
      this.teardownCurrentSession();
      this.callbacks.onTransportError?.({
        message: 'Trình duyệt không khởi tạo được WebRTC P2P. Hãy dùng WebSocket Server.',
        suggestWsFallback: true,
      });
      return;
    }

    this.peer = peer;

    peer.on('open', () => {
      if (this.disposed || sid !== this.sessionId) {
        peer.destroy();
        return;
      }
      opened = true;
      if (this.connectTimeoutTimer) {
        clearTimeout(this.connectTimeoutTimer);
        this.connectTimeoutTimer = null;
      }

      const engine = new RoomEngine();
      this.hostEngine = engine;
      engine.startLoop();

      const localPlayerId = engine.registerClient({
        send: (msg) => {
          if (this.disposed || sid !== this.sessionId) return;
          if (msg.type === 'pong') return;
          this.callbacks.onMessage(msg);
        },
      });
      this.localHostPlayerId = localPlayerId;

      this.callbacks.onOpen?.();
      this.callbacks.onLatency?.(0);
      engine.handleMessage(localPlayerId, { type: 'join', roomCode, name });
    });

    peer.on('connection', (conn) => {
      if (this.disposed || sid !== this.sessionId || !this.hostEngine) {
        conn.close();
        return;
      }

      const registerGuest = () => {
        if (this.disposed || sid !== this.sessionId || !this.hostEngine) {
          conn.close();
          return;
        }
        if (this.guestConns.has(conn)) return;

        const guestPlayerId = this.hostEngine.registerClient({
          send: (msg) => {
            if (conn.open) {
              conn.send(msg);
            }
          },
        });
        this.guestConns.set(conn, guestPlayerId);

        conn.on('data', (raw) => {
          if (this.disposed || sid !== this.sessionId || !this.hostEngine) return;
          if (!isRecordMessage(raw)) return;
          this.hostEngine.handleMessage(guestPlayerId, raw as ClientMessage);
        });

        const cleanupGuest = () => {
          const pid = this.guestConns.get(conn);
          if (!pid) return;
          this.guestConns.delete(conn);
          this.hostEngine?.handleDisconnect(pid);
        };

        conn.on('close', cleanupGuest);
        conn.on('error', cleanupGuest);
      };

      if (conn.open) {
        registerGuest();
      } else {
        conn.on('open', registerGuest);
        conn.on('error', () => {
          const pid = this.guestConns.get(conn);
          if (pid) {
            this.guestConns.delete(conn);
            this.hostEngine?.handleDisconnect(pid);
          }
        });
      }
    });

    peer.on('error', (err) => {
      if (this.disposed || sid !== this.sessionId) return;
      const errType = (err as { type?: string }).type ?? '';

      if (!opened) {
        this.teardownCurrentSession();
        if (errType === 'unavailable-id') {
          this.callbacks.onTransportError?.({
            message: `Mã phòng "${roomCode}" đang có người khác làm Host P2P. Bấm "Ngẫu nhiên" để tạo mã mới hoặc chọn "Vào Phòng Bạn Bè".`,
            suggestWsFallback: false,
          });
        } else {
          this.callbacks.onTransportError?.({
            message: 'Không thể kết nối máy chủ tín hiệu PeerJS. Bạn có thể chuyển sang WebSocket Server.',
            suggestWsFallback: true,
          });
        }
      }
    });
  }

  private startP2PJoin(sid: number, roomCode: string, name: string): void {
    const hostPeerId = toPeerId(roomCode);
    let dataChannelOpened = false;

    this.connectTimeoutTimer = setTimeout(() => {
      if (this.disposed || sid !== this.sessionId || dataChannelOpened) return;
      this.teardownCurrentSession();
      this.callbacks.onTransportError?.({
        message: `Hết thời gian kết nối P2P tới phòng "${roomCode}" (NAT chặn hoặc Chủ phòng chưa mở phòng).`,
        suggestWsFallback: true,
      });
    }, P2P_CONNECT_TIMEOUT_MS);

    let peer: Peer;
    try {
      peer = new Peer(PEER_OPTIONS);
    } catch {
      this.teardownCurrentSession();
      this.callbacks.onTransportError?.({
        message: 'Trình duyệt không hỗ trợ WebRTC P2P. Hãy dùng WebSocket Server.',
        suggestWsFallback: true,
      });
      return;
    }

    this.peer = peer;

    peer.on('open', () => {
      if (this.disposed || sid !== this.sessionId) {
        peer.destroy();
        return;
      }

      const conn = peer.connect(hostPeerId, {
        reliable: true,
        serialization: 'json',
      });
      this.guestToHostConn = conn;

      conn.on('open', () => {
        if (this.disposed || sid !== this.sessionId) {
          conn.close();
          return;
        }
        dataChannelOpened = true;
        if (this.connectTimeoutTimer) {
          clearTimeout(this.connectTimeoutTimer);
          this.connectTimeoutTimer = null;
        }
        this.callbacks.onOpen?.();
        conn.send({ type: 'join', roomCode, name } satisfies ClientMessage);
        this.startPingLoop(sid);
      });

      conn.on('data', (raw) => {
        if (this.disposed || sid !== this.sessionId) return;
        if (!isRecordMessage(raw)) return;
        const msg = raw as ServerMessage;
        if (msg.type === 'pong') {
          const rtt = Math.max(0, Math.round(performance.now() - msg.t));
          this.callbacks.onLatency?.(rtt);
          return;
        }
        this.callbacks.onMessage(msg);
      });

      conn.on('close', () => {
        if (this.disposed || sid !== this.sessionId) return;
        this.teardownCurrentSession();
        if (dataChannelOpened) {
          this.callbacks.onHostDisconnected?.('Chủ phòng P2P đã rời phòng hoặc mất kết nối.');
        } else {
          this.callbacks.onTransportError?.({
            message: `Không thể thiết lập kênh P2P tới phòng "${roomCode}".`,
            suggestWsFallback: true,
          });
        }
      });

      conn.on('error', () => {
        if (this.disposed || sid !== this.sessionId) return;
        this.teardownCurrentSession();
        if (dataChannelOpened) {
          this.callbacks.onHostDisconnected?.('Mất kết nối WebRTC tới Chủ phòng P2P.');
        } else {
          this.callbacks.onTransportError?.({
            message: 'Kết nối WebRTC P2P bị chặn bởi tường lửa hoặc NAT nghiêm ngặt.',
            suggestWsFallback: true,
          });
        }
      });
    });

    peer.on('error', (err) => {
      if (this.disposed || sid !== this.sessionId) return;
      const errType = (err as { type?: string }).type ?? '';
      if (!dataChannelOpened) {
        this.teardownCurrentSession();
        if (errType === 'peer-unavailable') {
          this.callbacks.onTransportError?.({
            message: `Không tìm thấy Chủ phòng P2P mã "${roomCode}". Hãy kiểm tra mã phòng hoặc chuyển sang WebSocket Server.`,
            suggestWsFallback: true,
          });
        } else {
          this.callbacks.onTransportError?.({
            message: 'Lỗi kết nối P2P PeerJS. Bạn có thể chuyển sang WebSocket Server.',
            suggestWsFallback: true,
          });
        }
      }
    });
  }

  send(msg: ClientMessage): void {
    if (this.disposed) return;

    if (this.activeMode === 'ws') {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
      }
      return;
    }

    if (this.activeP2PRole === 'host') {
      if (this.hostEngine && this.localHostPlayerId) {
        this.hostEngine.handleMessage(this.localHostPlayerId, msg);
      }
      return;
    }

    if (this.guestToHostConn && this.guestToHostConn.open) {
      this.guestToHostConn.send(msg);
    }
  }

  private teardownCurrentSession(): void {
    this.pendingWsJoin = null;

    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer);
      this.connectTimeoutTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }

    if (this.ws) {
      const sock = this.ws;
      this.ws = null;
      sock.onopen = null;
      sock.onmessage = null;
      sock.onerror = null;
      sock.onclose = null;
      try {
        sock.close();
      } catch {
        // ignore
      }
    }

    for (const conn of this.guestConns.keys()) {
      try {
        conn.close();
      } catch {
        // ignore
      }
    }
    this.guestConns.clear();

    if (this.guestToHostConn) {
      try {
        this.guestToHostConn.close();
      } catch {
        // ignore
      }
      this.guestToHostConn = null;
    }

    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // ignore
      }
      this.peer = null;
    }

    if (this.hostEngine) {
      this.hostEngine.dispose();
      this.hostEngine = null;
    }
    this.localHostPlayerId = null;
  }

  disconnect(): void {
    this.sessionId++;
    this.teardownCurrentSession();
    this.callbacks.onLatency?.(null);
  }

  dispose(): void {
    this.disposed = true;
    this.disconnect();
  }
}
