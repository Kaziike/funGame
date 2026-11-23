import type { ItemType } from '../shared/types';

export function TitleLockupSvg() {
  return (
    <svg
      viewBox="0 0 420 132"
      className="w-full max-w-[390px] h-auto"
      role="img"
      aria-label="Trốn Tìm Backroom Level 0"
    >
      <defs>
        <pattern id="hazard-bar" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="16" fill="#d8b53e" />
          <rect x="8" width="8" height="16" fill="#18160f" />
        </pattern>
      </defs>

      {/* Industrial archival frame top & bottom accent bars */}
      <rect x="0" y="4" width="420" height="7" fill="url(#hazard-bar)" />
      <rect x="0" y="122" width="420" height="3" fill="#d8b53e" opacity="0.65" />

      {/* Level 0 Archival stamp */}
      <text
        x="2"
        y="30"
        fill="#d8b53e"
        fontSize="11.5"
        fontFamily="JetBrains Mono, monospace"
        fontWeight="700"
        letterSpacing="2.1"
      >
        LEVEL 0 · NĂM MƯỜI THỰC ĐỊA
      </text>

      {/* Main Title */}
      <text
        x="0"
        y="80"
        fill="#f3ecd1"
        fontSize="54"
        fontFamily="Barlow Condensed, sans-serif"
        fontWeight="700"
        letterSpacing="1.8"
      >
        TRỐN TÌM
      </text>
      <text
        x="2"
        y="113"
        fill="#e2c256"
        fontSize="36"
        fontFamily="Barlow Condensed, sans-serif"
        fontWeight="700"
        letterSpacing="5.5"
      >
        BACKROOM
      </text>

      {/* Stylized Pillar Silhouette emblem on right */}
      <g transform="translate(352, 24)">
        <rect x="18" y="4" width="26" height="84" rx="2" fill="#2c2718" stroke="#d8b53e" strokeWidth="2" />
        <rect x="18" y="36" width="26" height="18" fill="url(#hazard-bar)" />
        <ellipse cx="31" cy="18" rx="19" ry="5" fill="none" stroke="#f59e0b" strokeWidth="2.5" />
        <line x1="6" y1="88" x2="56" y2="88" stroke="#d8b53e" strokeWidth="2" />
      </g>
    </svg>
  );
}

export function ItemIconSvg({ type, className = 'w-6 h-6' }: { type: ItemType; className?: string }) {
  if (type === 'almond_water') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
        <path d="M9 2h6v3l2 3v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V8l2-3V2z" fill="#1e293b" stroke="#93c5fd" strokeWidth="1.6" />
        <rect x="8.5" y="10.5" width="7" height="6" rx="1" fill="#3b82f6" />
        <path d="M9.5 3.5h5" stroke="#e0f2fe" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'smoke_bomb') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
        <rect x="7" y="6" width="10" height="15" rx="2.5" fill="#292524" stroke="#eab308" strokeWidth="1.6" />
        <rect x="7.5" y="11" width="9" height="4" fill="#ca8a04" />
        <path d="M10 6V4h4v2" stroke="#e7e5e4" strokeWidth="1.6" />
        <circle cx="17" cy="4.5" r="2" fill="none" stroke="#fde047" strokeWidth="1.4" />
      </svg>
    );
  }
  if (type === 'emf_scanner') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
        <rect x="6" y="7" width="12" height="15" rx="2" fill="#1c1917" stroke="#34d399" strokeWidth="1.6" />
        <rect x="8.5" y="9.5" width="7" height="4.5" rx="0.8" fill="#10b981" />
        <line x1="15" y1="7" x2="15" y2="2.5" stroke="#f59e0b" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="15" cy="2.5" r="1.4" fill="#34d399" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <polygon points="12,3 20,12 12,21 4,12" fill="#2e1065" stroke="#c4b5fd" strokeWidth="1.6" />
      <polygon points="12,7 16.5,12 12,17 7.5,12" fill="#7c3aed" />
    </svg>
  );
}

export function SkillIconSvg({ role, className = 'w-6 h-6' }: { role: 'hider' | 'seeker'; className?: string }) {
  if (role === 'seeker') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="#2b1212" stroke="#f87171" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="5" fill="none" stroke="#fca5a5" strokeWidth="1.5" strokeDasharray="3 2" />
        <circle cx="12" cy="12" r="2" fill="#ef4444" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="9.5" cy="8" r="3" fill="#292414" stroke="#e2c256" strokeWidth="1.6" />
      <path d="M5 19v-3a4.5 4.5 0 0 1 9 0v3" fill="#292414" stroke="#e2c256" strokeWidth="1.6" />
      <circle cx="16" cy="9" r="2.4" fill="none" stroke="#fde68a" strokeWidth="1.3" strokeDasharray="2 2" />
      <path d="M14 19v-2.5a3.5 3.5 0 0 1 6 0V19" fill="none" stroke="#fde68a" strokeWidth="1.3" strokeDasharray="2 2" />
    </svg>
  );
}

export function VolumeIconSvg({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
      {muted ? (
        <path d="M16 9l5 6M21 9l-5 6" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" />
      ) : (
        <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}

export function PauseIconSvg() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
    </svg>
  );
}
