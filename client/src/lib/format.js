const AVATAR_COLORS = [
  ['#FFE7D3', '#B4520A'], // brand orange
  ['#E3E7EE', '#2A2F37'], // charcoal
  ['#DDEBFF', '#1F4E96'],
  ['#DDF4E7', '#1C6B43'],
  ['#F1E3FF', '#5E2C99'],
  ['#FFE0E6', '#9B2341'],
  ['#E0F5F7', '#155E68'],
  ['#FFF4CC', '#7A5A00'],
];

export function avatarColors(seed = '') {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatListTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return formatTime(iso);
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'Yesterday';
  if (now - d < 6 * 86400e3) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : '2-digit' });
}

export function formatDay(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export const isSameDay = (a, b) => sameDay(new Date(a), new Date(b));

export function formatLastSeen(iso) {
  if (!iso) return 'Offline';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return 'Last seen just now';
  if (mins < 60) return `Last seen ${mins} min ago`;
  if (sameDay(d, new Date())) return `Last seen today at ${formatTime(iso)}`;
  return `Last seen ${formatListTime(iso)}`;
}

export function formatBytes(n = 0) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function otherMember(conv, meId) {
  return conv.members.find((m) => m.id !== meId) || conv.members[0];
}

export function convTitle(conv, users, meId) {
  if (!conv) return '';
  if (conv.type === 'group') return conv.name || 'Group';
  const other = users[otherMember(conv, meId)?.id];
  return other?.displayName || 'Unknown';
}

/** Only these types are ever rendered inline; everything else is download-only. */
const PREVIEWABLE = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|video\/(mp4|webm|ogg)|audio\/(mpeg|mp3|ogg|wav|webm|mp4|aac|x-m4a))$/;
export const previewKind = (type = '') => (PREVIEWABLE.test(type) ? type.split('/')[0] : null);

export function fileKind(name = '', type = '') {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'sheet';
  if (['doc', 'docx', 'txt', 'rtf', 'odt', 'md'].includes(ext)) return 'doc';
  if (['js', 'ts', 'jsx', 'tsx', 'php', 'py', 'html', 'css', 'json', 'java', 'go', 'rs', 'c', 'cpp', 'sql'].includes(ext)) return 'code';
  return 'file';
}
