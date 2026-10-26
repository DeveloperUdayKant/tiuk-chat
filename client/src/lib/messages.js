const nameOf = (id, users, meId, capital = true) =>
  id === meId ? (capital ? 'You' : 'you') : users[id]?.displayName || 'Someone';

const list = (ids = [], users, meId) => {
  const names = ids.map((id) => nameOf(id, users, meId, false));
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

/** Returns [actor, rest] so the actor can be rendered bold. */
export function systemParts(msg, users, meId) {
  const m = msg.meta || {};
  const actor = nameOf(msg.senderId, users, meId);
  switch (m.event) {
    case 'group_created': return [actor, ` created the group “${m.name}”`];
    case 'members_added': return [actor, ` added ${list(m.userIds, users, meId)}`];
    case 'member_removed': return [actor, ` removed ${list(m.userIds, users, meId)}`];
    case 'member_left': return [actor, ' left the group'];
    case 'renamed': return [actor, ` renamed the group to “${m.name}”`];
    default: return ['', 'Conversation updated'];
  }
}

export function previewText(msg, users, meId) {
  if (!msg) return '';
  if (msg.kind === 'system') return systemParts(msg, users, meId).join('');
  if (!msg.payload) return 'Encrypted message';
  const { text, files = [] } = msg.payload;
  if (text) return text.replace(/\s+/g, ' ');
  if (files.length === 1) return files[0].name;
  if (files.length > 1) return `${files.length} files`;
  return '';
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s){1,12}$/u;
export const isEmojiOnly = (text) => !!text && text.length <= 24 && EMOJI_ONLY.test(text) && !/^[\d#*\s]+$/.test(text);

const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;

/** Splits text into plain strings and safe http(s) links. */
export function linkify(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ href: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
