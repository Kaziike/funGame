import React, { useEffect } from 'react';
import type { NetworkMode, P2PRole } from '../game/network';
import { TitleLockupSvg } from './HudIcons';

interface TitleScreenProps {
  playerName: string;
  roomCode: string;
  networkMode: NetworkMode;
  p2pRole: P2PRole;
  onChangeName: (v: string) => void;
  onChangeRoomCode: (v: string) => void;
  onChangeNetworkMode: (mode: NetworkMode) => void;
  onChangeP2PRole: (role: P2PRole) => void;
  onGenerateRoomCode: () => void;
  onEnterRoom: () => void;
  connecting: boolean;
  errorText: string | null;
  suggestWsFallback: boolean;
  onSwitchToWsAndConnect: () => void;
}

export function TitleScreen({
  playerName,
  roomCode,
  networkMode,
  p2pRole,
  onChangeName,
  onChangeRoomCode,
  onChangeNetworkMode,
  onChangeP2PRole,
  onGenerateRoomCode,
  onEnterRoom,
  connecting,
  errorText,
  suggestWsFallback,
  onSwitchToWsAndConnect,
}: TitleScreenProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (e.key === 'Enter') {
          e.preventDefault();
          onEnterRoom();
        }
        return;
      }
      if (tag === 'BUTTON') return;
      if (e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        onEnterRoom();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onEnterRoom]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onEnterRoom();
  };

  const ctaLabel = connecting
    ? networkMode === 'p2p'
      ? p2pRole === 'host'
        ? 'Đang mở phòng P2P...'
        : 'Đang kết nối tới Host P2P...'
      : 'Đang kết nối Server...'
    : networkMode === 'p2p'
      ? p2pRole === 'host'
        ? 'Tạo Phòng P2P (Làm Host)'
        : 'Kết Nối Phòng P2P'
      : 'Vào Phòng WebSocket';

  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between">
      {/* Left-third atmospheric scrim leaving right 65% live Backrooms flyover clear */}
      <div
        className="absolute inset-y-0 left-0 w-full md:w-[46%] max-w-[560px]"
        style={{
          background:
            'linear-gradient(90deg, rgba(13, 11, 7, 0.94) 0%, rgba(15, 13, 8, 0.86) 68%, rgba(15, 13, 8, 0) 100%)',
        }}
      />

      <main className="relative z-10 flex-1 flex items-center px-6 sm:px-12 lg:px-16">
        <div className="w-full max-w-[420px] pointer-events-auto">
          <TitleLockupSvg />

          <p className="mt-3 text-sm leading-relaxed text-[#cfc6a2]">
            Tối thiểu 3 người chơi. 10 giây chạy trốn trước khi tên bị ẩn — chỉ tâm chuột điểm mặt,
            gọi đúng tên rồi chạy nhanh về Cột Điểm Danh trước khi người trốn kịp hóa Visitor.
          </p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-3.5">
            {/* Connection Mode Switcher */}
            <div>
              <div className="text-xs font-semibold tracking-wider text-[#d8c477] uppercase mb-1.5">
                Chế độ kết nối
              </div>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Chế độ kết nối">
                <button
                  type="button"
                  aria-pressed={networkMode === 'p2p'}
                  disabled={connecting}
                  onClick={() => onChangeNetworkMode('p2p')}
                  className={`py-2 px-3 text-xs font-semibold rounded border transition-colors cursor-pointer whitespace-nowrap ${
                    networkMode === 'p2p'
                      ? 'bg-[#312a14] border-[#e2c256] text-[#f7ecc2]'
                      : 'bg-[#16140c] border-[#453d22] text-[#a79d77] hover:text-[#e7dfb9]'
                  }`}
                >
                  P2P (LAN / PeerJS)
                </button>
                <button
                  type="button"
                  aria-pressed={networkMode === 'ws'}
                  disabled={connecting}
                  onClick={() => onChangeNetworkMode('ws')}
                  className={`py-2 px-3 text-xs font-semibold rounded border transition-colors cursor-pointer whitespace-nowrap ${
                    networkMode === 'ws'
                      ? 'bg-[#312a14] border-[#e2c256] text-[#f7ecc2]'
                      : 'bg-[#16140c] border-[#453d22] text-[#a79d77] hover:text-[#e7dfb9]'
                  }`}
                >
                  Server (WebSocket)
                </button>
              </div>
              <p className="mt-1.5 text-[11px] leading-snug text-[#a99f79]">
                {networkMode === 'p2p'
                  ? 'Máy Chủ phòng chạy trực tiếp game và truyền P2P tới bạn bè (LAN 1–3ms, không tốn tải server).'
                  : 'Kết nối qua máy chủ trung tâm — dùng khi mạng công ty/4G bị chặn WebRTC NAT.'}
              </p>
            </div>

            {networkMode === 'p2p' && (
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Vai trò P2P">
                <button
                  type="button"
                  aria-pressed={p2pRole === 'host'}
                  disabled={connecting}
                  onClick={() => onChangeP2PRole('host')}
                  className={`py-1.5 px-2.5 text-xs font-medium rounded border transition-colors cursor-pointer whitespace-nowrap ${
                    p2pRole === 'host'
                      ? 'bg-[#262111] border-[#bfa244] text-[#f3e7b8]'
                      : 'bg-[#14120b] border-[#38311b] text-[#9b916c] hover:text-[#e5dcba]'
                  }`}
                >
                  Tạo Phòng (Làm Host)
                </button>
                <button
                  type="button"
                  aria-pressed={p2pRole === 'join'}
                  disabled={connecting}
                  onClick={() => onChangeP2PRole('join')}
                  className={`py-1.5 px-2.5 text-xs font-medium rounded border transition-colors cursor-pointer whitespace-nowrap ${
                    p2pRole === 'join'
                      ? 'bg-[#262111] border-[#bfa244] text-[#f3e7b8]'
                      : 'bg-[#14120b] border-[#38311b] text-[#9b916c] hover:text-[#e5dcba]'
                  }`}
                >
                  Vào Phòng Bạn Bè
                </button>
              </div>
            )}

            <div>
              <label
                htmlFor="player-name-input"
                className="block text-xs font-semibold tracking-wider text-[#d8c477] uppercase mb-1.5"
              >
                Tên nhân vật của bạn
              </label>
              <input
                id="player-name-input"
                type="text"
                maxLength={16}
                value={playerName}
                onChange={(e) => onChangeName(e.target.value)}
                placeholder="Nhập tên (vd: Minh)"
                className="w-full px-3.5 py-2.5 text-sm bg-[#16140c] text-[#f5eed4] border border-[#5d522e] rounded focus:outline-none focus:border-[#e2c256]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="room-code-input"
                  className="block text-xs font-semibold tracking-wider text-[#d8c477] uppercase"
                >
                  {networkMode === 'p2p' && p2pRole === 'join'
                    ? 'Mã phòng P2P của Chủ phòng'
                    : 'Mã phòng nhiều người chơi'}
                </label>
                {networkMode === 'p2p' && p2pRole === 'host' && (
                  <button
                    type="button"
                    disabled={connecting}
                    onClick={onGenerateRoomCode}
                    className="text-[11px] font-medium text-[#e2c256] hover:text-[#f5dfa0] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Mã ngẫu nhiên
                  </button>
                )}
              </div>
              <input
                id="room-code-input"
                type="text"
                maxLength={14}
                value={roomCode}
                onChange={(e) => onChangeRoomCode(e.target.value.toUpperCase())}
                placeholder="BK-4821"
                className="w-full px-3.5 py-2.5 text-sm font-mono-tabular uppercase bg-[#16140c] text-[#f5eed4] border border-[#5d522e] rounded focus:outline-none focus:border-[#e2c256]"
              />
            </div>

            {errorText && (
              <div
                role="alert"
                className="text-xs font-medium text-[#fca5a5] bg-[#2a1212] border border-[#7f1d1d] px-3 py-2.5 rounded space-y-2"
              >
                <p>{errorText}</p>
                {suggestWsFallback && networkMode === 'p2p' && (
                  <button
                    type="button"
                    onClick={onSwitchToWsAndConnect}
                    className="w-full py-1.5 px-3 text-xs font-semibold bg-[#3f1d1d] hover:bg-[#522424] text-[#fef2f2] border border-[#b91c1c] rounded transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Chuyển sang WebSocket Server
                  </button>
                )}
              </div>
            )}

            <button
              type="submit"
              data-start="true"
              disabled={connecting}
              className="w-full py-3.5 px-6 text-base font-display font-bold tracking-widest uppercase bg-[#d8b53e] hover:bg-[#e5c555] active:bg-[#c4a231] text-[#14120a] rounded transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
            >
              {ctaLabel}
            </button>
          </form>
        </div>
      </main>

      {/* Single flat control-hint line in bottom safe margin with crisp contrast scrim */}
      <footer
        className="relative z-10 px-6 sm:px-12 lg:px-16 pt-8 pb-5 text-xs font-mono-tabular text-[#ebe2be] hud-stroke"
        style={{
          background:
            'linear-gradient(0deg, rgba(12, 10, 6, 0.84) 0%, rgba(12, 10, 6, 0.45) 55%, rgba(12, 10, 6, 0) 100%)',
        }}
      >
        WASD Di chuyển · Shift Chạy nhanh · C Ngồi ẩn nấp · E / Click Điểm mặt &amp; Check-in · Q Kỹ năng · F Dùng vật phẩm · M Âm thanh
      </footer>
    </div>
  );
}
