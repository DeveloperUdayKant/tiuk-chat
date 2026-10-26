import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { useStore } from '../store.js';

const ICONS = { error: AlertCircle, success: CheckCircle2, info: Info };

export default function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.tone] || Info;
        return (
          <div key={t.id} className={`toast ${t.tone}`}>
            <Icon size={18} />
            <span>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
