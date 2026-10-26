import { useMemo, useState } from 'react';
import { X, ShieldCheck, UserPlus, LogOut, UserMinus, Pencil, Check, Phone, Video, BadgeCheck, MessageSquare } from 'lucide-react';
import { useStore } from '../store.js';
import { isVerified } from '../lib/keystore.js';
import { convTitle, formatLastSeen, otherMember, previewKind } from '../lib/format.js';
import { Avatar } from './ui.jsx';
import { MediaTile, FileCard } from './Attachments.jsx';
import { AddMembersModal } from './PeoplePicker.jsx';
import SafetyNumberModal from './SafetyNumberModal.jsx';
import Lightbox from './Lightbox.jsx';

export default function ConversationInfo({ id }) {
  const me = useStore((s) => s.me);
  const conv = useStore((s) => s.conversations[id]);
  const users = useStore((s) => s.users);
  const items = useStore((s) => s.messages[id]?.items);
  const { toggleInfo, removeMember, renameGroup, startDirect, toast } = useStore.getState();
  const [modal, setModal] = useState(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(conv?.name || '');
  const [lightbox, setLightbox] = useState(null);

  const shared = useMemo(() => {
    const files = (items || []).filter((m) => !m.pending).flatMap((m) => m.payload?.files || []).reverse();
    return {
      media: files.filter((f) => ['image', 'video'].includes(previewKind(f.type))),
      docs: files.filter((f) => !['image', 'video'].includes(previewKind(f.type))),
    };
  }, [items]);

  if (!conv) return null;
  const isGroup = conv.type === 'group';
  const isAdmin = conv.role === 'admin';
  const other = !isGroup ? users[otherMember(conv, me.id)?.id] : null;
  const title = convTitle(conv, users, me.id);

  async function act(fn, ok) {
    try {
      await fn();
      if (ok) toast(ok, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function saveName() {
    if (!name.trim() || name.trim() === conv.name) return setEditing(false);
    await act(() => renameGroup(id, name.trim()));
    setEditing(false);
  }

  return (
    <aside className="info" aria-label="Conversation details">
      <div className="info-head">
        <h3>{isGroup ? 'Group info' : 'Contact info'}</h3>
        <button className="icon-btn" onClick={() => toggleInfo(false)} aria-label="Close details"><X size={20} /></button>
      </div>
      <div className="info-body">
        <div className="info-hero">
          <Avatar name={title} seed={isGroup ? conv.id : other?.id} size={88} group={isGroup} online={!!other?.online} />
          {editing ? (
            <form className="rename" onSubmit={(e) => { e.preventDefault(); saveName(); }}>
              <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              <button className="icon-btn" aria-label="Save name"><Check size={18} /></button>
            </form>
          ) : (
            <h4>
              {title}{' '}
              {other && isVerified(me.id, other) && <BadgeCheck size={16} color="var(--brand)" style={{ verticalAlign: '-2px' }} />}
              {isGroup && isAdmin && (
                <button className="icon-btn sm" onClick={() => { setName(conv.name); setEditing(true); }} aria-label="Rename group" style={{ verticalAlign: 'middle' }}>
                  <Pencil size={14} />
                </button>
              )}
            </h4>
          )}
          <p>{isGroup ? `Group · ${conv.members.length} members` : `@${other?.username}`}</p>
          {!isGroup && <p>{other?.online ? 'Online' : formatLastSeen(other?.lastSeenAt)}</p>}
          {!isGroup && other?.about && <div className="about">{other.about}</div>}
        </div>

        <div className="info-section">
          <h5>Security</h5>
          <div className="sec-card">
            <span className="ico"><ShieldCheck size={18} /></span>
            <div>
              <b>End-to-end encrypted</b>
              <p>
                {isGroup
                  ? 'Every message is sealed separately for each member. New members can’t read earlier history.'
                  : 'Messages and files are locked with keys only you two hold.'}
              </p>
              {!isGroup && other && (
                <button className="btn btn-sm btn-outline" onClick={() => setModal({ type: 'safety', user: other })}>Verify safety number</button>
              )}
            </div>
          </div>
        </div>

        {isGroup && (
          <div className="info-section">
            <h5>
              {conv.members.length} members
              {isAdmin && <button className="btn btn-sm btn-ghost" style={{ marginRight: -8 }} onClick={() => setModal({ type: 'add' })}><UserPlus size={15} /> Add</button>}
            </h5>
            {conv.members.map((m) => {
              const u = users[m.id];
              if (!u) return null;
              const isMe = m.id === me.id;
              return (
                <div className="member" key={m.id}>
                  <Avatar name={u.displayName} seed={u.id} size={38} online={!isMe && u.online} />
                  <div className="member-text">
                    <b>{isMe ? 'You' : u.displayName}</b>
                    <span>@{u.username}</span>
                  </div>
                  {m.role === 'admin' && <span className="tag">Admin</span>}
                  {!isMe && (
                    <button className="icon-btn sm tooltip" data-tip="Message" aria-label={`Message ${u.displayName}`} onClick={() => act(() => startDirect(u.id))}>
                      <MessageSquare size={15} />
                    </button>
                  )}
                  {!isMe && isAdmin && (
                    <button className="icon-btn sm tooltip" data-tip="Remove" aria-label={`Remove ${u.displayName}`}
                      onClick={() => window.confirm(`Remove ${u.displayName} from the group?`) && act(() => removeMember(id, u.id))}>
                      <UserMinus size={15} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="info-section">
          <h5>Media &amp; files</h5>
          {!shared.media.length && !shared.docs.length && <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>Shared photos and files from loaded messages appear here.</p>}
          {shared.media.length > 0 && (
            <div className="shared-grid">
              {shared.media.slice(0, 9).map((f, i) => (
                <MediaTile key={f.id} file={f} onOpen={() => setLightbox({ files: shared.media, index: i })} />
              ))}
            </div>
          )}
          {shared.docs.length > 0 && (
            <div className="shared-files">
              {shared.docs.slice(0, 6).map((f) => <FileCard key={f.id} file={f} />)}
            </div>
          )}
        </div>

        <div className="info-section">
          <h5>Calls</h5>
          <div className="coming-soon">
            <div><Phone size={16} /> Voice: soon</div>
            <div><Video size={16} /> Video: soon</div>
          </div>
        </div>

        {isGroup && (
          <div className="info-section" style={{ borderBottom: 0 }}>
            <button className="btn btn-danger btn-block"
              onClick={() => window.confirm('Leave this group? You will stop receiving its messages.') && act(() => removeMember(id, me.id), 'You left the group.')}>
              <LogOut size={16} /> Leave group
            </button>
          </div>
        )}
      </div>

      {modal?.type === 'add' && <AddMembersModal conversation={conv} onClose={() => setModal(null)} />}
      {modal?.type === 'safety' && <SafetyNumberModal user={modal.user} onClose={() => setModal(null)} />}
      {lightbox && <Lightbox files={lightbox.files} index={lightbox.index} onClose={() => setLightbox(null)} />}
    </aside>
  );
}
