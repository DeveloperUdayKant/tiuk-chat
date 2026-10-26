import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { downloadFile } from '../store.js';
import { formatBytes, previewKind } from '../lib/format.js';
import { useDecryptedUrl } from './Attachments.jsx';
import { Spinner } from './ui.jsx';

export default function Lightbox({ files, index: start, onClose }) {
  const [index, setIndex] = useState(start);
  const file = files[index];
  const { url } = useDecryptedUrl(file);
  const many = files.length > 1;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, files.length - 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [files.length, onClose]);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={file.name}>
      <div className="lightbox-bar">
        <div className="name">{file.name} <span style={{ opacity: .6, fontWeight: 400 }}>· {formatBytes(file.size)}{many && ` · ${index + 1} of ${files.length}`}</span></div>
        {many && <button className="icon-btn" onClick={() => setIndex((i) => Math.max(i - 1, 0))} disabled={index === 0} aria-label="Previous"><ChevronLeft size={22} /></button>}
        {many && <button className="icon-btn" onClick={() => setIndex((i) => Math.min(i + 1, files.length - 1))} disabled={index === files.length - 1} aria-label="Next"><ChevronRight size={22} /></button>}
        <button className="icon-btn" onClick={() => downloadFile(file)} aria-label="Download"><Download size={20} /></button>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={22} /></button>
      </div>
      <div className="lightbox-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {!url && <Spinner size={28} />}
        {url && previewKind(file.type) === 'video' && <video key={url} src={url} controls autoPlay />}
        {url && previewKind(file.type) === 'image' && <img key={url} src={url} alt={file.name} />}
      </div>
    </div>
  );
}
