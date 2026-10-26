import { useEffect, useState } from 'react';
import {
  Download, FileText, FileArchive, FileSpreadsheet, FileCode2, File as FileIcon, FileImage, FileVideo, FileAudio, Play, ImageOff,
} from 'lucide-react';
import { getFileUrl, downloadFile, useStore } from '../store.js';
import { fileKind, formatBytes, previewKind } from '../lib/format.js';
import { Spinner } from './ui.jsx';

const KIND_ICONS = {
  image: FileImage, video: FileVideo, audio: FileAudio, pdf: FileText, doc: FileText,
  archive: FileArchive, sheet: FileSpreadsheet, code: FileCode2, file: FileIcon,
};

export function FileGlyph({ name, type, size = 20 }) {
  const Icon = KIND_ICONS[fileKind(name, type)] || FileIcon;
  return <Icon size={size} />;
}

export function useDecryptedUrl(file, enabled = true) {
  const kind = previewKind(file.type);
  const [state, setState] = useState({ url: file.localUrl || null, error: false });
  useEffect(() => {
    if (!enabled || state.url || !file.id) return;
    let alive = true;
    getFileUrl(file, kind && file.type)
      .then((url) => alive && setState({ url, error: false }))
      .catch(() => alive && setState({ url: null, error: true }));
    return () => { alive = false; };
  }, [file.id, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export function MediaTile({ file, onOpen, more = 0 }) {
  const { url, error } = useDecryptedUrl(file);
  const isVideo = previewKind(file.type) === 'video';
  return (
    <button type="button" className="media-tile" onClick={onOpen} aria-label={`Open ${file.name}`}>
      {url && !isVideo && <img src={url} alt={file.name} draggable={false} />}
      {url && isVideo && (
        <>
          <video src={url} muted preload="metadata" />
          <span className="loading" style={{ color: '#fff' }}><Play size={34} fill="currentColor" /></span>
        </>
      )}
      {!url && <span className="loading">{error ? <ImageOff size={22} /> : <Spinner />}</span>}
      {more > 0 && <span className="more">+{more}</span>}
    </button>
  );
}

export function FileCard({ file, disabled }) {
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);
  async function download() {
    setBusy(true);
    try {
      await downloadFile(file);
    } catch {
      toast('Could not download or decrypt this file.', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className="file-card" onClick={download} disabled={disabled || busy} title={`Download ${file.name}`}>
      <span className="file-ico"><FileGlyph name={file.name} type={file.type} /></span>
      <span className="file-info">
        <b>{file.name}</b>
        <span>{formatBytes(file.size)} · {(file.name.split('.').pop() || 'file').toUpperCase().slice(0, 6)}</span>
      </span>
      <span className="dl">{busy ? <Spinner size={16} /> : <Download size={18} />}</span>
    </button>
  );
}

export function AudioCard({ file, disabled }) {
  const [play, setPlay] = useState(false);
  const { url } = useDecryptedUrl(file, play);
  if (play && url) {
    return <div className="audio-card"><audio src={url} controls autoPlay /></div>;
  }
  return (
    <button type="button" className="file-card" onClick={() => setPlay(true)} disabled={disabled}>
      <span className="file-ico">{play ? <Spinner size={16} /> : <Play size={18} />}</span>
      <span className="file-info"><b>{file.name}</b><span>{formatBytes(file.size)} · Audio</span></span>
    </button>
  );
}

export function Attachments({ files, pending, onOpenMedia }) {
  const media = files.filter((f) => ['image', 'video'].includes(previewKind(f.type)));
  const audio = files.filter((f) => previewKind(f.type) === 'audio');
  const other = files.filter((f) => !previewKind(f.type));
  const shown = media.slice(0, 4);
  return (
    <div className="attachments">
      {shown.length > 0 && (
        <div className={`media-grid n${Math.min(shown.length, 4)}`}>
          {shown.map((f, i) => (
            <MediaTile key={f.id || f.localUrl} file={f} onOpen={() => onOpenMedia(media, i)}
              more={i === 3 ? media.length - 4 : 0} />
          ))}
        </div>
      )}
      {audio.map((f) => <AudioCard key={f.id || f.localUrl} file={f} disabled={pending} />)}
      {other.map((f) => <FileCard key={f.id || f.localUrl} file={f} disabled={pending} />)}
    </div>
  );
}
