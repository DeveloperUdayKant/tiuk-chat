import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, Copy } from 'lucide-react';
import { useStore } from '../store.js';
import { safetyNumber } from '../lib/crypto.js';
import { isVerified, setVerified } from '../lib/keystore.js';
import { Modal, Spinner } from './ui.jsx';

export default function SafetyNumberModal({ user, onClose }) {
  const me = useStore((s) => s.me);
  const changed = useStore((s) => !!s.keyAlerts[user.id]);
  const acceptKeyChange = useStore((s) => s.acceptKeyChange);
  const toast = useStore((s) => s.toast);
  const [groups, setGroups] = useState(null);
  const [verified, setV] = useState(() => isVerified(me.id, user));

  useEffect(() => {
    safetyNumber({ id: me.id, publicKey: me.publicKey }, { id: user.id, publicKey: user.publicKey }).then(setGroups);
  }, [me.id, me.publicKey, user.id, user.publicKey]);

  function toggleVerified() {
    if (changed) acceptKeyChange(user.id);
    setVerified(me.id, user, !verified);
    setV(!verified);
    toast(!verified ? `${user.displayName} marked as verified.` : 'Verification cleared.', 'success');
  }

  function accept() {
    acceptKeyChange(user.id);
    toast('New security key accepted.', 'success');
    onClose();
  }

  return (
    <Modal
      title="Verify safety number"
      subtitle={`You and ${user.displayName}`}
      onClose={onClose}
      footer={changed ? (
        <>
          <button className="btn btn-ghost" onClick={onClose}>Not now</button>
          <button className="btn btn-outline" onClick={toggleVerified}>I compared it: verified</button>
          <button className="btn btn-primary" onClick={accept}>Accept new key</button>
        </>
      ) : (
        <>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className={`btn ${verified ? 'btn-outline' : 'btn-primary'}`} onClick={toggleVerified}>
            {verified ? 'Clear verification' : 'Mark as verified'}
          </button>
        </>
      )}
    >
      {changed ? (
        <div className="banner" style={{ borderRadius: 12, border: 0 }}>
          <ShieldAlert size={18} />
          <p>{user.displayName}’s key is different from the one this device saw before.</p>
        </div>
      ) : verified ? (
        <span className="verified-pill"><ShieldCheck size={14} /> Verified</span>
      ) : null}

      <div className="safety-grid" aria-label="Safety number">
        {groups ? groups.map((g, i) => <span key={i}>{g}</span>) : <span style={{ gridColumn: '1 / -1' }}><Spinner /></span>}
      </div>
      <p className="safety-help">
        Compare these numbers with {user.displayName} in person or on a call you trust. If they match on both
        devices, your conversation can’t be intercepted, not even by the TIUK server.
      </p>
      {groups && (
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 10, marginLeft: -8 }}
          onClick={() => navigator.clipboard?.writeText(groups.join(' ')).then(() => toast('Safety number copied.', 'success'))}>
          <Copy size={14} /> Copy number
        </button>
      )}
    </Modal>
  );
}
