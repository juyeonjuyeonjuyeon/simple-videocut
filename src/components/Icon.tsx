import type { ReactNode, SVGProps } from 'react'

export type IconName = 'brand' | 'plus' | 'folder' | 'play' | 'pause' | 'repeat' | 'split' | 'layers' |
  'music' | 'palette' | 'text' | 'undo' | 'redo' | 'copy' | 'trash' | 'download' | 'upload' | 'share' | 'close' |
  'warning' | 'screen' | 'video' | 'image' | 'mute' | 'rotate' | 'flipH' | 'flipV' | 'save' | 'panel' | 'crop' | 'lock' | 'unlock' | 'library' | 'search' |
  'eye' | 'eyeOff' | 'zoomIn' | 'zoomOut' | 'fit' | 'marker' | 'grid' | 'list' | 'project'

const paths: Record<IconName, ReactNode> = {
  brand: <><path d="M7 9.5 5 7 3.5 9.5V15a4.5 4.5 0 0 0 9 0V9.5L11 7 9 9"/><circle cx="7" cy="13" r=".7"/><circle cx="11" cy="13" r=".7"/><path d="M8 16h2"/></>,
  plus: <path d="M10 4v12M4 10h12"/>, folder: <path d="M3 6h5l2 2h7v8H3z"/>,
  play: <path d="m7 5 8 5-8 5z"/>, pause: <path d="M7 5v10M13 5v10"/>,
  repeat: <><path d="M5 6h9l-2-2M15 14H6l2 2"/><path d="M16 7v3M4 13v-3"/></>,
  split: <><circle cx="6" cy="6" r="2"/><circle cx="6" cy="14" r="2"/><path d="m8 7 8 7M8 13l8-7"/></>,
  layers: <><rect x="4" y="4" width="9" height="9" rx="1"/><path d="M7 13v3h9V7h-3"/></>,
  music: <><path d="M8 15V6l7-2v9"/><circle cx="6" cy="15" r="2"/><circle cx="13" cy="13" r="2"/></>,
  palette: <><path d="M10 3a7 7 0 1 0 0 14h1.5a1.5 1.5 0 0 0 0-3H10a2 2 0 0 1 0-4h7A7 7 0 0 0 10 3Z"/><circle cx="6" cy="8" r=".7"/><circle cx="9" cy="6" r=".7"/><circle cx="13" cy="7" r=".7"/></>,
  text: <path d="M4 5h12M10 5v11M7 16h6"/>, undo: <path d="m7 6-3 3 3 3M5 9h6a4 4 0 0 1 4 4"/>,
  redo: <path d="m13 6 3 3-3 3M15 9H9a4 4 0 0 0-4 4"/>, copy: <><rect x="7" y="7" width="9" height="9" rx="1"/><path d="M13 7V4H4v9h3"/></>,
  trash: <><path d="M4 6h12M8 3h4l1 3M6 6l1 11h6l1-11M9 9v5M12 9v5"/></>,
  download: <path d="M10 3v10m-4-4 4 4 4-4M4 16h12"/>, upload: <path d="M10 15V5m-4 4 4-4 4 4M4 17h12"/>,
  share: <><circle cx="5" cy="10" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="15" cy="15" r="2"/><path d="m7 9 6-3M7 11l6 3"/></>, close: <path d="m5 5 10 10M15 5 5 15"/>,
  warning: <><path d="m10 3 8 14H2z"/><path d="M10 8v4M10 15h.01"/></>, screen: <><rect x="3" y="4" width="14" height="10" rx="1"/><path d="M7 17h6M10 14v3"/></>,
  video: <><rect x="3" y="5" width="10" height="10" rx="2"/><path d="m13 8 4-2v8l-4-2"/></>, image: <><rect x="3" y="4" width="14" height="12" rx="2"/><circle cx="7" cy="8" r="1"/><path d="m4 14 4-4 3 3 2-2 3 3"/></>,
  mute: <><path d="M4 8h3l4-3v10l-4-3H4zM14 8l3 4M17 8l-3 4"/></>, rotate: <path d="M15 7V3l-2 2a6 6 0 1 0 2 9"/>,
  flipH: <><path d="M10 3v14M7 6 3 10l4 4M13 6l4 4-4 4"/></>, flipV: <><path d="M3 10h14M6 7l4-4 4 4M6 13l4 4 4-4"/></>,
  save: <><path d="M4 3h10l3 3v11H4z"/><path d="M7 3v5h7V3M7 17v-6h7v6"/></>,
  panel: <><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M12 3v14M6 7h3M6 10h3"/></>,
  crop: <><path d="M6 3v11a2 2 0 0 0 2 2h9M3 6h11a2 2 0 0 1 2 2v9"/><path d="M3 3l14 14" opacity=".35"/></>,
  lock: <><rect x="4" y="9" width="12" height="8" rx="2"/><path d="M7 9V7a3 3 0 0 1 6 0v2"/></>,
  unlock: <><rect x="4" y="9" width="12" height="8" rx="2"/><path d="M13 9V7a3 3 0 0 0-5.7-1.3"/></>,
  library: <><path d="M3 4h5l2 2h7v10H3z"/><path d="M6 10h8M10 7v6"/></>,
  search: <><circle cx="9" cy="9" r="5"/><path d="m13 13 4 4"/></>,
  eye: <><path d="M2.5 10s2.7-5 7.5-5 7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5Z"/><circle cx="10" cy="10" r="2.2"/></>,
  eyeOff: <><path d="M3 3l14 14M7.1 5.7A8.8 8.8 0 0 1 10 5c4.8 0 7.5 5 7.5 5a12 12 0 0 1-2 2.7M12.2 14.6A8 8 0 0 1 10 15c-4.8 0-7.5-5-7.5-5a12 12 0 0 1 2-2.7"/></>,
  zoomIn: <><circle cx="8.5" cy="8.5" r="5"/><path d="m12.5 12.5 4 4M8.5 6v5M6 8.5h5"/></>,
  zoomOut: <><circle cx="8.5" cy="8.5" r="5"/><path d="m12.5 12.5 4 4M6 8.5h5"/></>,
  fit: <><path d="M7 4H4v3M13 4h3v3M7 16H4v-3M13 16h3v-3"/><rect x="7" y="7" width="6" height="6" rx="1"/></>,
  marker: <path d="M6 3h8v10l-4 4-4-4z"/>,
  grid: <><rect x="3" y="3" width="5" height="5" rx="1"/><rect x="12" y="3" width="5" height="5" rx="1"/><rect x="3" y="12" width="5" height="5" rx="1"/><rect x="12" y="12" width="5" height="5" rx="1"/></>,
  list: <><path d="M7 5h10M7 10h10M7 15h10"/><circle cx="3.5" cy="5" r=".5"/><circle cx="3.5" cy="10" r=".5"/><circle cx="3.5" cy="15" r=".5"/></>,
  project: <><rect x="3" y="4" width="14" height="12" rx="2"/><path d="M7 4v3h6V4M6 12h8"/></>,
}

export default function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return <svg className={`ui-icon ${props.className ?? ''}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>
}
