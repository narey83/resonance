import * as mixtapes from '../../../lib/mixtapes';
import { Trash2 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MixtapeDeleteDialog = ({ mixtape, onCancel, onDeleted }) => {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const pending = useRef(false);
  const alive = useRef(true);
  const callbacks = useRef({ onCancel, onDeleted });
  callbacks.current = { onCancel, onDeleted };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    alive.current = true;
    const doc = dialogRef.current.ownerDocument;
    const previousFocus = doc.activeElement;
    cancelRef.current.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!pending.current) callbacks.current.onCancel();
      }

      if (event.key === 'Tab') {
        const buttons = [
          ...dialogRef.current.querySelectorAll('button:not(:disabled)'),
        ];
        if (!buttons.length) {
          event.preventDefault();
          return;
        }

        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (
          event.shiftKey &&
          (doc.activeElement === first ||
            !dialogRef.current.contains(doc.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (doc.activeElement === last ||
            !dialogRef.current.contains(doc.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    doc.addEventListener('keydown', onKey, true);
    return () => {
      alive.current = false;
      doc.removeEventListener('keydown', onKey, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  const handleFailure = () => {
    if (!alive.current) return;
    pending.current = false;
    setBusy(false);
    setError('Could not delete this playlist. Please try again.');
  };

  const handleDelete = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await mixtapes.remove(mixtape.id);
    } catch {
      handleFailure();
      return;
    }

    if (alive.current) callbacks.current.onDeleted(mixtape.id);
  };

  return createPortal(
    <div className="jb-mixtape-delete-overlay">
      <div
        aria-busy={busy}
        aria-describedby="mixtape-delete-description"
        aria-label="Delete playlist"
        aria-modal="true"
        className="jb-mixtape-delete-dialog"
        ref={dialogRef}
        role="alertdialog"
      >
        <h2>Delete playlist?</h2>
        <p id="mixtape-delete-description">
          This will remove <strong>{mixtape.name}</strong> and its{' '}
          {mixtape.tracks?.length || 0} track
          {mixtape.tracks?.length === 1 ? ' entry' : ' entries'}. Your original
          music files will stay in the library.
        </p>
        {mixtape.isPublished && <p>Its shared link will stop working.</p>}
        {error && (
          <p
            className="jb-mixtape-delete-error"
            role="alert"
          >
            {error}
          </p>
        )}
        <div className="jb-mixtape-delete-actions">
          <button
            className="jb-btn"
            disabled={busy}
            onClick={() => onCancel()}
            ref={cancelRef}
            type="button"
          >
            Cancel
          </button>
          <button
            className="jb-btn jb-btn--danger"
            disabled={busy}
            onClick={handleDelete}
            type="button"
          >
            <Trash2 size={14} /> {busy ? 'Deleting…' : 'Delete playlist'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default MixtapeDeleteDialog;
