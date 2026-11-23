import { useCallback, useEffect, useRef, useState } from 'react';
import { GameHud } from './components/GameHud';
import { LobbyOverlay } from './components/LobbyOverlay';
import { GameOverModal, NamePickerModal, PauseModal } from './components/Modals';
import { TitleScreen } from './components/TitleScreen';
import { BackroomsAudio } from './game/audio';
import {
  BackroomsEngine,
  type CrosshairTarget,
  type EngineFrameReport,
} from './game/BackroomsEngine';
import {
  GameNetworkClient,
  sanitizeRoomCode,
  type NetworkMode,
  type P2PRole,
} from './game/network';
import { PILLAR_POS } from './shared/map';
import type { RoomSnapshot, ServerMessage } from './shared/types';

const INITIAL_REPORT: EngineFrameReport = {
  stamina: 100,
  pointerLocked: false,
  lockedTarget: null,
  nearPillar: false,
  distanceToPillar: 3,
  pillarAngleRad: 0,
  nearItem: null,
  labels: [],
  playerX: 0,
  playerZ: 3.2,
  playerYaw: 0,
};

function generateRandomRoomCode(): string {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `BK-${num}`;
}

function readInitialQuery(): {
  room: string;
  name: string;
  mode: NetworkMode;
  p2pRole: P2PRole;
  autostart: boolean;
} {
  const params = new URLSearchParams(window.location.search);
  const rawMode = params.get('mode');
  const rawRoom = params.get('room');
  const rawRole = params.get('role');
  const autostart = params.get('autostart') === '1';

  let mode: NetworkMode;
  let p2pRole: P2PRole;
  let room: string;

  if (rawMode === 'ws') {
    mode = 'ws';
    p2pRole = 'host';
    room = sanitizeRoomCode(rawRoom || 'LEVEL-0');
  } else if (rawMode === 'p2p') {
    mode = 'p2p';
    if (rawRoom) {
      room = sanitizeRoomCode(rawRoom);
      p2pRole = rawRole === 'host' ? 'host' : 'join';
    } else {
      room = generateRandomRoomCode();
      p2pRole = rawRole === 'join' ? 'join' : 'host';
    }
  } else if (rawRoom) {
    // Legacy invite links (?room=XYZ) default to WebSocket so existing links stay compatible
    mode = 'ws';
    p2pRole = 'host';
    room = sanitizeRoomCode(rawRoom);
  } else {
    // Default fresh visit: P2P Host with a collision-free room code
    mode = 'p2p';
    p2pRole = 'host';
    room = generateRandomRoomCode();
  }

  const savedName = window.localStorage.getItem('backrooms_player_name') || '';
  const name = params.get('name') || savedName || `Khách ${Math.floor(10 + Math.random() * 89)}`;
  return { room, name, mode, p2pRole, autostart };
}

export default function App() {
  const initial = useRef(readInitialQuery());

  const [screen, setScreen] = useState<'title' | 'live'>('title');
  const [playerName, setPlayerName] = useState(initial.current.name);
  const [roomCode, setRoomCode] = useState(initial.current.room);
  const [networkMode, setNetworkMode] = useState<NetworkMode>(initial.current.mode);
  const [p2pRole, setP2PRole] = useState<P2PRole>(initial.current.p2pRole);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [suggestWsFallback, setSuggestWsFallback] = useState(false);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [report, setReport] = useState<EngineFrameReport>(INITIAL_REPORT);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sensitivity, setSensitivity] = useState(0.0022);
  const [pickingTarget, setPickingTarget] = useState<CrosshairTarget | null>(null);
  const [targetedAlert, setTargetedAlert] = useState<string | null>(null);

  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<BackroomsEngine | null>(null);
  const audioRef = useRef<BackroomsAudio | null>(null);
  const networkRef = useRef<GameNetworkClient | null>(null);
  const snapshotRef = useRef<RoomSnapshot | null>(null);
  const reportRef = useRef<EngineFrameReport>(INITIAL_REPORT);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWarmupSecRef = useRef<number>(-1);

  snapshotRef.current = snapshot;
  reportRef.current = report;

  const showTransientError = useCallback((msg: string, sticky = false) => {
    setErrorBanner(msg);
    if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
    if (!sticky) {
      errorTimeoutRef.current = setTimeout(() => setErrorBanner(null), 4500);
    }
  }, []);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      audioRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const handleTogglePause = useCallback(() => {
    setPaused((prev) => !prev);
  }, []);

  const handleHostDisconnected = useCallback(
    (reason: string) => {
      if (document.pointerLockElement && document.exitPointerLock) {
        try {
          document.exitPointerLock();
        } catch {
          // ignore
        }
      }
      setConnecting(false);
      setSnapshot(null);
      setPaused(false);
      setPickingTarget(null);
      setTargetedAlert(null);
      setLatencyMs(null);
      setScreen('title');
      engineRef.current?.setMode('title');
      setSuggestWsFallback(true);
      showTransientError(reason, true);
    },
    [showTransientError],
  );

  const handleInteract = useCallback(
    (ctx: {
      lockedTarget: CrosshairTarget | null;
      nearPillar: boolean;
      nearItem: { id: string; type: string } | null;
    }) => {
      const snap = snapshotRef.current;
      const net = networkRef.current;
      if (!snap || !net) return;
      const me = snap.players.find((p) => p.id === snap.yourId);
      if (!me || me.status !== 'active') return;

      // 1) Seeker locking onto a Hider / Decoy -> Open Name Picker Panel
      if (snap.phase === 'playing' && me.role === 'seeker' && ctx.lockedTarget && me.stunMs <= 0) {
        if (snap.activeHiderNames.length > 0) {
          setPickingTarget(ctx.lockedTarget);
          engineRef.current?.setModalBlockingInput(true);
          return;
        }
      }

      // 2) Pillar Check-in (Seeker checking in claim, OR Hider becoming Visitor!)
      if (snap.phase === 'playing' && ctx.nearPillar && me.stunMs <= 0) {
        if (me.role === 'seeker' && snap.claim?.seekerId === me.id) {
          net.send({ type: 'checkin_pillar' });
          return;
        }
        if (me.role === 'hider') {
          net.send({ type: 'checkin_pillar' });
          return;
        }
      }

      // 3) Pickup nearby Backrooms item
      if ((snap.phase === 'playing' || snap.phase === 'warmup') && ctx.nearItem) {
        net.send({ type: 'pickup_item', itemId: ctx.nearItem.id });
      }
    },
    [],
  );

  const handleServerMessage = useCallback(
    (msg: ServerMessage) => {
      const audio = audioRef.current;
      const engine = engineRef.current;

      if (msg.type === 'welcome') {
        setConnecting(false);
        setErrorBanner(null);
        setSuggestWsFallback(false);
        setScreen('live');
        engine?.setMode('live');
        return;
      }

      if (msg.type === 'error') {
        setConnecting(false);
        showTransientError(msg.message);
        return;
      }

      if (msg.type === 'state') {
        setSnapshot(msg.snapshot);
        engine?.applyServerSnapshot(msg.snapshot);

        // Warmup countdown audio tick
        if (msg.snapshot.phase === 'warmup') {
          const sec = Math.ceil(msg.snapshot.timeRemainingMs / 1000);
          if (sec !== lastWarmupSecRef.current && sec > 0) {
            lastWarmupSecRef.current = sec;
            audio?.playWarmupTick();
          }
        } else {
          lastWarmupSecRef.current = -1;
        }

        // Close name picker if match ended or left playing phase
        if (msg.snapshot.phase !== 'playing') {
          setPickingTarget(null);
        }
        return;
      }

      if (msg.type === 'event') {
        if (msg.kind === 'warmup_start') {
          audio?.playWarmupTick();
        } else if (msg.kind === 'hunt_start') {
          audio?.playHuntStart();
          engine?.triggerImpact(0.35, 0);
        } else if (msg.kind === 'claim_made') {
          audio?.playClaimMade();
        } else if (msg.kind === 'claim_targeted_you') {
          audio?.playTargetedAlert();
          engine?.triggerImpact(0.5, 0);
          const guessed = String(msg.payload?.guessedName || '');
          setTargetedAlert(guessed || msg.message);
          if (targetedTimeoutRef.current) clearTimeout(targetedTimeoutRef.current);
          targetedTimeoutRef.current = setTimeout(() => setTargetedAlert(null), 9000);
        } else if (msg.kind === 'decoy_baited') {
          audio?.playWrongGuessStun();
          engine?.triggerImpact(0.45, 0.04);
          showTransientError('Bị lừa bởi Bóng Ma Phân Thân!');
        } else if (msg.kind === 'elimination') {
          audio?.playElimination();
          engine?.triggerImpact(0.75, 0.06, PILLAR_POS.x, PILLAR_POS.z, 0xef4444);
        } else if (msg.kind === 'wrong_guess_stun') {
          audio?.playWrongGuessStun();
          engine?.triggerImpact(0.65, 0.05, PILLAR_POS.x, PILLAR_POS.z, 0xf97316);
        } else if (msg.kind === 'visitor_win') {
          audio?.playVisitorWin();
          engine?.triggerImpact(0.4, 0, PILLAR_POS.x, PILLAR_POS.z, 0x38bdf8);
        } else if (msg.kind === 'item_pickup') {
          audio?.playPickup();
        } else if (msg.kind === 'skill_used') {
          audio?.playSkill();
        } else if (msg.kind === 'blackout_start') {
          audio?.playHuntStart();
        }
      }
    },
    [showTransientError],
  );

  // Store latest handlers in refs so engine & network mount ONCE without tearing down WebGL
  const interactRef = useRef(handleInteract);
  interactRef.current = handleInteract;
  const serverMsgRef = useRef(handleServerMessage);
  serverMsgRef.current = handleServerMessage;
  const muteRef = useRef(handleToggleMute);
  muteRef.current = handleToggleMute;
  const pauseRef = useRef(handleTogglePause);
  pauseRef.current = handleTogglePause;
  const hostDisconnectRef = useRef(handleHostDisconnected);
  hostDisconnectRef.current = handleHostDisconnected;
  const showErrRef = useRef(showTransientError);
  showErrRef.current = showTransientError;

  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const audio = new BackroomsAudio();
    audioRef.current = audio;

    const net = new GameNetworkClient({
      onMessage: (m) => serverMsgRef.current(m),
      onClose: () => {
        setConnecting(false);
      },
      onLatency: (ms) => {
        setLatencyMs(ms);
      },
      onTransportError: (err) => {
        setConnecting(false);
        setSuggestWsFallback(Boolean(err.suggestWsFallback));
        showErrRef.current(err.message, Boolean(err.suggestWsFallback));
      },
      onHostDisconnected: (reason) => {
        hostDisconnectRef.current(reason);
      },
    });
    networkRef.current = net;

    const engine = new BackroomsEngine(mount, audio, {
      onSendMove: (payload) => net.send({ type: 'move', ...payload }),
      onReport: (rep) => setReport(rep),
      onInteract: (ctx) => interactRef.current(ctx),
      onUseItem: () => net.send({ type: 'use_item' }),
      onUseSkill: () => net.send({ type: 'use_skill' }),
      onTogglePause: () => pauseRef.current(),
      onToggleMute: () => muteRef.current(),
    });
    engineRef.current = engine;

    if (initial.current.autostart) {
      setConnecting(true);
      net.connect({
        mode: initial.current.mode,
        p2pRole: initial.current.p2pRole,
        roomCode: initial.current.room,
        name: initial.current.name,
      });
    }

    return () => {
      engine.dispose();
      net.dispose();
      audio.dispose();
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
      if (targetedTimeoutRef.current) clearTimeout(targetedTimeoutRef.current);
    };
  }, []);

  // Sync game state to document.body.dataset.state & engine modal locks
  useEffect(() => {
    const isGameOver = screen === 'live' && snapshot?.phase === 'gameover';
    const stateAttr =
      screen === 'title'
        ? 'title'
        : isGameOver
          ? 'gameover'
          : paused
            ? 'paused'
            : 'playing';
    document.body.dataset.state = stateAttr;

    engineRef.current?.setPaused(paused);
    engineRef.current?.setModalBlockingInput(Boolean(pickingTarget) || isGameOver);
  }, [screen, snapshot?.phase, paused, pickingTarget]);

  const handleChangeNetworkMode = useCallback((mode: NetworkMode) => {
    setNetworkMode(mode);
    setErrorBanner(null);
    setSuggestWsFallback(false);
    if (mode === 'ws' && roomCode.startsWith('BK-')) {
      setRoomCode('LEVEL-0');
    } else if (mode === 'p2p' && roomCode === 'LEVEL-0' && p2pRole === 'host') {
      setRoomCode(generateRandomRoomCode());
    }
  }, [roomCode, p2pRole]);

  const handleChangeP2PRole = useCallback((role: P2PRole) => {
    setP2PRole(role);
    setErrorBanner(null);
    setSuggestWsFallback(false);
    if (role === 'host' && (!roomCode.trim() || roomCode === 'LEVEL-0')) {
      setRoomCode(generateRandomRoomCode());
    }
  }, [roomCode]);

  const handleGenerateRoomCode = useCallback(() => {
    setRoomCode(generateRandomRoomCode());
    setErrorBanner(null);
    setSuggestWsFallback(false);
  }, []);

  const handleEnterRoom = useCallback(() => {
    const cleanName = playerName.trim();
    if (!cleanName) {
      showTransientError('Vui lòng nhập tên nhân vật trước khi vào phòng.');
      return;
    }
    const cleanRoom = sanitizeRoomCode(roomCode);
    setRoomCode(cleanRoom);
    window.localStorage.setItem('backrooms_player_name', cleanName);
    audioRef.current?.unlock();
    setConnecting(true);
    setErrorBanner(null);
    setSuggestWsFallback(false);
    networkRef.current?.connect({
      mode: networkMode,
      p2pRole,
      roomCode: cleanRoom,
      name: cleanName,
    });
  }, [playerName, roomCode, networkMode, p2pRole, showTransientError]);

  const handleSwitchToWsAndConnect = useCallback(() => {
    const cleanName = playerName.trim() || 'Khách';
    const cleanRoom = sanitizeRoomCode(roomCode);
    setNetworkMode('ws');
    setErrorBanner(null);
    setSuggestWsFallback(false);
    setConnecting(true);
    window.localStorage.setItem('backrooms_player_name', cleanName);
    audioRef.current?.unlock();
    networkRef.current?.connect({
      mode: 'ws',
      roomCode: cleanRoom,
      name: cleanName,
    });
  }, [playerName, roomCode]);

  const handleLeaveRoom = useCallback(() => {
    networkRef.current?.disconnect();
    setSnapshot(null);
    setPaused(false);
    setPickingTarget(null);
    setTargetedAlert(null);
    setLatencyMs(null);
    setConnecting(false);
    setScreen('title');
    engineRef.current?.setMode('title');
  }, []);

  const handlePickName = useCallback(
    (guessedName: string) => {
      if (!pickingTarget) return;
      networkRef.current?.send({
        type: 'guess_target',
        targetId: pickingTarget.entityId,
        targetIsDecoy: pickingTarget.isDecoy,
        guessedName,
      });
      setPickingTarget(null);
      engineRef.current?.setModalBlockingInput(false);
    },
    [pickingTarget],
  );

  const handleCancelPick = useCallback(() => {
    setPickingTarget(null);
    engineRef.current?.setModalBlockingInput(false);
  }, []);

  const handleChangeSensitivity = useCallback((val: number) => {
    setSensitivity(val);
    engineRef.current?.setSensitivity(val);
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0e0d08]">
      {/* Isolated WebGL Canvas Mount — never re-created by React HUD state updates */}
      <div ref={canvasMountRef} className="fixed inset-0 z-0" />

      {screen === 'title' && (
        <TitleScreen
          playerName={playerName}
          roomCode={roomCode}
          networkMode={networkMode}
          p2pRole={p2pRole}
          onChangeName={setPlayerName}
          onChangeRoomCode={setRoomCode}
          onChangeNetworkMode={handleChangeNetworkMode}
          onChangeP2PRole={handleChangeP2PRole}
          onGenerateRoomCode={handleGenerateRoomCode}
          onEnterRoom={handleEnterRoom}
          connecting={connecting}
          errorText={errorBanner}
          suggestWsFallback={suggestWsFallback}
          onSwitchToWsAndConnect={handleSwitchToWsAndConnect}
        />
      )}

      {screen === 'live' && snapshot && (
        <>
          <GameHud
            snapshot={snapshot}
            report={report}
            muted={muted}
            targetedAlert={targetedAlert}
            onToggleMute={handleToggleMute}
            onTogglePause={handleTogglePause}
            onQuickInteract={() =>
              handleInteract({
                lockedTarget: reportRef.current.lockedTarget,
                nearPillar: reportRef.current.nearPillar,
                nearItem: reportRef.current.nearItem,
              })
            }
            onUseSkill={() => networkRef.current?.send({ type: 'use_skill' })}
            onUseItem={() => networkRef.current?.send({ type: 'use_item' })}
          />

          {snapshot.phase === 'lobby' && (
            <LobbyOverlay
              snapshot={snapshot}
              networkMode={networkMode}
              p2pRole={p2pRole}
              latencyMs={latencyMs}
              onStartGame={() => networkRef.current?.send({ type: 'start_game' })}
              onAddBot={() => networkRef.current?.send({ type: 'add_bot' })}
              onRemoveBot={() => networkRef.current?.send({ type: 'remove_bot' })}
              onLeaveRoom={handleLeaveRoom}
            />
          )}

          {errorBanner && (
            <div
              role="alert"
              className="fixed bottom-24 right-4 z-30 bg-[#2b1010]/95 border border-[#ef4444] text-[#fecaca] text-xs font-medium px-3.5 py-2 rounded max-w-xs"
            >
              {errorBanner}
            </div>
          )}

          {pickingTarget && snapshot.phase === 'playing' && (
            <NamePickerModal
              candidateNames={snapshot.activeHiderNames}
              onPickName={handlePickName}
              onCancel={handleCancelPick}
            />
          )}

          {paused && snapshot.phase !== 'gameover' && (
            <PauseModal
              muted={muted}
              sensitivity={sensitivity}
              onChangeSensitivity={handleChangeSensitivity}
              onToggleMute={handleToggleMute}
              onResume={() => setPaused(false)}
              onLeaveRoom={handleLeaveRoom}
            />
          )}

          {snapshot.phase === 'gameover' && snapshot.summary && (
            <GameOverModal
              summary={snapshot.summary}
              isHost={snapshot.hostId === snapshot.yourId}
              onPlayAgain={() => networkRef.current?.send({ type: 'start_game' })}
              onReturnLobby={() => networkRef.current?.send({ type: 'return_lobby' })}
            />
          )}
        </>
      )}
    </div>
  );
}
