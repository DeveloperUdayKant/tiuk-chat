import { MessageSquarePlus, Users, Lock } from 'lucide-react';
import { useStore } from '../store.js';
import { asset } from '../lib/base.js';
import { Pixels } from './ui.jsx';

export default function Welcome({ onNewChat, onNewGroup }) {
  const me = useStore((s) => s.me);
  const theme = useStore((s) => s.theme);
  return (
    <div className="welcome">
      <Pixels style={{ left: 48, top: 48 }} scale={1.6} />
      <Pixels style={{ right: 64, bottom: 90, transform: 'rotate(180deg)' }} scale={1.1} />
      <div className="welcome-inner">
        <img src={asset(theme === 'dark' ? 'brand/tiuk-mark-light.png' : 'brand/tiuk-mark.png')} alt="" />
        <h2>Hi {me.displayName.split(' ')[0]}, welcome to TIUK Chat</h2>
        <p>
          Pick a conversation from the list, or start a new one. Everything you send,
          including text and files, is encrypted on this device first.
        </p>
        <div className="welcome-actions">
          <button className="btn btn-primary btn-lg" onClick={onNewChat}><MessageSquarePlus size={18} /> New chat</button>
          <button className="btn btn-outline btn-lg" onClick={onNewGroup}><Users size={18} /> New group</button>
        </div>
      </div>
      <div className="welcome-foot"><Lock size={13} /> Your personal messages are end-to-end encrypted</div>
    </div>
  );
}
