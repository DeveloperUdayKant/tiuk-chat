import { useState } from 'react';
import {
  Lock, Users, Paperclip, Video, ShieldCheck, AlertCircle, AtSign, User, KeyRound, Eye, EyeOff, Code2, Sparkles,
} from 'lucide-react';
import { useStore } from '../store.js';
import { asset } from '../lib/base.js';
import { Pixels, Spinner } from './ui.jsx';

function scorePassword(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return Math.max(1, Math.min(4, s));
}

const STRENGTH = ['', 'Weak', 'Fair', 'Good', 'Strong'];

export default function AuthScreen() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', displayName: '', password: '', confirm: '' });
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const login = useStore((s) => s.login);
  const register = useStore((s) => s.register);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const isRegister = mode === 'register';
  const score = scorePassword(form.password);

  async function submit(e) {
    e.preventDefault();
    setError('');
    const username = form.username.trim().toLowerCase().replace(/^@/, '');
    if (isRegister) {
      if (!/^[a-z0-9_.]{3,32}$/.test(username)) return setError('Usernames are 3–32 characters: letters, numbers, dot or underscore.');
      if (!form.displayName.trim()) return setError('Please enter your name.');
      if (form.password.length < 10) return setError('Use at least 10 characters for your password.');
      if (form.password !== form.confirm) return setError('Passwords do not match.');
    }
    setBusy(true);
    try {
      if (isRegister) await register({ username, displayName: form.displayName.trim(), password: form.password });
      else await login({ username, password: form.password });
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  function switchMode(m) {
    setMode(m);
    setError('');
  }

  return (
    <div className="auth">
      <section className="auth-brand">
        <Pixels style={{ right: 56, bottom: 140, color: 'rgba(255,255,255,.08)' }} scale={1.4} />
        <div className="code-glyph"><Code2 size={22} /> <Sparkles size={16} /></div>
        <div className="auth-logo">
          <img src={asset('brand/tiuk-mark-light.png')} alt="" />
          <div>
            <div className="wordmark">TIUK <em>Chat</em></div>
            <small>by thisisudaykant.com</small>
          </div>
        </div>

        <div className="auth-hero">
          <span className="eyebrow"><ShieldCheck size={15} /> End-to-end encrypted by default</span>
          <h1>Private conversations, <em>sealed</em> end to end.</h1>
          <p>
            Messages and files are encrypted on your device before they leave it.
            Only the people in the conversation hold the keys. Not even TIUK can read them.
          </p>
          <ul className="auth-features">
            <li><span className="ico"><Lock size={17} /></span><div><b>Zero-knowledge</b><span>Keys never leave your device</span></div></li>
            <li><span className="ico"><Users size={17} /></span><div><b>1:1 &amp; group chats</b><span>Real-time, with read receipts</span></div></li>
            <li><span className="ico"><Paperclip size={17} /></span><div><b>Encrypted files</b><span>Share multiple files at once</span></div></li>
            <li><span className="ico"><Video size={17} /></span><div><b>Voice &amp; video</b><span>Coming soon</span></div></li>
          </ul>
        </div>

        <div className="auth-foot">
          <span className="tagline">Your digital partner</span>
          <a href="https://thisisudaykant.com" target="_blank" rel="noopener noreferrer">thisisudaykant.com</a>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="mobile-logo">
            <img src={asset('brand/tiuk-mark.png')} alt="" />
            <div className="wordmark">TIUK <em>Chat</em></div>
          </div>
          <h2>{isRegister ? 'Create your account' : 'Welcome back'}</h2>
          <p>{isRegister ? 'Your encryption keys are generated on this device.' : 'Sign in to continue your conversations.'}</p>

          <div className="seg" role="tablist">
            <button type="button" role="tab" aria-selected={!isRegister} className={!isRegister ? 'on' : ''} onClick={() => switchMode('login')}>Sign in</button>
            <button type="button" role="tab" aria-selected={isRegister} className={isRegister ? 'on' : ''} onClick={() => switchMode('register')}>Create account</button>
          </div>

          <form className="auth-form" onSubmit={submit} noValidate>
            {error && <div className="auth-error" role="alert"><AlertCircle size={17} /><span>{error}</span></div>}

            {isRegister && (
              <label className="field">
                <span>Your name</span>
                <div className="input-group">
                  <User size={17} />
                  <input className="input" value={form.displayName} onChange={set('displayName')} placeholder="Uday Kant" maxLength={64} autoComplete="name" />
                </div>
              </label>
            )}

            <label className="field">
              <span>Username</span>
              <div className="input-group">
                <AtSign size={17} />
                <input className="input" value={form.username} onChange={set('username')} placeholder="udaykant" maxLength={33}
                  autoComplete="username" autoCapitalize="none" spellCheck={false} />
              </div>
            </label>

            <label className="field">
              <span>Password</span>
              <div className="input-group">
                <KeyRound size={17} />
                <input className="input" type={showPw ? 'text' : 'password'} value={form.password} onChange={set('password')}
                  placeholder={isRegister ? 'At least 10 characters' : 'Your password'}
                  autoComplete={isRegister ? 'new-password' : 'current-password'} style={{ paddingRight: 44 }} />
                <button type="button" className="icon-btn sm input-action" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}>
                  {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              {isRegister && form.password && (
                <>
                  <div className="strength" data-score={score}><i /><i /><i /><i /></div>
                  <span className="hint">Password strength: {STRENGTH[score]}</span>
                </>
              )}
            </label>

            {isRegister && (
              <label className="field">
                <span>Confirm password</span>
                <div className="input-group">
                  <KeyRound size={17} />
                  <input className="input" type={showPw ? 'text' : 'password'} value={form.confirm} onChange={set('confirm')} placeholder="Repeat password" autoComplete="new-password" />
                </div>
              </label>
            )}

            {isRegister && (
              <div className="auth-note">
                <ShieldCheck size={16} />
                <span>
                  Your password encrypts your private key, and we never see it. <b>It can’t be reset</b>:
                  if you forget it, your encrypted history can’t be recovered.
                </span>
              </div>
            )}

            <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
              {busy ? <><Spinner /> {isRegister ? 'Generating keys…' : 'Decrypting your keys…'}</> : isRegister ? 'Create secure account' : 'Sign in'}
            </button>
            {busy && <div className="auth-progress">Deriving keys locally with PBKDF2 (600k rounds)</div>}
          </form>

          <p className="auth-legal">A product of <a href="https://thisisudaykant.com" target="_blank" rel="noopener noreferrer">thisisudaykant.com</a></p>
        </div>
      </section>
    </div>
  );
}
