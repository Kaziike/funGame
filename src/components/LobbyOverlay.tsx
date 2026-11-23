import { useState } from 'react';
import type { NetworkMode, P2PRole } from '../game/network';
import { MIN_PLAYERS_TO_START } from '../shared/rules';
import type { RoomSnapshot } from '../shared/types';

interface LobbyOverlayProps {
  snapshot: RoomSnapshot;
  networkMode: NetworkMode;
  p2pRole: P2PRole;
  latencyMs: number | null;
  onStartGame: () => void;
  onAddBot: () => void;
  onRemoveBot: () => void;
  onLeaveRoom: () => void;
}

export function LobbyOverlay({
  snapshot,
  networkMode,
  p2pRole,
  latencyMs,
  onStartGame,
  onAddBot,
  onRemoveBot,
  onLeaveRoom,
}: LobbyOverlayProps) {
  const [copied, setCopied] = useState(false);
  const isHost = snapshot.hostId === snapshot.yourId;
  const playerCount = snapshot.players.length;
  const botCount = snapshot.players.filter((p) => p.isBot).length;
  const canStart = playerCount >= MIN_PLAYERS_TO_START;

  const connectionLabel =
    networkMode === 'p2p'
      ? p2pRole === 'host'
        ? 'Chế độ: P2P · Bạn làm Host · 0ms'
        : `Chế độ: P2P · Trực tiếp tới Host${latencyMs !== null ? ` · ${latencyMs}ms` : ''}`
      : `Chế độ: WebSocket Server${latencyMs !== null ? ` · ${latencyMs}ms` : ''}`;

  const handleCopyInvite = () => {
    const modeParam = networkMode === 'p2p' ? 'p2p' : 'ws';
    const url = `${window.location.origin}${window.location.pathname}?mode=${modeParam}&room=${encodeURIComponent(snapshot.roomCode)}`;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  return (
    <aside
      aria-label="Sảnh chờ phòng chơi"
      className="fixed left-4 top-20 z-20 w-[308px] sm:w-[330px] pointer-events-auto bg-[#14120b]/92 border border-[#574d2c] rounded p-4 text-[#f0e8cc]"
    >
      <div className="flex items-baseline justify-between gap-2 pb-3 border-b border-[#3a331d]">
        <div className="min-w-0">
          <div className="text-[11px] font-mono-tabular tracking-widest uppercase text-[#b9ae84]">
            Sảnh Chờ · Phòng
          </div>
          <div className="text-xl font-display font-bold tracking-wider text-[#e7c75b] truncate">
            {snapshot.roomCode}
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.currentTarget.blur();
            handleCopyInvite();
          }}
          className="px-2.5 py-1.5 text-xs font-medium bg-[#252113] hover:bg-[#332d1a] text-[#e7c75b] border border-[#574d2c] rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          {copied ? 'Đã chép link!' : 'Chép link mời'}
        </button>
      </div>

      <div className="mt-2 text-[11px] font-mono-tabular text-[#cbbd8b]">
        {connectionLabel}
      </div>

      <div className="mt-2.5 flex items-center justify-between text-xs text-[#cfc59e]">
        <span>Người chơi trong phòng</span>
        <span className="font-mono-tabular font-semibold text-[#f3ecd1]">
          {playerCount} / {MIN_PLAYERS_TO_START} tối thiểu
        </span>
      </div>

      <ul className="mt-2 max-h-44 overflow-y-auto divide-y divide-[#292414]">
        {snapshot.players.map((p) => (
          <li key={p.id} className="py-2 flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0 border border-black/40"
                style={{ backgroundColor: p.accentColor }}
                aria-hidden="true"
              />
              <span className="truncate font-medium">
                {p.displayName || p.actualName}
              </span>
            </div>
            <span className="text-[11px] font-mono-tabular text-[#b9ae84] shrink-0 ml-2">
              {p.id === snapshot.yourId
                ? 'Bạn'
                : p.id === snapshot.hostId
                  ? 'Chủ phòng'
                  : p.isBot
                    ? 'Bot'
                    : 'Khách'}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs leading-relaxed text-[#b5aa82]">
        Hãy ghi nhớ tên &amp; màu dây áo mọi người ngay bây giờ — sau 10 giây khởi động, toàn bộ tên người trốn sẽ bị ẩn!
      </p>

      {networkMode === 'p2p' && p2pRole === 'host' && (
        <p className="mt-1.5 text-[11px] leading-snug text-[#9d926c]">
          Máy bạn đang làm Host P2P trực tiếp — giữ tab này mở để bạn bè kết nối mượt không qua server.
        </p>
      )}

      {isHost ? (
        <div className="mt-4 space-y-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onAddBot();
              }}
              className="flex-1 py-2 px-3 text-xs font-semibold bg-[#252113] hover:bg-[#332d1a] text-[#ebe3c5] border border-[#574d2c] rounded transition-colors cursor-pointer whitespace-nowrap"
            >
              + Thêm Bot
            </button>
            {botCount > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onRemoveBot();
                }}
                className="py-2 px-3 text-xs font-semibold bg-[#251714] hover:bg-[#38211c] text-[#fca5a5] border border-[#612d25] rounded transition-colors cursor-pointer whitespace-nowrap"
              >
                - Gỡ Bot
              </button>
            )}
          </div>

          <button
            type="button"
            disabled={!canStart}
            onClick={(e) => {
              e.currentTarget.blur();
              onStartGame();
            }}
            className="w-full py-2.5 px-4 text-sm font-display font-bold tracking-wider uppercase bg-[#d8b53e] hover:bg-[#e5c555] text-[#14120a] rounded transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {canStart
              ? 'Bắt Đầu (10s Khởi Động)'
              : `Cần thêm ${MIN_PLAYERS_TO_START - playerCount} người nữa`}
          </button>
        </div>
      ) : (
        <div className="mt-4 text-xs font-medium text-[#d8c477] bg-[#211d11] border border-[#4a4122] rounded px-3 py-2">
          Đang chờ Chủ phòng nhấn Bắt Đầu...
        </div>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.currentTarget.blur();
          onLeaveRoom();
        }}
        className="mt-2.5 w-full py-1.5 text-xs text-[#a89e78] hover:text-[#f3ecd1] transition-colors cursor-pointer"
      >
        Rời phòng
      </button>
    </aside>
  );
}
