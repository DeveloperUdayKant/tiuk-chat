import { useEffect, useMemo, useState } from 'react';
import { Search, Check, X, ArrowRight, ArrowLeft, Users } from 'lucide-react';
import { useStore } from '../store.js';
import { api } from '../lib/api.js';
import { Avatar, Modal, Spinner } from './ui.jsx';

function useUserSearch(q) {
  const [state, setState] = useState({ users: [], loading: false });
  useEffect(() => {
    const term = q.trim();
    if (term.replace(/^@/, '').length < 2) return setState({ users: [], loading: false });
    setState((s) => ({ ...s, loading: true }));
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api.get(`/users/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then(({ users }) => setState({ users, loading: false }))
        .catch((err) => err.name !== 'AbortError' && setState({ users: [], loading: false }));
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);
  return state;
}

/** People you already share a conversation with: shown before you type. */
function useContacts(excludeIds = []) {
  const me = useStore((s) => s.me);
  const users = useStore((s) => s.users);
  const conversations = useStore((s) => s.conversations);
  return useMemo(() => {
    const ids = new Set();
    Object.values(conversations).forEach((c) => c.members.forEach((m) => ids.add(m.id)));
    ids.delete(me.id);
    excludeIds.forEach((id) => ids.delete(id));
    return [...ids].map((id) => users[id]).filter(Boolean).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [conversations, users, me.id, excludeIds]);
}

function PersonRow({ user, selected, multi, onClick }) {
  return (
    <button type="button" className={`picker-item${selected ? ' on' : ''}`} onClick={onClick}>
      <Avatar name={user.displayName} seed={user.id} size={40} online={user.online} />
      <div className="member-text">
        <b>{user.displayName}</b>
        <span>@{user.username}{user.about ? ` · ${user.about}` : ''}</span>
      </div>
      {multi && <span className="check">{selected && <Check size={14} strokeWidth={3} />}</span>}
    </button>
  );
}

function PeopleList({ q, setQ, selected = [], onPick, multi, exclude = [] }) {
  const { users: results, loading } = useUserSearch(q);
  const contacts = useContacts(exclude);
  const searching = q.trim().replace(/^@/, '').length >= 2;
  const list = (searching ? results : contacts).filter((u) => !exclude.includes(u.id));
  const selectedIds = selected.map((u) => u.id);

  return (
    <>
      <label className="search">
        <Search size={17} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or @username" aria-label="Search people" />
        {loading && <Spinner size={15} />}
      </label>

      {multi && selected.length > 0 && (
        <div className="picked">
          {selected.map((u) => (
            <span key={u.id} className="chip">
              <Avatar name={u.displayName} seed={u.id} size={20} />
              {u.displayName.split(' ')[0]}
              <button type="button" onClick={() => onPick(u)} aria-label={`Remove ${u.displayName}`}><X size={12} /></button>
            </span>
          ))}
        </div>
      )}

      <div className="picker-list">
        {!searching && list.length > 0 && <h5 style={{ margin: '4px 10px 6px', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>Your contacts</h5>}
        {list.map((u) => (
          <PersonRow key={u.id} user={u} multi={multi} selected={selectedIds.includes(u.id)} onClick={() => onPick(u)} />
        ))}
        {!list.length && !loading && (
          <div className="picker-empty">
            {searching ? `No one found for “${q.trim()}”.` : 'Type at least 2 characters to find people on TIUK Chat.'}
          </div>
        )}
      </div>
    </>
  );
}

export function NewChatModal({ onClose }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const startDirect = useStore((s) => s.startDirect);
  const toast = useStore((s) => s.toast);

  async function pick(u) {
    if (busy) return;
    setBusy(true);
    try {
      await startDirect(u.id);
      onClose();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  return (
    <Modal title="New chat" subtitle="Start an end-to-end encrypted conversation" onClose={onClose}>
      <PeopleList q={q} setQ={setQ} onPick={pick} />
    </Modal>
  );
}

export function NewGroupModal({ onClose }) {
  const [q, setQ] = useState('');
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const createGroup = useStore((s) => s.createGroup);
  const toast = useStore((s) => s.toast);

  const toggle = (u) => setSelected((cur) => (cur.some((x) => x.id === u.id) ? cur.filter((x) => x.id !== u.id) : [...cur, u]));

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await createGroup(name.trim(), selected.map((u) => u.id));
      onClose();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  return (
    <Modal
      title={step === 1 ? 'New group' : 'Name your group'}
      subtitle={step === 1 ? 'Add people to your group' : `${selected.length + 1} members, including you`}
      onClose={onClose}
      footer={step === 1 ? (
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!selected.length} onClick={() => setStep(2)}>Next <ArrowRight size={16} /></button>
        </>
      ) : (
        <>
          <button className="btn btn-ghost" onClick={() => setStep(1)}><ArrowLeft size={16} /> Back</button>
          <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={create}>
            {busy ? <Spinner /> : <Users size={16} />} Create group
          </button>
        </>
      )}
    >
      {step === 1 ? (
        <PeopleList q={q} setQ={setQ} selected={selected} onPick={toggle} multi />
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); create(); }} className="stack">
          <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
            <Avatar name={name || 'G'} seed={name} size={72} group />
          </div>
          <label className="field">
            <span>Group name</span>
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Product team" />
          </label>
          <div className="picked" style={{ marginTop: 0 }}>
            {selected.map((u) => (
              <span key={u.id} className="chip"><Avatar name={u.displayName} seed={u.id} size={20} />{u.displayName}</span>
            ))}
          </div>
        </form>
      )}
    </Modal>
  );
}

export function AddMembersModal({ conversation, onClose }) {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const addMembers = useStore((s) => s.addMembers);
  const toast = useStore((s) => s.toast);
  const exclude = useMemo(() => conversation.members.map((m) => m.id), [conversation.members]);

  const toggle = (u) => setSelected((cur) => (cur.some((x) => x.id === u.id) ? cur.filter((x) => x.id !== u.id) : [...cur, u]));

  async function add() {
    setBusy(true);
    try {
      await addMembers(conversation.id, selected.map((u) => u.id));
      toast(`Added ${selected.length} ${selected.length === 1 ? 'person' : 'people'}.`, 'success');
      onClose();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add members"
      subtitle="New members can read messages sent after they join"
      onClose={onClose}
      footer={(
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!selected.length || busy} onClick={add}>
            {busy && <Spinner />} Add {selected.length || ''}
          </button>
        </>
      )}
    >
      <PeopleList q={q} setQ={setQ} selected={selected} onPick={toggle} multi exclude={exclude} />
    </Modal>
  );
}
