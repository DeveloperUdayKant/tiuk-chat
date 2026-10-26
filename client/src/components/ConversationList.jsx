import { useMemo, useState } from 'react';
import { Search, SquarePen, Users, Lock, Paperclip, Check, CheckCheck, MessageSquarePlus, WifiOff, Settings, X } from 'lucide-react';
import { useStore } from '../store.js';
import { Avatar } from './ui.jsx';
import { convTitle, formatListTime, otherMember } from '../lib/format.js';
import { previewText } from '../lib/messages.js';

const FILTERS = [
  ['all', 'All'],
  ['unread', 'Unread'],
  ['direct', 'Direct'],
  ['group', 'Groups'],
];

export default function ConversationList({ onNewChat, onNewGroup, onProfile }) {
  const me = useStore((s) => s.me);
  const users = useStore((s) => s.users);
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeId);
  const typing = useStore((s) => s.typing);
  const online = useStore((s) => s.online);
  const openConversation = useStore((s) => s.openConversation);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return Object.values(conversations)
      .filter((c) => filter === 'all' || (filter === 'unread' ? c.unread > 0 : c.type === filter))
      .filter((c) => !needle || convTitle(c, users, me.id).toLowerCase().includes(needle))
      .sort((a, b) => new Date(b.lastMessageAt || b.createdAt) - new Date(a.lastMessageAt || a.createdAt));
  }, [conversations, users, q, filter, me.id]);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="sidebar-title">
          <h1>Chats</h1>
          <button className="icon-btn tooltip" data-tip="New group" aria-label="New group" onClick={onNewGroup}><Users size={20} /></button>
          <button className="icon-btn tooltip" data-tip="New chat" aria-label="New chat" onClick={onNewChat}><SquarePen size={20} /></button>
          <button className="icon-btn mobile-only" aria-label="Settings" onClick={onProfile}><Settings size={20} /></button>
        </div>
        <label className="search">
          <Search size={17} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search conversations" aria-label="Search conversations" />
          {q && <button className="icon-btn sm" style={{ width: 24, height: 24 }} onClick={() => setQ('')} aria-label="Clear search"><X size={15} /></button>}
        </label>
      </div>

      <div className="filters" role="tablist">
        {FILTERS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>

      <div className="conv-list">
        {list.length === 0 && (
          <div className="list-empty">
            <div className="art"><MessageSquarePlus size={28} /></div>
            {Object.keys(conversations).length === 0 ? (
              <>
                <h3>No conversations yet</h3>
                <p>Find someone by their username and say hello. It’s encrypted from the first message.</p>
                <button className="btn btn-primary" onClick={onNewChat}><SquarePen size={16} /> Start a chat</button>
              </>
            ) : (
              <><h3>Nothing here</h3><p>No conversations match this view.</p></>
            )}
          </div>
        )}
        {list.map((c) => (
          <ConversationRow
            key={c.id}
            conv={c}
            me={me}
            users={users}
            active={c.id === activeId}
            typingIds={Object.keys(typing[c.id] || {})}
            onClick={() => openConversation(c.id)}
          />
        ))}
      </div>

      <div className="sidebar-foot">
        {online ? <><Lock size={12} /> End-to-end encrypted</> : <span className="offline"><WifiOff size={12} style={{ verticalAlign: '-2px' }} /> Reconnecting…</span>}
      </div>
    </aside>
  );
}

function ConversationRow({ conv, me, users, active, typingIds, onClick }) {
  const isGroup = conv.type === 'group';
  const other = !isGroup ? users[otherMember(conv, me.id)?.id] : null;
  const title = convTitle(conv, users, me.id);
  const last = conv.lastMessage;
  const mine = last && last.kind !== 'system' && last.senderId === me.id;
  const others = conv.members.filter((m) => m.id !== me.id);
  const seen = mine && last.seq && others.length && others.every((m) => m.lastReadSeq >= last.seq);

  let preview;
  if (typingIds.length) {
    const who = isGroup ? `${users[typingIds[0]]?.displayName?.split(' ')[0] || 'Someone'} is typing…` : 'typing…';
    preview = <span className="typing">{who}</span>;
  } else if (last) {
    const sender = isGroup && last.kind !== 'system' && !mine ? `${users[last.senderId]?.displayName?.split(' ')[0] || 'Someone'}: ` : '';
    preview = (
      <>
        {mine && (last.pending ? null : seen ? <CheckCheck size={15} color="var(--brand)" /> : <Check size={15} />)}
        {last.payload?.files?.length > 0 && <Paperclip size={13} />}
        <span>{sender}{previewText(last, users, me.id)}</span>
      </>
    );
  } else {
    preview = <span>{isGroup ? 'Group created' : 'Say hello 👋'}</span>;
  }

  return (
    <button className={`conv${active ? ' on' : ''}${conv.unread ? ' unread' : ''}`} onClick={onClick}>
      <Avatar name={title} seed={isGroup ? conv.id : other?.id} size={48} group={isGroup} online={!!other?.online} />
      <div className="conv-main">
        <div className="conv-row">
          <span className="conv-name">{title}</span>
          <span className="conv-time">{formatListTime(last?.createdAt || conv.lastMessageAt || conv.createdAt)}</span>
        </div>
        <div className="conv-row">
          <div className="conv-preview">{preview}</div>
          {conv.unread > 0 && <span className="badge">{conv.unread > 99 ? '99+' : conv.unread}</span>}
        </div>
      </div>
    </button>
  );
}
