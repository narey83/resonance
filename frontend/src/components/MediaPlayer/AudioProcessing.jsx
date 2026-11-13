// SPDX-License-Identifier: AGPL-3.0-only
import { readStudio } from '../../lib/dsp/studioConfig';
import { getMediaAudioGraph } from '../../lib/mediaAudioGraph';
import * as prefs from '../../lib/prefs';
import StudioPanel from './StudioPanel';
import { Power, SlidersHorizontal, X } from 'lucide-react';
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
  const [studio, setStudio] = useState(() =>
    readStudio(prefs.get('mediaPlayer.studio.v1', null)),
  );
  const [bypass, setBypass] = useState(false);
  const powerRequest = useRef(0);
  const profile = studio.profiles[studio.output];
  const state = !profile.enabled ? 'off' : bypass ? 'bypassed' : 'on';
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

  const startStudio = async () => {
    if (!audioRef.current) return;
    await getMediaAudioGraph(audioRef.current).studio.setMode(true);
    setError('');
  };

  const setRackEnabled = (enabled) => {
    setStudio((previous) => {
      const output = previous.output;
      const next = {
        ...previous,
        profiles: {
          ...previous.profiles,
          [output]: { ...previous.profiles[output], enabled },
        },
      };
      prefs.set('mediaPlayer.studio.v1', next);
      return next;
    });
  };

  const showStudio = () => {
    setOpen(true);
    void startStudio().catch((error_) =>
      setError(error_.message || 'Studio could not start.'),
    );
  };

  const togglePower = () => {
    const enabling = !profile.enabled;
    const request = ++powerRequest.current;
    setBypass(false);
    setRackEnabled(enabling);
    if (enabling)
      void startStudio().catch((error_) => {
        if (request !== powerRequest.current) return;
        setRackEnabled(false);
        setError(error_.message || 'Studio could not start.');
        setOpen(true);
      });
  };

  const launcher = (
    <div
      aria-label="Resonance Studio controls"
      className={`mp-processing-control mp-processing-btn--${state}`}
      role="group"
    >
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Open Resonance Studio"
        className="media-player-btn hover-fx mp-processing-btn"
        onClick={showStudio}
        title="Open Resonance Studio"
        type="button"
      >
        <SlidersHorizontal size={18} />
        <span>Studio</span>
      </button>
      <button
        aria-label={profile.enabled ? 'Turn Studio off' : 'Turn Studio on'}
        aria-pressed={profile.enabled}
        className="media-player-btn hover-fx mp-processing-power"
        onClick={togglePower}
        title={`Turn Studio ${profile.enabled ? 'off' : 'on'} · ${stateLabel}`}
        type="button"
      >
        <Power size={14} />
        <span>{stateLabel}</span>
      </button>
    </div>
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
                bypass={bypass}
                setBypass={setBypass}
                setStudio={setStudio}
                studio={studio}
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
