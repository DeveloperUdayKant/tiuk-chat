import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Phone, Video, PanelRight, ShieldAlert, Lock, UploadCloud, BadgeCheck } from 'lucide-react';
import { useStore } from '../store.js';
import { isVerified } from '../lib/keystore.js';
import { convTitle, formatDay, formatLastSeen, isSameDay, otherMember } from '../lib/format.js';
import { Avatar, Spinner } from './ui.jsx';
import MessageItem, { SystemMessage } from './MessageItem.jsx';
import Composer from './Composer.jsx';
import Lightbox from './Lightbox.jsx';
import SafetyNumberModal from './SafetyNumberModal.jsx';

const GROUP_GAP_MS = 5 * 60 * 1000;
const EMPTY = { items: [], hasMore: true, loading: true, loaded: false };

function sameRun(a, b) {
  return a && b && a.kind !== 'system' && b.kind !== 'system' && a.senderId === b.senderId
    && Math.abs(new Date(b.createdAt) - new Date(a.createdAt)) < GROUP_GAP_MS
    && isSameDay(a.createdAt, b.createdAt);
}

export default function ChatView({ id }) {
  const me = useStore((s) => s.me);
  const conv = useStore((s) => s.conversations[id]);
  const users = useStore((s) => s.users);
  const thread = useStore((s) => s.messages[id]) || EMPTY;
  const typing = useStore((s) => s.typing[id]);
  const keyAlerts = useStore((s) => s.keyAlerts);
  const infoOpen = useStore((s) => s.infoOpen);
  const { openConversation, toggleInfo, loadMessages, retryMessage, discardMessage } = useStore.getState();

  const [lightbox, setLightbox] = useState(null);
  const [safetyFor, setSafetyFor] = useState(null);
  const [dragging, setDragging] = useState(false);
  const scroller = useRef(null);
  const inner = useRef(null);
  const stick = useRef(true);
  const prevFirst = useRef(null);
  const prevHeight = useRef(0);
  const composer = useRef(null);
  const dragDepth = useRef(0);

  const isGroup = conv?.type === 'group';
  const other = conv && !isGroup ? users[otherMember(conv, me.id)?.id] : null;
  const title = convTitle(conv, users, me.id);
  const alerted = conv ? conv.members.filter((m) => keyAlerts[m.id]).map((m) => users[m.id]).filter(Boolean) : [];
  const verified = other && isVerified(me.id, other);

  // Keep the view pinned to the bottom unless the reader scrolled up; preserve position when older pages load.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const first = thread.items[0]?.id;
    if (prevFirst.current && first !== prevFirst.current && prevHeight.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevFirst.current = first;
    prevHeight.current = el.scrollHeight;
  }, [thread.items]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !inner.current) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
      prevHeight.current = el.scrollHeight;
    });
    ro.observe(inner.current);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    const t = useStore.getState().messages[id];
    if (el.scrollTop < 80 && t?.hasMore && !t.loading && t.loaded) loadMessages(id, { older: true });
  }, [id, loadMessages]);

  const typingNames = Object.keys(typing || {}).map((uid) => users[uid]?.displayName?.split(' ')[0]).filter(Boolean);

  let subtitle;
  let subClass = 'sub';
  if (typingNames.length) {
    subtitle = isGroup ? `${typingNames.join(', ')} ${typingNames.length > 1 ? 'are' : 'is'} typing…` : 'typing…';
    subClass += ' typing';
  } else if (isGroup) {
    const onlineCount = conv.members.filter((m) => m.id !== me.id && users[m.id]?.online).length;
    subtitle = `${conv.members.length} members${onlineCount ? ` · ${onlineCount} online` : ''}`;
  } else if (other?.online) {
    subtitle = 'Online';
    subClass += ' online';
  } else {
    subtitle = formatLastSeen(other?.lastSeenAt);
  }

  const rendered = useMemo(() => {
    const out = [];
    const items = thread.items;
    for (let i = 0; i < items.length; i++) {
      const m = items[i];
      const prev = items[i - 1];
      const next = items[i + 1];
      if (!prev || !isSameDay(prev.createdAt, m.createdAt)) {
        out.push(<div key={`d-${m.id}`} className="day-sep">{formatDay(m.createdAt)}</div>);
      }
      if (m.kind === 'system') {
        out.push(<SystemMessage key={m.id} m={m} users={users} meId={me.id} />);
        continue;
      }
      const mine = m.senderId === me.id;
      const others = conv?.members.filter((x) => x.id !== me.id) || [];
      const seen = mine && m.seq && others.length > 0 && others.every((x) => x.lastReadSeq >= m.seq);
      out.push(
        <MessageItem
          key={m.id}
          m={m}
          mine={mine}
          sender={users[m.senderId]}
          first={!sameRun(prev, m)}
          last={!sameRun(m, next)}
          isGroup={isGroup}
          seen={seen}
          onRetry={() => retryMessage(id, m.id)}
          onDiscard={() => discardMessage(id, m.id)}
          onOpenMedia={(files, index) => setLightbox({ files, index })}
        />
      );
    }
    return out;
  }, [thread.items, users, me.id, conv?.members, isGroup, id, retryMessage, discardMessage]);

  if (!conv) return null;

  // Drag & drop files anywhere on the conversation
  const dnd = {
    onDragEnter: (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    },
    onDragOver: (e) => e.dataTransfer?.types?.includes('Files') && e.preventDefault(),
    onDrop: (e) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (!alerted.length) composer.current?.addFiles(e.dataTransfer.files);
    },
  };

  return (
    <div style={{ display: 'contents' }} {...dnd}>
      <header className="chat-head">
        <button className="icon-btn back" onClick={() => openConversation(null)} aria-label="Back to chats"><ArrowLeft size={20} /></button>
        <button className="chat-head-info" onClick={() => toggleInfo(true)}>
          <Avatar name={title} seed={isGroup ? conv.id : other?.id} size={42} group={isGroup} online={!!other?.online} />
          <div className="chat-head-text">
            <h2>{title}{verified && <BadgeCheck size={16} className="verified" aria-label="Verified" />}</h2>
            <div className={subClass}>{subtitle}</div>
          </div>
        </button>
        <div className="chat-actions">
          <button className="icon-btn tooltip" data-tip="Voice call (coming soon)" aria-label="Voice call, coming soon" disabled><Phone size={19} /></button>
          <button className="icon-btn tooltip" data-tip="Video call (coming soon)" aria-label="Video call, coming soon" disabled><Video size={20} /></button>
          <span className="divider" />
          <button className={`icon-btn tooltip${infoOpen ? ' on' : ''}`} data-tip="Details" aria-label="Conversation details" aria-pressed={infoOpen} onClick={() => toggleInfo()}>
            <PanelRight size={20} />
          </button>
        </div>
      </header>

      {alerted.length > 0 && (
        <div className="banner" role="alert">
          <ShieldAlert size={18} />
          <p><b>{alerted[0].displayName}</b>’s security key changed. This can happen if they reinstalled, or if someone is intercepting. Verify before sending.</p>
          <button className="btn btn-sm btn-outline" onClick={() => setSafetyFor(alerted[0])}>Review</button>
        </div>
      )}

      <div className="messages" ref={scroller} onScroll={onScroll}>
        <div className="messages-inner" ref={inner}>
          {thread.loaded && !thread.hasMore && (
            <div className="e2e-note">
              <Lock size={14} />
              <span>
                Messages and files in this {isGroup ? 'group' : 'chat'} are end-to-end encrypted.
                No one outside of it, not even TIUK, can read them.{' '}
                {!isGroup && other && <a href="#verify" onClick={(e) => { e.preventDefault(); setSafetyFor(other); }}>Verify safety number</a>}
              </span>
            </div>
          )}
          {(thread.loading || !thread.loaded) && <div className="load-older"><Spinner /></div>}
          {rendered}
        </div>
      </div>

      <div className="typing-row" aria-live="polite">
        {typingNames.length > 0 && (
          <><span className="typing-dots"><i /><i /><i /></span>{isGroup ? `${typingNames.join(', ')} typing…` : `${typingNames[0]} is typing…`}</>
        )}
      </div>

      <Composer
        ref={composer}
        conversationId={id}
        disabled={alerted.length > 0}
        onSent={() => { stick.current = true; }}
      />

      {dragging && (
        <div className="drop-overlay">
          <div><UploadCloud size={40} /><b>Drop files to share</b>They’re encrypted before upload</div>
        </div>
      )}

      {lightbox && <Lightbox files={lightbox.files} index={lightbox.index} onClose={() => setLightbox(null)} />}
      {safetyFor && <SafetyNumberModal user={safetyFor} onClose={() => setSafetyFor(null)} />}
    </div>
  );
}
