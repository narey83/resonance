// SPDX-License-Identifier: AGPL-3.0-only
import { readStudio } from '../../lib/dsp/studioConfig';
import { getMediaAudioGraph } from '../../lib/mediaAudioGraph';
import * as prefs from '../../lib/prefs';
import StudioPanel from './StudioPanel';
import { SlidersHorizontal, X } from 'lucide-react';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const AudioProcessing = ({
  audioRef,
  children,
  launcherTarget = null,
  modalTarget = null,
}) => {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [rackState, setRackState] = useState(() => {
    const saved = readStudio(prefs.get('mediaPlayer.studio.v1', null));
    return { enabled: saved.profiles[saved.output].enabled, bypass: false };
  });
  const state = !rackState.enabled
    ? 'off'
    : rackState.bypass
      ? 'bypassed'
      : 'on';
  const stateLabel =
    state === 'on' ? 'On' : state === 'off' ? 'Off' : 'Bypassed';
  const modalHostRef = useRef(null);
  if (!modalHostRef.current)
    modalHostRef.current = document.createElement('div');
  const modalHost = modalHostRef.current;

  useLayoutEffect(() => {
    (modalTarget || document.body).append(modalHost);
    return () => modalHost.remove();
  }, [modalHost, modalTarget]);

  useEffect(() => {
    if (!open) return undefined;
    const modalDocument = modalHost.ownerDocument;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };

    modalDocument.addEventListener('keydown', onKeyDown);
    modalHost.querySelector('.mp-processing-modal-close')?.focus();
    return () => modalDocument.removeEventListener('keydown', onKeyDown);
  }, [modalHost, open]);

  const showStudio = () => {
    setOpen(true);
    if (!audioRef.current) return;
    void getMediaAudioGraph(audioRef.current)
      .studio.setMode(true)
      .then(() => setError(''))
      .catch((error_) => setError(error_.message || 'Studio could not start.'));
  };

  const launcher = (
    <button
      aria-expanded={open}
      aria-label={`Studio: ${stateLabel}`}
      className={`media-player-btn hover-fx mp-processing-btn mp-processing-btn--${state}`}
      onClick={showStudio}
      title={`Resonance Studio · ${stateLabel}`}
      type="button"
    >
      <SlidersHorizontal size={18} />
      <span>Studio</span>
      <span className="mp-processing-btn-state">{stateLabel}</span>
    </button>
  );

  return (
    <div className="mp-processing">
      {launcher}
      {launcherTarget && createPortal(launcher, launcherTarget)}
      {createPortal(
        <div
          aria-label="Resonance Studio"
          aria-modal="true"
          className={`mp-processing-overlay${open ? '' : ' mp-processing-overlay--hidden'}`}
          onClick={() => setOpen(false)}
          role="dialog"
        >
          <div
            className="mp-processing-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mp-processing-modal-header">
              <span>Resonance Studio</span>
              <button
                className="mp-processing-modal-close hover-fx"
                onClick={() => setOpen(false)}
                title="Close"
                type="button"
              >
                <X size={14} />
              </button>
            </div>
            {error && (
              <p
                className="mp-studio-warning"
                role="alert"
              >
                {error}
              </p>
            )}
            <div className="mp-processing-studio">
              <StudioPanel
                active
                audioRef={audioRef}
                onStatusChange={setRackState}
              />
            </div>
            {open && children}
          </div>
        </div>,
        modalHost,
      )}
    </div>
  );
};

export default AudioProcessing;
