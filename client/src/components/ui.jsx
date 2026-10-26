import { useEffect, useRef } from 'react';
import { X, Users } from 'lucide-react';
import { avatarColors, initials } from '../lib/format.js';

export function Avatar({ name = '', seed, size = 40, online = false, group = false }) {
  const [bg, fg] = avatarColors(seed || name);
  return (
    <div
      className="avatar"
      style={{ width: size, height: size, background: bg, color: fg, fontSize: Math.round(size * 0.38) }}
      aria-hidden="true"
    >
      {group ? <Users size={Math.round(size * 0.46)} strokeWidth={2.2} /> : initials(name)}
      {online && <span className="presence" />}
    </div>
  );
}

export function Modal({ title, subtitle, onClose, children, footer, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input, textarea, button.btn-primary')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <div style={{ flex: 1 }}>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Pixel cluster echoing the squares in the TIUK mark. */
export function Pixels({ style, scale = 1 }) {
  const cells = [[0, 0], [2, 1], [1, 2], [3, 2], [2, 3], [4, 3], [3, 4], [5, 5], [4, 6]];
  const s = 10 * scale;
  return (
    <div className="pixels" style={style} aria-hidden="true">
      {cells.map(([x, y], i) => (
        <i key={i} style={{ left: x * s * 1.5, top: y * s * 1.5, width: s, height: s, opacity: 1 - i * 0.07 }} />
      ))}
    </div>
  );
}

export function Spinner({ size = 18 }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}
