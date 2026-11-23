import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomEngine } from './RoomEngine';
import { WARMUP_DURATION_MS } from './rules';
import type { RoomSnapshot, ServerMessage } from './types';

function createVirtualClient(engine: RoomEngine) {
  const messages: ServerMessage[] = [];
  let latestSnapshot: RoomSnapshot | null = null;
  const id = engine.registerClient({
    send: (msg) => {
      messages.push(msg);
      if (msg.type === 'state') {
        latestSnapshot = msg.snapshot;
      }
    },
  });
  return {
    id,
    messages,
    getSnapshot: () => latestSnapshot,
  };
}

test('RoomEngine runs transport-agnostically in-memory for P2P Host with anti-cheat name hiding', () => {
  const engine = new RoomEngine();
  const c1 = createVirtualClient(engine);
  const c2 = createVirtualClient(engine);
  const c3 = createVirtualClient(engine);

  const t0 = 100_000;
  engine.handleMessage(c1.id, { type: 'join', roomCode: 'BK-101', name: 'An' }, t0);
  engine.handleMessage(c2.id, { type: 'join', roomCode: 'BK-101', name: 'Bình' }, t0 + 10);
  engine.handleMessage(c3.id, { type: 'join', roomCode: 'BK-101', name: 'Chi' }, t0 + 20);

  // Lobby: everyone sees everyone's displayName
  const lobbySnap = c1.getSnapshot();
  assert.ok(lobbySnap);
  assert.equal(lobbySnap.players.length, 3);
  assert.equal(lobbySnap.hostId, c1.id);
  assert.ok(lobbySnap.players.every((p) => p.displayName !== null));

  // Ping / pong latency check
  engine.handleMessage(c2.id, { type: 'ping', t: 12345 }, t0 + 50);
  assert.ok(c2.messages.some((m) => m.type === 'pong' && m.t === 12345));

  // Host starts game -> warmup -> advance past 10s -> playing
  engine.handleMessage(c1.id, { type: 'start_game' }, t0 + 100);
  assert.equal(c1.getSnapshot()?.phase, 'warmup');

  engine.stepSimulation(t0 + 100 + WARMUP_DURATION_MS + 100, 0.05);
  assert.equal(c1.getSnapshot()?.phase, 'playing');

  // Verify anti-cheat: Seeker's snapshot hides ALL active hider names
  const allClients = [c1, c2, c3];
  const seekerClient = allClients.find(
    (c) => c.getSnapshot()?.players.find((p) => p.id === c.id)?.role === 'seeker',
  );
  assert.ok(seekerClient);
  const seekerSnap = seekerClient.getSnapshot()!;
  const hidersInSeekerView = seekerSnap.players.filter((p) => p.role === 'hider');
  assert.equal(hidersInSeekerView.length, 2);
  assert.ok(hidersInSeekerView.every((h) => h.displayName === null && h.actualName === null));
  assert.equal(seekerSnap.activeHiderNames.length, 2);

  engine.dispose();
});

test('RoomEngine supports host bot management and clean disconnect handling', () => {
  const engine = new RoomEngine();
  const host = createVirtualClient(engine);
  const guest = createVirtualClient(engine);

  const t0 = 200_000;
  engine.handleMessage(host.id, { type: 'join', roomCode: 'LAN-9', name: 'Minh' }, t0);
  engine.handleMessage(guest.id, { type: 'join', roomCode: 'LAN-9', name: 'Lan' }, t0 + 10);
  engine.handleMessage(host.id, { type: 'add_bot' }, t0 + 20);

  assert.equal(host.getSnapshot()?.players.length, 3);
  assert.equal(guest.getSnapshot()?.players.length, 3);

  engine.handleDisconnect(guest.id, t0 + 50);
  assert.equal(host.getSnapshot()?.players.length, 2);

  engine.dispose();
});
