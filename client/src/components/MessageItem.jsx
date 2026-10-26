import { memo } from 'react';
import { Check, CheckCheck, Clock3, AlertCircle, Lock, RotateCcw, Trash2 } from 'lucide-react';
import { Avatar } from './ui.jsx';
import { Attachments } from './Attachments.jsx';
import { avatarColors, formatTime } from '../lib/format.js';
import { isEmojiOnly, linkify, systemParts } from '../lib/messages.js';

function RichText({ text }) {
  const emoji = isEmojiOnly(text);
  return (
    <div className={`text${emoji ? ' emoji-only' : ''}`}>
      {linkify(text).map((part, i) =>
        typeof part === 'string' ? part : (
          <a key={i} href={part.href} target="_blank" rel="noopener noreferrer nofollow">{part.href}</a>
        )
      )}
    </div>
  );
}

export const SystemMessage = memo(function SystemMessage({ m, users, meId }) {
  const [actor, rest] = systemParts(m, users, meId);
  return <div className="sys-msg"><b>{actor}</b>{rest}</div>;
});

export default memo(function MessageItem({ m, mine, sender, first, last, isGroup, seen, onRetry, onDiscard, onOpenMedia }) {
  const files = m.payload?.files || [];
  const text = m.payload?.text || '';
  const mediaOnly = !text && files.length > 0 && files.every((f) => /^(image|video)\//.test(f.type));

  const status = mine && (
    m.failed ? <AlertCircle size={14} className="fail" />
      : m.pending ? <Clock3 size={12} />
        : seen ? <CheckCheck size={15} className="read" />
          : <Check size={15} />
  );

  const meta = (
    <span className="meta">
      {formatTime(m.createdAt)}
      {status}
    </span>
  );

  return (
    <div className={`msg ${mine ? 'out' : 'in'}${first ? ' first' : ''}${m.failed ? ' failed' : ''}`}>
      {isGroup && !mine && (
        <div className="avatar-slot">{last && sender && <Avatar name={sender.displayName} seed={sender.id} size={30} />}</div>
      )}

      {!m.payload ? (
        <div className="bubble undecryptable">
          <Lock size={14} />
          {m.error === 'no_key' ? 'This message wasn’t encrypted for this account.' : 'This message couldn’t be decrypted.'}
          {meta}
        </div>
      ) : (
        <div className={`bubble${mediaOnly && !isGroup ? ' media-only' : ''}`}>
          {isGroup && !mine && first && sender && (
            <span className="sender" style={{ '--sender-light': avatarColors(sender.id)[1], '--sender-dark': avatarColors(sender.id)[0] }}>
              {sender.displayName}
            </span>
          )}
          {files.length > 0 && <Attachments files={files} pending={m.pending} onOpenMedia={onOpenMedia} />}
          {m.pending && m.progress != null && (
            <div className="upload-progress" aria-label="Uploading"><i style={{ width: `${Math.round(m.progress * 100)}%` }} /></div>
          )}
          {text && <RichText text={text} />}
          {meta}
        </div>
      )}

      {m.failed && (
        <div className="msg-fail-actions">
          <button className="icon-btn sm tooltip" data-tip="Retry" onClick={onRetry} aria-label="Retry sending"><RotateCcw size={16} /></button>
          <button className="icon-btn sm tooltip" data-tip="Discard" onClick={onDiscard} aria-label="Discard message"><Trash2 size={16} /></button>
        </div>
      )}
    </div>
  );
});
