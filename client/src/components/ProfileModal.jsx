import { useEffect, useState } from 'react';
import { LogOut, Sun, Moon, Monitor, KeyRound } from 'lucide-react';
import { useStore } from '../store.js';
import { Avatar, Modal, Spinner } from './ui.jsx';

async function keyFingerprint(publicKey) {
  const bytes = Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('').match(/.{4}/g).join(' ').toUpperCase();
}

export default function ProfileModal({ onClose }) {
  const me = useStore((s) => s.me);
  const themePref = useStore((s) => s.themePref);
  const { setTheme, updateProfile, logout, toast } = useStore.getState();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [about, setAbout] = useState(me.about || '');
  const [busy, setBusy] = useState(false);
  const [fp, setFp] = useState('');

  useEffect(() => { keyFingerprint(me.publicKey).then(setFp); }, [me.publicKey]);

  const dirty = displayName.trim() !== me.displayName || about.trim() !== (me.about || '');

  async function save() {
    if (!displayName.trim()) return;
    setBusy(true);
    try {
      await updateProfile({ displayName: displayName.trim(), about: about.trim() });
      toast('Profile updated.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      footer={(
        <>
          <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={logout}><LogOut size={16} /> Sign out</button>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" disabled={!dirty || busy} onClick={save}>{busy && <Spinner />} Save</button>
        </>
      )}
    >
      <div className="profile-hero">
        <Avatar name={displayName || me.displayName} seed={me.id} size={60} />
        <div>
          <b>{me.displayName}</b>
          <span>@{me.username}</span>
        </div>
      </div>
      <div className="stack">
        <label className="field">
          <span>Display name</span>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={64} />
        </label>
        <label className="field">
          <span>About <span className="hint">· visible to people you chat with</span></span>
          <input className="input" value={about} onChange={(e) => setAbout(e.target.value)} maxLength={140} placeholder="Building things on the web" />
        </label>
        <div className="field">
          <span>Appearance</span>
          <div className="theme-switch">
            {[['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]].map(([k, label, Icon]) => (
              <button key={k} type="button" className={themePref === k ? 'on' : ''} onClick={() => setTheme(k)}>
                <Icon size={18} /> {label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span><KeyRound size={13} style={{ verticalAlign: '-2px' }} /> Your public key fingerprint</span>
          <div className="key-fp">{fp || '…'}</div>
          <span className="hint">Your private key is stored encrypted and only unlocked on your devices with your password.</span>
        </div>
      </div>
    </Modal>
  );
}
