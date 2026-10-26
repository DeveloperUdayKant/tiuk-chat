import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Paperclip, SendHorizontal, X, Lock, Smile } from 'lucide-react';
import { useStore } from '../store.js';
import { FileGlyph } from './Attachments.jsx';
import { formatBytes } from '../lib/format.js';

const drafts = new Map(); // conversationId -> text
const QUICK_EMOJI = ['😀', '😂', '😍', '👍', '🙏', '🔥', '🎉', '❤️', '😢', '😮', '👏', '✅'];

const Composer = forwardRef(function Composer({ conversationId, disabled, onSent }, ref) {
  const [text, setText] = useState(() => drafts.get(conversationId) || '');
  const [files, setFiles] = useState([]); // { file, url }
  const [emojiOpen, setEmojiOpen] = useState(false);
  const sendMessage = useStore((s) => s.sendMessage);
  const sendTyping = useStore((s) => s.sendTyping);
  const limits = useStore((s) => s.limits);
  const toast = useStore((s) => s.toast);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const typingRef = useRef({ last: 0, timer: null });

  useImperativeHandle(ref, () => ({ addFiles, focus: () => inputRef.current?.focus() }));

  useEffect(() => {
    inputRef.current?.focus();
    const t = typingRef.current;
    return () => {
      clearTimeout(t.timer);
      if (t.last) sendTyping(conversationId, false);
    };
  }, [conversationId, sendTyping]);

  useEffect(() => () => files.forEach((f) => f.url && URL.revokeObjectURL(f.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    drafts.set(conversationId, text);
    const el = inputRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
    }
  }, [text, conversationId]);

  function addFiles(list) {
    const incoming = Array.from(list || []);
    if (!incoming.length) return;
    const tooBig = incoming.filter((f) => f.size > limits.maxFileBytes);
    if (tooBig.length) toast(`${tooBig.map((f) => f.name).join(', ')} exceed${tooBig.length === 1 ? 's' : ''} the ${Math.round(limits.maxFileBytes / 1048576)} MB limit.`, 'error');
    setFiles((cur) => {
      const room = limits.maxFilesPerMessage - cur.length;
      const ok = incoming.filter((f) => f.size <= limits.maxFileBytes && f.size > 0);
      if (ok.length > room) toast(`You can attach up to ${limits.maxFilesPerMessage} files per message.`, 'error');
      return [...cur, ...ok.slice(0, Math.max(room, 0)).map((file) => ({
        file, url: /^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(file.type) ? URL.createObjectURL(file) : null,
      }))];
    });
    inputRef.current?.focus();
  }

  function removeFile(i) {
    setFiles((cur) => {
      if (cur[i]?.url) URL.revokeObjectURL(cur[i].url);
      return cur.filter((_, j) => j !== i);
    });
  }

  function onChange(e) {
    setText(e.target.value);
    const t = typingRef.current;
    const now = Date.now();
    if (now - t.last > 2500) {
      t.last = now;
      sendTyping(conversationId, true);
    }
    clearTimeout(t.timer);
    t.timer = setTimeout(() => {
      t.last = 0;
      sendTyping(conversationId, false);
    }, 3000);
  }

  function submit() {
    if (disabled || (!text.trim() && !files.length)) return;
    const payload = { text, files: files.map((f) => f.file) };
    files.forEach((f) => f.url && URL.revokeObjectURL(f.url));
    setText('');
    setFiles([]);
    setEmojiOpen(false);
    drafts.delete(conversationId);
    clearTimeout(typingRef.current.timer);
    typingRef.current.last = 0;
    sendTyping(conversationId, false);
    onSent?.();
    sendMessage(conversationId, payload);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  function onPaste(e) {
    const pasted = Array.from(e.clipboardData?.files || []);
    if (pasted.length) {
      e.preventDefault();
      addFiles(pasted);
    }
  }

  function insertEmoji(emoji) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  const canSend = !disabled && (text.trim() || files.length);

  return (
    <div className="composer-wrap">
      <div className={`composer${disabled ? ' disabled' : ''}`}>
        {files.length > 0 && (
          <div className="tray">
            {files.map((f, i) => (
              <div key={i} className={`tray-item${f.url ? ' img' : ''}`} title={f.file.name}>
                {f.url ? <img src={f.url} alt={f.file.name} /> : (
                  <>
                    <span className="file-ico" style={{ width: 34, height: 34 }}><FileGlyph name={f.file.name} type={f.file.type} size={18} /></span>
                    <span className="file-info"><b>{f.file.name}</b><span>{formatBytes(f.file.size)}</span></span>
                  </>
                )}
                <button type="button" className="x" onClick={() => removeFile(i)} aria-label={`Remove ${f.file.name}`}><X size={12} /></button>
              </div>
            ))}
          </div>
        )}
        {emojiOpen && (
          <div className="tray" style={{ gap: 2 }}>
            {QUICK_EMOJI.map((em) => (
              <button key={em} type="button" className="icon-btn sm" style={{ fontSize: 20 }} onClick={() => insertEmoji(em)}>{em}</button>
            ))}
          </div>
        )}
        <div className="composer-row">
          <button type="button" className="icon-btn tooltip" data-tip="Attach files" aria-label="Attach files" onClick={() => fileRef.current?.click()}>
            <Paperclip size={20} />
          </button>
          <button type="button" className="icon-btn" aria-label="Emoji" aria-pressed={emojiOpen} onClick={() => setEmojiOpen((v) => !v)}>
            <Smile size={20} />
          </button>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={disabled ? 'Review the security notice above to continue' : 'Write an encrypted message…'}
            aria-label="Message"
            maxLength={20000}
          />
          <button type="button" className="send-btn" onClick={submit} disabled={!canSend} aria-label="Send">
            <SendHorizontal size={19} />
          </button>
        </div>
        <div className="composer-hint">
          <span><Lock size={11} /> End-to-end encrypted</span>
          <span>Enter to send · Shift + Enter for a new line</span>
        </div>
      </div>
    </div>
  );
});

export default Composer;
