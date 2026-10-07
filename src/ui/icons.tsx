/** Small inline icons (24 × 24, stroke = currentColor). Decorative: always aria-hidden. */
import type { ReactNode } from 'react';

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const PinIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M9 3h6l-1 6 4 4H6l4-4-1-6z" />
    <path d="M12 13v8" />
  </Icon>
);
export const CheckIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 12.5l5 5L20 6.5" />
  </Icon>
);
export const CrossIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);
export const PlusIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const TrashIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
);
export const DownloadIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Icon>
);
export const LinkIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Icon>
);
export const PlayIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M7 5l12 7-12 7z" fill="currentColor" />
  </Icon>
);
export const StopIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" />
  </Icon>
);
export const CalendarIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="4" y="5" width="16" height="15" rx="1.5" />
    <path d="M4 10h16M9 3v4M15 3v4" />
  </Icon>
);
export const ArrowLeftIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);
export const UndoIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </Icon>
);
