import {
  BANDS,
  clamp,
  MODULES,
  PRESETS,
  readProfile,
} from '../../lib/dsp/studioConfig';
import { getMediaAudioGraph } from '../../lib/mediaAudioGraph';
import * as prefs from '../../lib/prefs';
import React, { useEffect, useState } from 'react';

const KEY = 'mediaPlayer.studio.v1';
const groupNames = {
  tone: 'Tone',
  mastering: 'Mastering',
  creative: 'Creative',
};

const StudioPanel = ({
  active,
  audioRef,
  bypass,
  setBypass,
  setStudio,
  studio,
}) => {
  const [section, setSection] = useState('tone');
  const [pushed, setPushed] = useState(false);
  const [pushConfirm, setPushConfirm] = useState(false);
  const [name, setName] = useState('');
  const profile = studio.profiles[studio.output];

  useEffect(() => {
    if (!active || !audioRef.current) return;
    getMediaAudioGraph(audioRef.current).studio.configure({
      ...profile,
      pushed,
      bypass,
    });
  }, [active, audioRef, bypass, profile, pushed]);

  const updateStudio = (change) => {
    setStudio((previous) => {
      const next = change(previous);
      prefs.set(KEY, next);
      return next;
    });
  };

  const updateProfile = (change) =>
    updateStudio((previous) => {
      const output = previous.output;
      const updated = change(previous.profiles[output]);
      return {
        ...previous,
        profiles: { ...previous.profiles, [output]: updated },
      };
    });
  const changeValue = (field, value) =>
    updateProfile((previous) => ({
      ...previous,
      [field]: value,
      selectedPreset: null,
    }));
  const changeModule = (index, value) =>
    updateProfile((previous) => {
      const values = [...previous.values];
      values[index] = clamp(value, 0, pushed ? 1 : MODULES[index][3]);
      return { ...previous, values, selectedPreset: null };
    });
  const switchOutput = (output) => {
    setBypass(false);
    updateStudio((previous) => ({ ...previous, output }));
  };

  const presets = [
    ...PRESETS.map((preset) => ({ ...preset, id: `builtin:${preset.name}` })),
    ...studio.presets.map((preset) => ({
      ...preset,
      id: `saved:${preset.name}`,
    })),
  ];
  const selectPreset = (preset) => {
    if (profile.selectedPreset === preset.id && profile.enabled && !bypass) {
      updateProfile((previous) => ({ ...previous, enabled: false }));
      return;
    }

    const tone = preset.tones?.[studio.output] || preset;
    updateProfile((previous) => ({
      ...previous,
      enabled: true,
      values: [...preset.values],
      disabled: MODULES.map(() => false),
      eq: [...(tone.eq || BANDS.map(() => 0))],
      bassControl: tone.bassControl || 0,
      smoothness: tone.smoothness || 0,
      amount: tone.amount ?? 1,
      selectedPreset: preset.id,
    }));
    setBypass(false);
  };

  const stopPushing = () => {
    setPushed(false);
    updateProfile((previous) => ({
      ...previous,
      values: previous.values.map((value, i) => clamp(value, 0, MODULES[i][3])),
      selectedPreset: null,
    }));
  };

  const savePreset = () => {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) return;
    updateStudio((previous) => ({
      ...previous,
      presets: [
        {
          name: trimmed,
          ...readProfile({
            ...profile,
            values: profile.values.map((value, i) =>
              profile.disabled[i] ? 0 : Math.min(value, MODULES[i][3]),
            ),
          }),
        },
        ...previous.presets.filter((preset) => preset.name !== trimmed),
      ].slice(0, 12),
    }));
    setName('');
  };

  const slider = (label, value, min, max, step, onChange, suffix = '%') => (
    <label
      className="mp-studio-slider"
      key={label}
    >
      <span>{label}</span>
      <input
        aria-label={label}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
      <output>
        {suffix === '%'
          ? `${Math.round(value * 100)}%`
          : `${value.toFixed(1)} dB`}
      </output>
    </label>
  );

  return (
    <div className="mp-studio-panel">
      <div className="mp-studio-overview">
        <div className="mp-studio-intro">
          <span>RESONANCE / STUDIO</span>
          <h2>Shape the sound.</h2>
          <p>
            Headphone and speaker tuning, eight-band EQ and a mastering rack
            with a creative streak. Automatic headroom and a fixed −1 dBFS
            sample-peak ceiling.
          </p>
        </div>
        <div className="mp-studio-row">
          <strong>Listening through</strong>
          {['headphones', 'speakers'].map((output) => (
            <button
              aria-pressed={studio.output === output}
              key={output}
              onClick={() => switchOutput(output)}
              type="button"
            >
              {output === 'headphones' ? 'Headphones' : 'Speakers'}
            </button>
          ))}
        </div>
        <p className="mp-studio-note">
          Each output remembers its own rack and tone settings.
        </p>
        <div className="mp-studio-row">
          <label>
            <input
              aria-label="Studio processing rack"
              checked={profile.enabled}
              onChange={(event) => {
                const enabled = event.target.checked;
                updateProfile((previous) => ({ ...previous, enabled }));
              }}
              type="checkbox"
            />{' '}
            Processing rack
          </label>
          <button
            aria-pressed={bypass}
            disabled={!profile.enabled}
            onClick={() => setBypass(!bypass)}
            type="button"
          >
            {bypass ? 'A / Dry comparison' : 'B / Processed'}
          </button>
          <button
            aria-pressed={pushed}
            onClick={() => (pushed ? stopPushing() : setPushConfirm(true))}
            type="button"
          >
            {pushed ? 'Return to controlled' : 'Push it'}
          </button>
        </div>
        {pushConfirm && (
          <div
            className="mp-studio-warning"
            role="alert"
          >
            <strong>This can get ugly.</strong> Extreme processing may cause
            distortion, harshness and unpredictable level changes. The output
            peak guard stays on.
            <div>
              <button
                onClick={() => setPushConfirm(false)}
                type="button"
              >
                Keep it controlled
              </button>
              <button
                onClick={() => {
                  setPushed(true);
                  setPushConfirm(false);
                }}
                type="button"
              >
                Push it — I accept
              </button>
            </div>
          </div>
        )}
        <p className="mp-studio-note">
          A/B matches levels by attenuation, never extra gain. Push it resets
          when the page reloads.
        </p>
        <strong className="mp-studio-heading">Starting points</strong>
        <div className="mp-studio-presets">
          {presets.map((preset) => (
            <button
              aria-pressed={
                profile.selectedPreset === preset.id &&
                profile.enabled &&
                !bypass
              }
              key={preset.id}
              onClick={() => selectPreset(preset)}
              type="button"
            >
              {preset.name}
            </button>
          ))}
        </div>
        <p
          aria-live="polite"
          className="mp-studio-note"
        >
          {profile.selectedPreset
            ? `${presets.find((preset) => preset.id === profile.selectedPreset)?.name || 'Custom'} · ${!profile.enabled ? 'Rack off' : bypass ? 'Bypassed for dry comparison' : 'Active'}`
            : 'Custom settings · choose a starting point or save your rack.'}
        </p>
        {slider('Preset amount', profile.amount, 0, 1, 0.01, (value) =>
          changeValue('amount', value),
        )}
        <p className="mp-studio-note">
          At 0%, effects and EQ are neutral; the peak guard stays on.
        </p>
      </div>
      <div className="mp-studio-details">
        <div
          aria-label="Studio sections"
          className="mp-studio-tabs"
          role="tablist"
        >
          {Object.entries(groupNames).map(([id, label]) => (
            <button
              aria-selected={section === id}
              key={id}
              onClick={() => setSection(id)}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        {section === 'tone' && (
          <div role="tabpanel">
            <h3>Dynamic tone</h3>
            {slider('Bass control', profile.bassControl, 0, 1, 0.01, (value) =>
              changeValue('bassControl', value),
            )}
            <p className="mp-studio-note">
              Tames excessive bass bloom as it appears.
            </p>
            {slider('Smoothness', profile.smoothness, 0, 1, 0.01, (value) =>
              changeValue('smoothness', value),
            )}
            <p className="mp-studio-note">
              Softens prominent upper mids and treble as the music changes.
            </p>
            <div className="mp-studio-row">
              <h3>Eight-band EQ</h3>
              <button
                onClick={() =>
                  changeValue(
                    'eq',
                    BANDS.map(() => 0),
                  )
                }
                type="button"
              >
                Reset EQ
              </button>
            </div>
            <p className="mp-studio-note">
              ±6 dB per band, with automatic headroom for boosts.
            </p>
            {BANDS.map((hz, i) =>
              slider(
                `${hz >= 1_000 ? `${hz / 1_000} kHz` : `${hz} Hz`}`,
                profile.eq[i],
                -6,
                6,
                0.1,
                (value) => {
                  const eq = [...profile.eq];
                  eq[i] = value;
                  changeValue('eq', eq);
                },
                'dB',
              ),
            )}
          </div>
        )}
        {section !== 'tone' && (
          <div role="tabpanel">
            <div className="mp-studio-row">
              <h3>{groupNames[section]}</h3>
              <button
                onClick={() =>
                  updateProfile((previous) => ({
                    ...previous,
                    values: previous.values.map((value, i) =>
                      MODULES[i][4] === section ? 0 : value,
                    ),
                    selectedPreset: null,
                  }))
                }
                type="button"
              >
                Reset {groupNames[section]}
              </button>
            </div>
            {MODULES.map(
              ([id, title, detail, safe, group], i) =>
                group === section && (
                  <div
                    className="mp-studio-module"
                    key={id}
                  >
                    <label>
                      <input
                        aria-label={`${title} enabled`}
                        checked={!profile.disabled[i]}
                        onChange={() =>
                          updateProfile((previous) => {
                            const disabled = [...previous.disabled];
                            disabled[i] = !disabled[i];
                            return {
                              ...previous,
                              disabled,
                              selectedPreset: null,
                            };
                          })
                        }
                        type="checkbox"
                      />{' '}
                      {title}
                    </label>
                    {slider(
                      title,
                      profile.values[i],
                      0,
                      pushed ? 1 : safe,
                      0.01,
                      (value) => changeModule(i, value),
                    )}
                    <p className="mp-studio-note">{detail}</p>
                  </div>
                ),
            )}
          </div>
        )}
        <div className="mp-studio-save">
          <strong>Save your rack</strong>
          <input
            aria-label="Preset name"
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            placeholder="Preset name"
            value={name}
          />
          <button
            disabled={!name.trim()}
            onClick={savePreset}
            type="button"
          >
            Save preset
          </button>
          <p className="mp-studio-note">
            Saved presets use controlled ranges. Push it consent is never saved.
          </p>
        </div>
      </div>
    </div>
  );
};

export default StudioPanel;
