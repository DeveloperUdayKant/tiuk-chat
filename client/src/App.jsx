import { useEffect } from 'react';
import { useStore } from './store.js';
import { asset } from './lib/base.js';
import AuthScreen from './components/AuthScreen.jsx';
import UnlockScreen from './components/UnlockScreen.jsx';
import Messenger from './components/Messenger.jsx';
import Toasts from './components/Toasts.jsx';

export default function App() {
  const status = useStore((s) => s.status);
  const theme = useStore((s) => s.theme);
  const boot = useStore((s) => s.boot);
  const syncSystemTheme = useStore((s) => s.syncSystemTheme);

  useEffect(() => { boot(); }, [boot]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0E1013' : '#16181D');
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener('change', syncSystemTheme);
    return () => mq?.removeEventListener('change', syncSystemTheme);
  }, [syncSystemTheme]);

  return (
    <>
      {status === 'loading' && (
        <div className="splash"><img src={asset('brand/tiuk-mark-light.png')} alt="TIUK Chat" /></div>
      )}
      {status === 'signedOut' && <AuthScreen />}
      {status === 'locked' && <UnlockScreen />}
      {status === 'ready' && <Messenger />}
      <Toasts />
    </>
  );
}
