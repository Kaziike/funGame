import type { WebSocket } from 'ws';
import { RoomEngine } from '../shared/RoomEngine';
import type { ClientMessage } from '../shared/types';

/**
 * Thin Node.js WebSocket adapter around the transport-agnostic RoomEngine.
 */
export class RoomManager {
  private engine = new RoomEngine();

  startLoop(): void {
    this.engine.startLoop();
  }

  stopLoop(): void {
    this.engine.stopLoop();
  }

  handleConnection(ws: WebSocket): void {
    const playerId = this.engine.registerClient({
      send: (msg) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      },
    });

    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return;
      }
      this.engine.handleMessage(playerId, msg);
    });

    ws.on('close', () => {
      this.engine.handleDisconnect(playerId);
    });

    ws.on('error', () => {
      this.engine.handleDisconnect(playerId);
    });
  }
}
