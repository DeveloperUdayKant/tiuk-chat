import { useState } from 'react';
import { AlertCircle, KeyRound, Lock } from 'lucide-react';
import { useStore } from '../store.js';
import { Avatar, Spinner } from './ui.jsx';

/** Shown when the session cookie is valid but this device no longer holds the decrypted key. */
export default function UnlockScreen() {
  const me = useStore((s) => s.me);
  const unlock = useStore((s) => s.unlock);
  const logout = useStore((s) => s.logout);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError('');
    try {
      await unlock(password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="unlock">
      <div className="unlock-card">
        <Avatar name={me.displayName} seed={me.id} size={64} />
        <h2>Welcome back, {me.displayName.split(' ')[0]}</h2>
        <p><Lock size={13} style={{ verticalAlign: '-2px' }} /> Enter your password to unlock your encryption keys on this device.</p>
        <form onSubmit={submit}>
          {error && <div className="auth-error"><AlertCircle size={17} /><span>{error}</span></div>}
          <div className="input-group">
            <KeyRound size={17} />
            <input className="input" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoComplete="current-password" />
          </div>
          <button className="btn btn-primary btn-lg btn-block" disabled={busy || !password}>
            {busy ? <><Spinner /> Unlocking…</> : 'Unlock'}
          </button>
          <button type="button" className="btn btn-ghost btn-block" onClick={logout}>Sign out</button>
        </form>
      </div>
    </div>
  );
}
