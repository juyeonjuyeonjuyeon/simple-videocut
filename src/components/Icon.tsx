import type { ReactNode, SVGProps } from 'react'

export type IconName = 'brand' | 'plus' | 'folder' | 'play' | 'pause' | 'repeat' | 'split' | 'layers' |
  'music' | 'palette' | 'text' | 'undo' | 'redo' | 'copy' | 'trash' | 'download' | 'upload' | 'share' | 'close' |
  'warning' | 'screen' | 'video' | 'image' | 'mute' | 'rotate' | 'flipH' | 'flipV' | 'save' | 'panel' | 'crop' | 'lock' | 'unlock' | 'library' | 'search' |
  'eye' | 'eyeOff' | 'zoomIn' | 'zoomOut' | 'fit' | 'marker' | 'grid' | 'list' | 'project' | 'help' | 'shape' | 'settings' | 'removeBackground' |
  'heart' | 'comment' | 'more' | 'user'

// Every icon uses the same 24px grid, optical centre, round joins and stroke
// weight. Filled shapes are reserved for primary actions such as play.
const paths: Record<IconName, ReactNode> = {
  brand: <><rect x="3" y="4.5" width="18" height="15" rx="4"/><path d="m8.2 8.8 5.4 3.2-5.4 3.2z" fill="currentColor" stroke="none"/><path d="M17.5 8.5v7"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  folder: <path d="M3.5 8.5v8.25a2.25 2.25 0 0 0 2.25 2.25h12.5a2.25 2.25 0 0 0 2.25-2.25V9.5a2 2 0 0 0-2-2h-6.4l-2-2H5.5a2 2 0 0 0-2 2Z"/>,
  play: <path d="m8.25 6.5 9 5.5-9 5.5z" fill="currentColor" stroke="none"/>,
  pause: <><rect x="7" y="6" width="3.25" height="12" rx="1" fill="currentColor" stroke="none"/><rect x="13.75" y="6" width="3.25" height="12" rx="1" fill="currentColor" stroke="none"/></>,
  repeat: <><path d="M6 7.5h10.5l-2.5-2.5M18 9.5V8a.5.5 0 0 0-.5-.5M18 16.5H7.5l2.5 2.5M6 14.5V16a.5.5 0 0 0 .5.5"/></>,
  split: <><circle cx="6.5" cy="7" r="2.25"/><circle cx="6.5" cy="17" r="2.25"/><path d="m8.5 8.1 10 8.9M8.5 15.9 18.5 7M12 12h8"/></>,
  layers: <><path d="m12 3.5 8.5 4.25L12 12 3.5 7.75z"/><path d="m4.5 12 7.5 3.75L19.5 12M4.5 16.25 12 20l7.5-3.75"/></>,
  music: <><path d="M9 17V6.5L18 4v10.5"/><circle cx="6.5" cy="17.25" r="2.5"/><circle cx="15.5" cy="14.75" r="2.5"/></>,
  palette: <><path d="M12 3.5a8.5 8.5 0 1 0 0 17h1.35a1.9 1.9 0 0 0 0-3.8H12a2.4 2.4 0 0 1 0-4.8h8.35A8.5 8.5 0 0 0 12 3.5Z"/><circle cx="7.1" cy="10" r=".8" fill="currentColor" stroke="none"/><circle cx="9" cy="6.9" r=".8" fill="currentColor" stroke="none"/><circle cx="13" cy="6.4" r=".8" fill="currentColor" stroke="none"/><circle cx="16.2" cy="8.5" r=".8" fill="currentColor" stroke="none"/></>,
  text: <path d="M5 5.5h14M12 5.5v13M8.25 18.5h7.5"/>,
  undo: <path d="m8.5 7.5-4 4 4 4M5 11.5h8a5.5 5.5 0 0 1 5.5 5.5"/>,
  redo: <path d="m15.5 7.5 4 4-4 4M19 11.5h-8A5.5 5.5 0 0 0 5.5 17"/>,
  copy: <><rect x="8" y="8" width="11" height="11" rx="2.25"/><path d="M16 8V6.25A2.25 2.25 0 0 0 13.75 4h-7.5A2.25 2.25 0 0 0 4 6.25v7.5A2.25 2.25 0 0 0 6.25 16H8"/></>,
  trash: <><path d="M4.5 7h15M9.5 4h5l1 3M7 7l.75 12h8.5L17 7M10 10.5v5M14 10.5v5"/></>,
  download: <><path d="M12 3.5v12M7.5 11l4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/></>,
  upload: <><path d="M12 20.5v-12M7.5 13l4.5-4.5 4.5 4.5"/><path d="M4.5 4.5h15"/></>,
  share: <><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.9 7.6-3.8M8.2 13.1l7.6 3.8"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  warning: <><path d="M10.1 4.6 2.8 17.3A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.7L13.9 4.6a2.2 2.2 0 0 0-3.8 0Z"/><path d="M12 9v4.5M12 17h.01"/></>,
  screen: <><rect x="3" y="4.5" width="18" height="13" rx="2.5"/><path d="M8.5 21h7M12 17.5V21"/></>,
  video: <><rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10 5-2.5v9L16 14"/></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m4.5 17 5-5 3.5 3.5 2.5-2.5 4 4"/></>,
  mute: <><path d="M4 9h4l4-3.5v13L8 15H4z"/><path d="m16 9 5 6M21 9l-5 6"/></>,
  rotate: <><path d="M19 8V3.5l-3 3A8 8 0 1 0 19.2 16"/><path d="M13 6.1a6.2 6.2 0 0 1 3 .7"/></>,
  flipH: <><path d="M12 3v18" strokeDasharray="2.5 2.5"/><path d="m9 6-5 6 5 6zM15 6l5 6-5 6z"/></>,
  flipV: <><path d="M3 12h18" strokeDasharray="2.5 2.5"/><path d="m6 9 6-5 6 5zM6 15l6 5 6-5z"/></>,
  save: <><path d="M4 3.5h13l3 3v14H4z"/><path d="M8 3.5v6h8v-6M8 20.5v-7h8v7"/></>,
  panel: <><rect x="3" y="3.5" width="18" height="17" rx="3"/><path d="M15.5 3.5v17M18.25 8v8"/></>,
  crop: <path d="M7 3.5v11A2.5 2.5 0 0 0 9.5 17H21M3 7h11a2.5 2.5 0 0 1 2.5 2.5V21"/>,
  lock: <><rect x="4.5" y="10" width="15" height="11" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10M12 14.5v2"/></>,
  unlock: <><rect x="4.5" y="10" width="15" height="11" rx="2.5"/><path d="M16 10V7.5a4 4 0 0 0-7.5-2M12 14.5v2"/></>,
  library: <><rect x="3" y="3.5" width="18" height="17" rx="3"/><path d="M8.5 3.5v17M12 8h5M12 12h5M12 16h3"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></>,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.75"/></>,
  eyeOff: <><path d="m3 3 18 18M9.4 6.4A10.3 10.3 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-2.1 2.8M15.2 17.5A9.6 9.6 0 0 1 12 18c-6 0-9.5-6-9.5-6a15.2 15.2 0 0 1 2.4-3"/><path d="M10.2 10.2a2.75 2.75 0 0 0 3.6 3.6"/></>,
  zoomIn: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M10.5 7.5v6M7.5 10.5h6"/></>,
  zoomOut: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M7.5 10.5h6"/></>,
  fit: <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>,
  marker: <><path d="M6 21V4"/><path d="M7 5h11l-2.75 3L18 11H7z"/></>,
  grid: <><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.5"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.5"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.5"/><rect x="14" y="14" width="6.5" height="6.5" rx="1.5"/></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none"/></>,
  project: <><path d="M5 3.5h10l4 4v13H5z"/><path d="M15 3.5v4h4M8.5 12h7M8.5 16h5"/></>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9.3 9a2.8 2.8 0 0 1 5.4 1.1c0 2.1-2.7 2.4-2.7 4.6M12 18h.01"/></>,
  shape: <><rect x="3.5" y="8" width="9.5" height="9.5" rx="2"/><circle cx="16.5" cy="8" r="4"/></>,
  removeBackground: <><path d="m4 20 11.2-11.2 2 2L6 22H4z"/><path d="M16.5 2.5v4M14.5 4.5h4M7 3.5v3M5.5 5h3M19 15v4M17 17h4"/></>,
  heart: <path d="M20.8 8.8c0 5.2-8.8 10.1-8.8 10.1S3.2 14 3.2 8.8A4.7 4.7 0 0 1 12 6.5a4.7 4.7 0 0 1 8.8 2.3Z"/>,
  comment: <path d="M20 15.2a3 3 0 0 1-3 3H9l-5 3v-6a3 3 0 0 1-1-2.2V7a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3Z"/>,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></>,
  user: <><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.55v-.1A1.7 1.7 0 0 0 8.45 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.05 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.25V9.55h.1A1.7 1.7 0 0 0 4.05 8a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.51 3.2l.06.06A1.7 1.7 0 0 0 8.45 3.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V1.8h4.05v.1A1.7 1.7 0 0 0 15 3.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8c.38.55.98.9 1.65.95h.1V13h-.1a1.7 1.7 0 0 0-1.65 2Z"/></>,
}

export default function Icon({ name, className = '', ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={`ui-icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {paths[name]}
    </svg>
  )
}
