import { useEffect, useState } from 'react';
import { MessageSquare, Phone, Moon, Sun, Settings } from 'lucide-react';
import { useStore } from '../store.js';
import { asset } from '../lib/base.js';
import { Avatar } from './ui.jsx';
import ConversationList from './ConversationList.jsx';
import ChatView from './ChatView.jsx';
import Welcome from './Welcome.jsx';
import ConversationInfo from './ConversationInfo.jsx';
import { NewChatModal, NewGroupModal } from './PeoplePicker.jsx';
import ProfileModal from './ProfileModal.jsx';

export default function Messenger() {
  const me = useStore((s) => s.me);
  const activeId = useStore((s) => s.activeId);
  const infoOpen = useStore((s) => s.infoOpen);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const unreadTotal = useStore((s) => Object.values(s.conversations).reduce((n, c) => n + (c.unread || 0), 0));
  const [modal, setModal] = useState(null); // 'chat' | 'group' | 'profile'

  useEffect(() => {
    document.title = unreadTotal ? `(${unreadTotal}) TIUK Chat` : 'TIUK Chat';
  }, [unreadTotal]);

  useEffect(() => {
    const onVisible = () => {
      const { activeId: id, markRead } = useStore.getState();
      if (id) markRead(id);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  const cls = ['shell', activeId && 'chat-open', activeId && infoOpen && 'info-open'].filter(Boolean).join(' ');

  return (
    <div className={cls}>
      <nav className="rail" aria-label="Main">
        <img className="rail-logo" src={asset('brand/tiuk-mark-light.png')} alt="TIUK Chat" />
        <button className="rail-btn on tooltip right" data-tip="Chats" aria-label="Chats">
          <MessageSquare size={22} />
          {unreadTotal > 0 && <span className="dot" />}
        </button>
        <button className="rail-btn tooltip right" data-tip="Voice & video calls (coming soon)" aria-label="Calls, coming soon" disabled>
          <Phone size={21} />
          <span className="soon">SOON</span>
        </button>
        <div className="rail-spacer" />
        <button
          className="rail-btn tooltip right"
          data-tip={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          aria-label="Toggle theme"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? <Sun size={21} /> : <Moon size={21} />}
        </button>
        <button className="rail-btn tooltip right" data-tip="Settings" aria-label="Settings" onClick={() => setModal('profile')}>
          <Settings size={21} />
        </button>
        <button className="me tooltip right" data-tip={me.displayName} aria-label="Your profile" onClick={() => setModal('profile')}>
          <Avatar name={me.displayName} seed={me.id} size={38} online />
        </button>
      </nav>

      <ConversationList
        onNewChat={() => setModal('chat')}
        onNewGroup={() => setModal('group')}
        onProfile={() => setModal('profile')}
      />

      <main className="chat">
        {activeId ? <ChatView key={activeId} id={activeId} /> : <Welcome onNewChat={() => setModal('chat')} onNewGroup={() => setModal('group')} />}
      </main>

      {activeId && infoOpen && <ConversationInfo key={activeId} id={activeId} />}

      {modal === 'chat' && <NewChatModal onClose={() => setModal(null)} />}
      {modal === 'group' && <NewGroupModal onClose={() => setModal(null)} />}
      {modal === 'profile' && <ProfileModal onClose={() => setModal(null)} />}
    </div>
  );
}
