import { useEffect } from 'react';
import type { MatchSummary } from '../shared/types';

interface NamePickerModalProps {
  candidateNames: string[];
  onPickName: (name: string) => void;
  onCancel: () => void;
}

export function NamePickerModal({ candidateNames, onPickName, onCancel }: NamePickerModalProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      const num = Number(e.key);
      if (num >= 1 && num <= candidateNames.length) {
        e.preventDefault();
        onPickName(candidateNames[num - 1]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [candidateNames, onPickName, onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Bảng chọn tên nhân vật"
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/55 p-4"
    >
      <div className="w-full max-w-md bg-[#16130b] border-2 border-[#e2c256] rounded p-5 text-[#f4edd3]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-mono-tabular uppercase tracking-widest text-[#e2c256]">
              Điểm Mặt Người Trốn
            </div>
            <h2 className="text-2xl font-display font-bold tracking-wide mt-0.5">
              Đó Là Ai? Chọn Tên Nhân Vật
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="px-2.5 py-1 text-xs font-mono-tabular text-[#b8ae87] hover:text-white border border-[#4a4122] rounded cursor-pointer"
          >
            Hủy [Esc]
          </button>
        </div>

        <p className="mt-2 text-xs text-[#cfc59e]">
          Chọn tên rồi chạy nhanh về Cột Điểm Danh để chốt! Nếu đoán sai, bạn sẽ bị phạt đứng yên 5 giây.
        </p>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {candidateNames.map((name, idx) => (
            <button
              key={name}
              type="button"
              onClick={() => onPickName(name)}
              className="flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm font-semibold bg-[#241f12] hover:bg-[#d8b53e] hover:text-[#14120a] text-[#f5eed4] border border-[#61552f] rounded transition-colors cursor-pointer text-left"
            >
              <span className="truncate">{name}</span>
              <span className="font-mono-tabular text-xs opacity-75 shrink-0">[{idx + 1}]</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface PauseModalProps {
  muted: boolean;
  sensitivity: number;
  onChangeSensitivity: (val: number) => void;
  onToggleMute: () => void;
  onResume: () => void;
  onLeaveRoom: () => void;
}

export function PauseModal({
  muted,
  sensitivity,
  onChangeSensitivity,
  onToggleMute,
  onResume,
  onLeaveRoom,
}: PauseModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Menu tạm dừng"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-4"
    >
      <div className="w-full max-w-sm bg-[#16130b] border border-[#685c34] rounded p-6 text-[#f4edd3]">
        <div className="text-[11px] font-mono-tabular uppercase tracking-widest text-[#d8c477]">
          Level 0 · Tạm Dừng
        </div>
        <h2 className="text-3xl font-display font-bold tracking-wide mt-1">Tạm Dừng</h2>

        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor="sens-slider" className="flex justify-between text-xs text-[#cfc59e] mb-1.5">
              <span>Độ nhạy chuột</span>
              <span className="font-mono-tabular">{Math.round(sensitivity * 10000)}</span>
            </label>
            <input
              id="sens-slider"
              type="range"
              min={0.0008}
              max={0.005}
              step={0.0002}
              value={sensitivity}
              onChange={(e) => onChangeSensitivity(Number(e.target.value))}
              className="w-full accent-[#d8b53e]"
            />
          </div>

          <button
            type="button"
            onClick={onToggleMute}
            className="w-full py-2 px-4 text-xs font-semibold bg-[#241f12] hover:bg-[#322c1a] text-[#ebe3c5] border border-[#574d2c] rounded cursor-pointer"
          >
            Âm thanh: {muted ? 'Đang Tắt [M]' : 'Đang Bật [M]'}
          </button>
        </div>

        <div className="mt-6 space-y-2">
          <button
            type="button"
            onClick={onResume}
            className="w-full py-2.5 px-4 text-sm font-display font-bold tracking-wider uppercase bg-[#d8b53e] hover:bg-[#e5c555] text-[#14120a] rounded cursor-pointer"
          >
            Tiếp Tục Chơi
          </button>
          <button
            type="button"
            onClick={onLeaveRoom}
            className="w-full py-2 px-4 text-xs font-semibold bg-[#241412] hover:bg-[#381d1a] text-[#fca5a5] border border-[#612d25] rounded cursor-pointer"
          >
            Thoát Về Màn Hình Chính
          </button>
        </div>
      </div>
    </div>
  );
}

interface GameOverModalProps {
  summary: MatchSummary;
  isHost: boolean;
  onPlayAgain: () => void;
  onReturnLobby: () => void;
}

export function GameOverModal({
  summary,
  isHost,
  onPlayAgain,
  onReturnLobby,
}: GameOverModalProps) {
  const seekerWon = summary.winner === 'seeker';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Kết quả trận đấu"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="w-full max-w-lg bg-[#16130b] border-2 border-[#d8b53e] rounded p-6 text-[#f4edd3]">
        <div className="text-[11px] font-mono-tabular uppercase tracking-widest text-[#e2c256]">
          Hồ Sơ Kết Thúc · Level 0
        </div>
        <h2
          className={`mt-1 text-4xl font-display font-bold tracking-wide ${
            seekerWon ? 'text-[#f87171]' : 'text-[#38bdf8]'
          }`}
        >
          {seekerWon ? 'NGƯỜI ĐI TÌM THẮNG TUYỆT ĐỐI' : 'PHE NGƯỜI TRỐN CHIẾN THẮNG'}
        </h2>
        <p className="mt-1 text-sm text-[#cfc59e]">
          {summary.reason === 'all_eliminated'
            ? `${summary.seekerName} đã điểm mặt và loại toàn bộ người trốn tại Cột Điểm Danh.`
            : summary.reason === 'time_up'
              ? 'Hết thời gian truy tìm — vẫn còn người trốn sống sót hoặc đã hóa Visitor.'
              : 'Toàn bộ người trốn đã định đoạt số phận trước khi hết giờ.'}
        </p>

        {/* Key Match Stats */}
        <div className="mt-4 grid grid-cols-3 gap-2.5 text-center">
          <div className="bg-[#201c11] border border-[#473f24] rounded p-2.5">
            <div className="text-[10px] font-mono-tabular uppercase text-[#b5aa82]">Thời Lượng</div>
            <div className="text-xl font-mono-tabular font-bold text-[#f3ecd1]">
              {summary.durationSec}s
            </div>
          </div>
          <div className="bg-[#201c11] border border-[#473f24] rounded p-2.5">
            <div className="text-[10px] font-mono-tabular uppercase text-[#b5aa82]">
              Đoán Đúng / Sai
            </div>
            <div className="text-xl font-mono-tabular font-bold">
              <span className="text-[#34d399]">{summary.correctGuesses}</span>
              <span className="text-[#6f6647] mx-1">/</span>
              <span className="text-[#f87171]">{summary.wrongGuesses}</span>
            </div>
          </div>
          <div className="bg-[#201c11] border border-[#473f24] rounded p-2.5">
            <div className="text-[10px] font-mono-tabular uppercase text-[#b5aa82]">Visitor</div>
            <div className="text-xl font-mono-tabular font-bold text-[#38bdf8]">
              {summary.visitors.length}
            </div>
          </div>
        </div>

        {/* Role Outcome Breakdown */}
        <div className="mt-4 space-y-2 text-xs">
          <div className="flex justify-between py-1.5 border-b border-[#2e2817]">
            <span className="text-[#b5aa82]">Người Đi Tìm:</span>
            <span className="font-semibold text-[#fca5a5]">{summary.seekerName}</span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-[#2e2817]">
            <span className="text-[#b5aa82]">Visitor (Check-in thắng):</span>
            <span className="font-semibold text-[#7dd3fc]">
              {summary.visitors.length > 0
                ? summary.visitors.map((v) => `${v.name} (${v.checkedInSec}s)`).join(', ')
                : 'Không có'}
            </span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-[#2e2817]">
            <span className="text-[#b5aa82]">Sống sót khi hết giờ:</span>
            <span className="font-semibold text-[#e7c75b]">
              {summary.survivors.length > 0
                ? summary.survivors.map((s) => s.name).join(', ')
                : 'Không có'}
            </span>
          </div>
          <div className="flex justify-between py-1.5">
            <span className="text-[#b5aa82]">Bị loại tại Cột:</span>
            <span className="font-semibold text-[#f87171]">
              {summary.eliminated.length > 0
                ? summary.eliminated.map((e) => e.name).join(', ')
                : 'Không có'}
            </span>
          </div>
        </div>

        <div className="mt-6 flex flex-col sm:flex-row gap-2.5">
          {isHost ? (
            <>
              <button
                type="button"
                data-start="true"
                onClick={onPlayAgain}
                className="flex-1 py-2.5 px-4 text-sm font-display font-bold tracking-wider uppercase bg-[#d8b53e] hover:bg-[#e5c555] text-[#14120a] rounded cursor-pointer"
              >
                Chơi Ván Mới Ngay
              </button>
              <button
                type="button"
                onClick={onReturnLobby}
                className="py-2.5 px-4 text-xs font-semibold bg-[#241f12] hover:bg-[#332d1a] text-[#ebe3c5] border border-[#574d2c] rounded cursor-pointer"
              >
                Về Sảnh Chờ
              </button>
            </>
          ) : (
            <div className="w-full text-center text-xs text-[#d8c477] py-2 bg-[#211d11] border border-[#4a4122] rounded">
              Đang chờ Chủ phòng bắt đầu ván mới...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
