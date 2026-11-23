import type { EngineFrameReport } from '../game/BackroomsEngine';
import { ITEM_META, type RoomSnapshot } from '../shared/types';
import { ItemIconSvg, PauseIconSvg, SkillIconSvg, VolumeIconSvg } from './HudIcons';

interface GameHudProps {
  snapshot: RoomSnapshot;
  report: EngineFrameReport;
  muted: boolean;
  targetedAlert: string | null;
  onToggleMute: () => void;
  onTogglePause: () => void;
  onQuickInteract: () => void;
  onUseSkill: () => void;
  onUseItem: () => void;
}

function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function GameHud({
  snapshot,
  report,
  muted,
  targetedAlert,
  onToggleMute,
  onTogglePause,
  onQuickInteract,
  onUseSkill,
  onUseItem,
}: GameHudProps) {
  const me = snapshot.players.find((p) => p.id === snapshot.yourId);
  const activeHidersCount = snapshot.players.filter(
    (p) => p.role === 'hider' && p.status === 'active',
  ).length;
  const visitorsCount = snapshot.players.filter((p) => p.status === 'visitor').length;

  const isWarmup = snapshot.phase === 'warmup';
  const isPlaying = snapshot.phase === 'playing';
  const isSeeker = me?.role === 'seeker';
  const isVisitor = me?.status === 'visitor';
  const isEliminated = me?.status === 'eliminated';
  const isStunned = Boolean(me && me.stunMs > 0);
  const isSeekerBlindfolded = isWarmup && isSeeker;

  const myClaim = snapshot.claim && snapshot.claim.seekerId === me?.id ? snapshot.claim : null;
  const beingTargeted = Boolean(snapshot.claim?.isTargetingMe);

  // Build contextual center interaction prompt
  let centerPrompt: string | null = null;
  if (isPlaying && me && me.status === 'active' && !isStunned) {
    if (isSeeker && report.lockedTarget) {
      centerPrompt = report.lockedTarget.isDecoy
        ? '[E / Click] Điểm mặt mục tiêu!'
        : `[E / Click] Điểm mặt mục tiêu! (${report.lockedTarget.distance}m)`;
    } else if (report.nearPillar) {
      if (isSeeker && myClaim) {
        centerPrompt = `[E] Chốt tên "${myClaim.guessedName}" tại Cột Điểm Danh!`;
      } else if (!isSeeker) {
        centerPrompt = '[E] Check-in Cột — Hóa thân VISITOR (Thắng ngay)!';
      }
    } else if (report.nearItem) {
      centerPrompt = `[E] Nhặt ${ITEM_META[report.nearItem.type].name}`;
    }
  } else if (isWarmup && me && !isSeeker && report.nearItem) {
    centerPrompt = `[E] Nhặt ${ITEM_META[report.nearItem.type].name}`;
  }

  const skillName = isSeeker ? 'Cảm Biến Hơi Thở' : 'Bóng Ma Phân Thân';
  const skillCooldownSec = me ? Math.ceil(me.skillCooldownMs / 1000) : 0;

  return (
    <div className="fixed inset-0 z-10 pointer-events-none overflow-hidden">
      {/* Subtle VHS scanlines */}
      <div className="absolute inset-0 vhs-scanlines opacity-35" />

      {/* Seeker 10-second Warmup Blindfold Curtain */}
      {isSeekerBlindfolded && (
        <div className="absolute inset-0 bg-[#0a0906]/95 flex flex-col items-center justify-center text-center px-6">
          <div className="text-xs font-mono-tabular tracking-[0.28em] uppercase text-[#e2c256]">
            NĂM · MƯỜI · MƯỜI LĂM · HAI MƯƠI
          </div>
          <div className="mt-2 text-5xl sm:text-6xl font-display font-bold text-[#f4edd3]">
            ĐANG BỊT MẮT ĐẾM
          </div>
          <div className="mt-4 text-6xl font-mono-tabular font-bold text-[#ef4444]">
            {Math.ceil(snapshot.timeRemainingMs / 1000)}s
          </div>
          <p className="mt-4 max-w-md text-sm text-[#c7be98]">
            Người trốn đang tản vào mê cung Level 0. Khi đồng hồ về 0, tên người trốn sẽ ẩn hết — hãy dùng trí nhớ để điểm mặt và chạy về Cột Điểm Danh!
          </p>
        </div>
      )}

      {/* 5-Second Wrong Guess Stun Overlay */}
      {isStunned && me && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center text-center"
          style={{
            background:
              'radial-gradient(circle, rgba(127,29,29,0.22) 25%, rgba(45,8,8,0.82) 100%)',
          }}
        >
          <div className="bg-[#1b0b0b]/95 border border-[#ef4444] px-8 py-5 rounded">
            <div className="text-xs font-mono-tabular tracking-widest uppercase text-[#fca5a5]">
              Đoán sai tên nhân vật
            </div>
            <div className="mt-1 text-3xl font-display font-bold text-white tracking-wide">
              PHẠT ĐỨNG YÊN TẠI CHỖ
            </div>
            <div className="mt-2 text-5xl font-mono-tabular font-bold text-[#f87171]">
              {(me.stunMs / 1000).toFixed(1)}s
            </div>
          </div>
        </div>
      )}

      {/* Projected 3D-to-2D Floating Nameplates & Pillar Beacon */}
      {!isSeekerBlindfolded &&
        report.labels.map((lbl) => (
          <div
            key={lbl.id}
            style={{
              transform: `translate3d(${lbl.x}px, ${lbl.y}px, 0) translate(-50%, -100%)`,
            }}
            className="absolute left-0 top-0 will-change-transform text-center whitespace-nowrap"
          >
            <div
              className={`px-2 py-0.5 rounded text-xs font-semibold hud-stroke ${
                lbl.tone === 'pillar'
                  ? 'bg-[#1a160b]/85 text-[#f3d164] border border-[#a88b31]/70 font-mono-tabular'
                  : lbl.tone === 'visitor'
                    ? 'bg-[#082032]/85 text-[#7dd3fc] border border-[#38bdf8]/60'
                    : lbl.tone === 'seeker'
                      ? 'bg-[#2a0c0c]/85 text-[#fca5a5] border border-[#ef4444]/60'
                      : 'bg-[#15130b]/85 text-[#f6efd6] border border-[#807346]/60'
              }`}
            >
              {lbl.text}
              {lbl.subtext && (
                <span className="ml-1.5 text-[10px] opacity-85 font-mono-tabular">
                  · {lbl.subtext}
                </span>
              )}
            </div>
          </div>
        ))}

      {/* TOP-LEFT: Compact Backrooms VHS Match Status Cluster */}
      <div className="absolute top-4 left-4 flex items-center gap-4 bg-[#14120b]/88 border border-[#4f4628] rounded px-3.5 py-2">
        <div>
          <div className="text-[10px] font-mono-tabular uppercase tracking-widest text-[#b5aa82]">
            {snapshot.phase === 'lobby'
              ? 'Sảnh Chờ'
              : isWarmup
                ? 'Khởi Động'
                : isVisitor
                  ? 'Visitor · Đã Thắng'
                  : isEliminated
                    ? 'Đã Bị Loại · Quan Sát'
                    : isSeeker
                      ? 'Người Đi Tìm'
                      : 'Người Trốn'}
          </div>
          <div
            className={`text-lg font-display font-bold leading-tight tracking-wide ${
              isVisitor
                ? 'text-[#38bdf8]'
                : isEliminated
                  ? 'text-[#a1a1aa]'
                  : isSeeker
                    ? 'text-[#f87171]'
                    : 'text-[#e7c75b]'
            }`}
          >
            {me?.actualName || 'Backrooms'}
          </div>
        </div>

        {(isWarmup || isPlaying) && (
          <>
            <div className="h-8 w-px bg-[#3b341e]" aria-hidden="true" />
            <div>
              <div className="text-[10px] font-mono-tabular uppercase tracking-widest text-[#b5aa82]">
                {isWarmup ? 'Ẩn Tên Sau' : 'Thời Gian'}
              </div>
              <div className="text-xl font-mono-tabular font-bold text-[#f7f0d7] leading-tight">
                {isWarmup
                  ? `${Math.ceil(snapshot.timeRemainingMs / 1000)}s`
                  : formatClock(snapshot.timeRemainingMs)}
              </div>
            </div>

            <div className="h-8 w-px bg-[#3b341e]" aria-hidden="true" />
            <div>
              <div className="text-[10px] font-mono-tabular uppercase tracking-widest text-[#b5aa82]">
                Còn Trốn / Visitor
              </div>
              <div className="text-xl font-mono-tabular font-bold leading-tight">
                <span className="text-[#e7c75b]">{activeHidersCount}</span>
                <span className="text-[#6f6647] mx-1">/</span>
                <span className="text-[#38bdf8]">{visitorsCount}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* TOP-CENTER: High-Priority Contextual Banners */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 max-w-[92vw] w-[460px]">
        {isWarmup && !isSeeker && (
          <div className="bg-[#1b170b]/92 border border-[#d8b53e] px-4 py-2 rounded text-center">
            <div className="text-xs font-mono-tabular uppercase tracking-widest text-[#e7c75b]">
              10 Giây Khởi Động — Chạy Trốn Ngay!
            </div>
            <div className="text-sm font-medium text-[#f4edd3]">
              Tên của bạn sẽ bị ẩn sau{' '}
              <span className="font-mono-tabular font-bold text-[#fbbf24]">
                {Math.ceil(snapshot.timeRemainingMs / 1000)}s
              </span>
            </div>
          </div>
        )}

        {/* CRITICAL: Hider Alert showing the exact name the Seeker called on them! */}
        {(beingTargeted || targetedAlert) && !isSeeker && me?.status === 'active' && (
          <div
            role="alert"
            className="bg-[#2e0b0b]/95 border-2 border-[#ef4444] px-4 py-2.5 rounded text-center w-full"
          >
            <div className="text-[11px] font-mono-tabular font-bold uppercase tracking-widest text-[#fca5a5]">
              BẠN VỪA BỊ NGƯỜI TÌM ĐIỂM MẶT!
            </div>
            <div className="mt-0.5 text-base font-bold text-white">
              Người tìm gọi bạn là:{' '}
              <span className="text-[#fde047] underline">
                {snapshot.claim?.guessedName || targetedAlert}
              </span>
            </div>
            <div className="text-xs text-[#fecaca] mt-0.5">
              Chạy về Cột Điểm Danh ({report.distanceToPillar}m) ngay trước khi bị chốt tên!
            </div>
          </div>
        )}

        {/* Seeker Active Claim Sprint Objective */}
        {myClaim && isSeeker && !isStunned && (
          <div className="bg-[#29110a]/95 border-2 border-[#f97316] px-4 py-2 rounded text-center w-full">
            <div className="text-[11px] font-mono-tabular uppercase tracking-widest text-[#fdba74]">
              Đã Gọi Tên — Chạy Nhanh Về Cột!
            </div>
            <div className="text-base font-bold text-white">
              Chốt tên <span className="text-[#fde047]">&ldquo;{myClaim.guessedName}&rdquo;</span> · Cách Cột{' '}
              <span className="font-mono-tabular">{report.distanceToPillar}m</span>
            </div>
          </div>
        )}

        {/* Blackout Surge Warning */}
        {snapshot.isBlackout && (
          <div className="bg-[#18150c]/92 border border-[#a16207] px-3.5 py-1.5 rounded text-xs font-mono-tabular text-[#fde047]">
            SỰ CỐ TẮT ĐÈN LEVEL 0 · {Math.ceil(snapshot.blackoutRemainingMs / 1000)}s
          </div>
        )}
      </div>

      {/* TOP-RIGHT: Pillar Compass / EMF Radar + Utility Icon Buttons */}
      <div className="absolute top-4 right-4 flex items-start gap-2.5">
        {/* Compact Pillar Direction Compass & EMF Radar */}
        {snapshot.phase !== 'lobby' && (
          <div
            aria-label={`La bàn hướng Cột Điểm Danh cách ${report.distanceToPillar} mét`}
            className="bg-[#14120b]/88 border border-[#4f4628] rounded px-3 py-2 flex items-center gap-2.5"
          >
            <div className="relative w-10 h-10 rounded-full border border-[#5c5230] bg-[#0e0c07] flex items-center justify-center">
              {/* Rotating arrow pointing toward Cột Điểm Danh */}
              <svg
                viewBox="0 0 24 24"
                className="w-6 h-6"
                style={{ transform: `rotate(${(-report.pillarAngleRad * 180) / Math.PI}deg)` }}
                aria-hidden="true"
              >
                <polygon points="12,3 17,18 12,14.5 7,18" fill={myClaim ? '#ef4444' : '#e7c75b'} />
              </svg>
              {/* EMF / Echo Sense Radar Blips */}
              {snapshot.radarPings.map((ping, idx) => {
                const dx = ping.x - report.playerX;
                const dz = ping.z - report.playerZ;
                const worldAngle = Math.atan2(-dx, -dz);
                const rel = worldAngle - report.playerYaw;
                const r = Math.min(15, (ping.distance / 28) * 15);
                const bx = -Math.sin(rel) * r;
                const by = -Math.cos(rel) * r;
                return (
                  <span
                    key={idx}
                    style={{ transform: `translate(${bx}px, ${by}px)` }}
                    className={`absolute w-2 h-2 rounded-full ${
                      ping.kind === 'seeker' ? 'bg-[#ef4444]' : 'bg-[#34d399]'
                    }`}
                  />
                );
              })}
            </div>
            <div className="text-right">
              <div className="text-[10px] font-mono-tabular uppercase text-[#b5aa82]">Về Cột</div>
              <div className="text-base font-mono-tabular font-bold text-[#f3ecd1]">
                {report.distanceToPillar}m
              </div>
              {snapshot.radarPings.length > 0 && (
                <div className="text-[10px] font-mono-tabular text-[#34d399]">
                  EMF: {snapshot.radarPings[0].distance}m
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5 pointer-events-auto">
          <button
            type="button"
            tabIndex={-1}
            aria-label={muted ? 'Bật âm thanh [M]' : 'Tắt âm thanh [M]'}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            className="w-9 h-9 flex items-center justify-center bg-[#14120b]/90 hover:bg-[#262113] text-[#e7c75b] border border-[#524829] rounded cursor-pointer transition-colors"
          >
            <VolumeIconSvg muted={muted} />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Tạm dừng [P]"
            onClick={(e) => {
              e.currentTarget.blur();
              onTogglePause();
            }}
            className="w-9 h-9 flex items-center justify-center bg-[#14120b]/90 hover:bg-[#262113] text-[#e7c75b] border border-[#524829] rounded cursor-pointer transition-colors"
          >
            <PauseIconSvg />
          </button>
        </div>
      </div>

      {/* EXACT CENTER (50%, 50%): Dynamic Crosshair Reticle & Contextual Interact Prompt */}
      {!isSeekerBlindfolded && (
        <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
          <svg viewBox="0 0 32 32" className="w-7 h-7" aria-hidden="true">
            <circle
              cx="16"
              cy="16"
              r={report.lockedTarget ? 10 : 4}
              fill="none"
              stroke={report.lockedTarget ? '#ef4444' : '#f3ecd1'}
              strokeWidth={report.lockedTarget ? 2 : 1.4}
              opacity={report.lockedTarget ? 1 : 0.8}
            />
            <circle cx="16" cy="16" r="1.5" fill={report.lockedTarget ? '#ef4444' : '#f3ecd1'} />
            {report.lockedTarget && (
              <>
                <line x1="16" y1="2" x2="16" y2="7" stroke="#ef4444" strokeWidth="2" />
                <line x1="16" y1="25" x2="16" y2="30" stroke="#ef4444" strokeWidth="2" />
                <line x1="2" y1="16" x2="7" y2="16" stroke="#ef4444" strokeWidth="2" />
                <line x1="25" y1="16" x2="30" y2="16" stroke="#ef4444" strokeWidth="2" />
              </>
            )}
          </svg>

          {centerPrompt && (
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onQuickInteract();
              }}
              className="mt-3 pointer-events-auto px-3.5 py-1.5 text-xs font-semibold bg-[#18150c]/92 text-[#fde047] border border-[#d8b53e] rounded whitespace-nowrap cursor-pointer"
            >
              {centerPrompt}
            </button>
          )}
        </div>
      )}

      {/* BOTTOM-LEFT: Quiet Live Event Feed (latest 3 events) */}
      <div className="absolute bottom-20 left-4 flex flex-col gap-1 max-w-[340px]">
        {snapshot.notifications.slice(0, 3).map((n) => (
          <div
            key={n.id}
            className={`px-2.5 py-1 rounded text-xs font-medium bg-[#12100a]/84 border ${
              n.tone === 'danger'
                ? 'border-[#7f1d1d] text-[#fecaca]'
                : n.tone === 'success'
                  ? 'border-[#0c4a6e] text-[#bae6fd]'
                  : n.tone === 'warning'
                    ? 'border-[#78350f] text-[#fde68a]'
                    : 'border-[#3d3620] text-[#d6ceb0]'
            }`}
          >
            {n.text}
          </div>
        ))}
      </div>

      {/* BOTTOM-CENTER: Stamina Bar + Role Skill [Q] + Held Item [F] */}
      {me && me.status === 'active' && snapshot.phase !== 'lobby' && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-[#14120b]/90 border border-[#4f4628] rounded px-4 py-2.5 pointer-events-auto">
          {/* Stamina Meter */}
          <div className="w-32 sm:w-40">
            <div className="flex justify-between text-[10px] font-mono-tabular uppercase text-[#b5aa82] mb-1">
              <span>{me.speedBoostMs > 0 ? 'Tăng Tốc!' : 'Thể Lực'}</span>
              <span>{report.stamina}%</span>
            </div>
            <div className="h-2 bg-[#292414] rounded-sm overflow-hidden">
              <div
                className="h-full transition-transform duration-100 origin-left"
                style={{
                  transform: `scaleX(${Math.max(0, Math.min(1, report.stamina / 100))})`,
                  backgroundColor: me.speedBoostMs > 0 ? '#60a5fa' : '#e2c256',
                }}
              />
            </div>
          </div>

          <div className="h-9 w-px bg-[#3b341e]" aria-hidden="true" />

          {/* Special Role Skill [Q] */}
          <button
            type="button"
            tabIndex={-1}
            disabled={skillCooldownSec > 0 || !isPlaying}
            onClick={(e) => {
              e.currentTarget.blur();
              onUseSkill();
            }}
            className="flex items-center gap-2 px-2.5 py-1 rounded bg-[#201c11] hover:bg-[#2d2718] border border-[#574d2c] disabled:opacity-50 cursor-pointer transition-colors text-left"
          >
            <SkillIconSvg role={me.role} className="w-6 h-6 shrink-0" />
            <div>
              <div className="text-[10px] font-mono-tabular text-[#d8c477]">
                [Q] {skillCooldownSec > 0 ? `Hồi ${skillCooldownSec}s` : 'Sẵn sàng'}
              </div>
              <div className="text-xs font-semibold text-[#f3ecd1] whitespace-nowrap">
                {skillName}
              </div>
            </div>
          </button>

          {/* Held Hidden Item [F] */}
          <button
            type="button"
            tabIndex={-1}
            disabled={!me.heldItem}
            onClick={(e) => {
              e.currentTarget.blur();
              onUseItem();
            }}
            className="flex items-center gap-2 px-2.5 py-1 rounded bg-[#201c11] hover:bg-[#2d2718] border border-[#574d2c] disabled:opacity-45 cursor-pointer transition-colors text-left"
          >
            {me.heldItem ? (
              <>
                <ItemIconSvg type={me.heldItem} className="w-6 h-6 shrink-0" />
                <div>
                  <div className="text-[10px] font-mono-tabular text-[#93c5fd]">[F] Dùng ngay</div>
                  <div className="text-xs font-semibold text-[#f3ecd1] whitespace-nowrap">
                    {ITEM_META[me.heldItem].name}
                  </div>
                </div>
              </>
            ) : (
              <div className="px-1">
                <div className="text-[10px] font-mono-tabular text-[#8c8364]">[F] Vật phẩm</div>
                <div className="text-xs text-[#9c9271] whitespace-nowrap">Trống (Tìm trong mê cung)</div>
              </div>
            )}
          </button>
        </div>
      )}

      {/* Spectator / Visitor Status Footer */}
      {me && (isVisitor || isEliminated) && snapshot.phase === 'playing' && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-[#101820]/92 border border-[#38bdf8]/60 rounded px-5 py-2.5 text-center">
          <div className="text-xs font-mono-tabular uppercase tracking-widest text-[#7dd3fc]">
            {isVisitor ? 'TRẠNG THÁI VISITOR — BẠN ĐÃ CHIẾN THẮNG!' : 'BẠN ĐÃ BỊ LOẠI — CHẾ ĐỘ QUAN SÁT'}
          </div>
          <div className="text-xs text-[#cbd5e1] mt-0.5">
            Bạn có thể tự do di chuyển xuyên mê cung và nhìn thấy tên của toàn bộ người chơi còn lại.
          </div>
        </div>
      )}
    </div>
  );
}
