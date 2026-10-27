import React, { useState } from 'react';

const SearchWizard = ({ busy, connected, onCancel, onSearch }) => {
  const [step, setStep] = useState(0);
  const [terms, setTerms] = useState({
    artist: '',
    release: '',
    track: '',
    keywords: '',
  });
  const [format, setFormat] = useState('');
  const [free, setFree] = useState(false);
  const [unlocked, setUnlocked] = useState(true);
  const [timeout, setTimeout] = useState('15');
  const [limit, setLimit] = useState('10000');
  const query = Object.values(terms)
    .map((value) => value.trim())
    .filter(Boolean)
    .join(' ');
  const submit = (event) => {
    event.preventDefault();
    if (!query || busy || (step === 2 && !connected)) return;
    if (step < 2) {
      setStep(step + 1);
      return;
    }

    onSearch({
      search: query,
      options: {
        searchTimeout: Number(timeout) * 1_000,
        fileLimit: Number(limit),
      },
      filters: {
        extensions: format && format !== 'lossless' ? [format] : [],
        flags: [
          ...(free ? ['free-slots'] : []),
          ...(unlocked ? ['unlocked'] : []),
          ...(format === 'lossless' ? ['lossless'] : []),
        ],
      },
    });
  };

  return (
    <form
      className="sr-wizard"
      onSubmit={submit}
    >
      <ol
        aria-label="Search steps"
        className="sr-wizard-steps"
      >
        {['Describe the music', 'Choose your results', 'Review & search'].map(
          (label, index) => (
            <li
              aria-current={step === index ? 'step' : undefined}
              key={label}
            >
              <span>{index + 1}</span>
              {label}
            </li>
          ),
        )}
      </ol>
      <div className="sr-wizard-body">
        <span className="sr-eyebrow">STEP {step + 1} OF 3</span>
        <h2>
          {
            [
              'What are you looking for?',
              'Make the results useful',
              'Ready to explore?',
            ][step]
          }
        </h2>
        {step === 0 && (
          <>
            <p>
              Start with an artist, a track, a release or a few words. Use only
              the fields you need.
            </p>
            <div className="sr-wizard-grid">
              {[
                ['artist', 'Artist', 'e.g. DJ Hell'],
                ['track', 'Track', 'Track name or remix'],
                [
                  'release',
                  'Album / release',
                  'Release name or catalogue number',
                ],
                [
                  'keywords',
                  'Other words',
                  'Genre, label or anything in the file path',
                ],
              ].map(([key, label, placeholder]) => (
                <label key={key}>
                  {label}
                  <input
                    autoFocus={key === 'artist'}
                    onChange={(event) =>
                      setTerms({ ...terms, [key]: event.target.value })
                    }
                    placeholder={placeholder}
                    value={terms[key]}
                  />
                </label>
              ))}
            </div>
            <p className="sr-wizard-note">
              These fields combine into one Soulseek file-path query. They do
              not search verified tags or guarantee exact phrases.
            </p>
          </>
        )}
        {step === 1 && (
          <>
            <p>
              Quality and availability filters apply to received results. You
              can change them afterwards without searching again.
            </p>
            <div className="sr-wizard-grid">
              <label>
                Preferred format
                <select
                  onChange={(event) => setFormat(event.target.value)}
                  value={format}
                >
                  <option value="">Any format</option>
                  <option value="lossless">Lossless formats</option>
                  {['FLAC', 'MP3', 'WAV', 'AAC', 'M4A', 'OPUS'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                Maximum files to collect
                <select
                  onChange={(event) => setLimit(event.target.value)}
                  value={limit}
                >
                  <option value="1000">1,000</option>
                  <option value="10000">10,000</option>
                  <option value="25000">25,000</option>
                </select>
              </label>
              <label>
                Stop after no new responses
                <select
                  onChange={(event) => setTimeout(event.target.value)}
                  value={timeout}
                >
                  <option value="15">15 seconds</option>
                  <option value="30">30 seconds</option>
                  <option value="60">60 seconds</option>
                </select>
              </label>
              <div className="sr-wizard-checks">
                <label>
                  <input
                    checked={free}
                    onChange={(event) => setFree(event.target.checked)}
                    type="checkbox"
                  />{' '}
                  Free upload slots only
                </label>
                <label>
                  <input
                    checked={unlocked}
                    onChange={(event) => setUnlocked(event.target.checked)}
                    type="checkbox"
                  />{' '}
                  Hide locked files
                </label>
              </div>
            </div>
            <p className="sr-wizard-note">
              Collection limits and the inactivity timeout run on your server.
              Format and availability filters only change what you see.
            </p>
          </>
        )}
        {step === 2 && (
          <>
            <p>Your network search</p>
            <blockquote className="sr-query-preview">{query}</blockquote>
            <p>
              {format || 'All formats'} ·{' '}
              {free ? 'Free slots only' : 'Any queue'} ·{' '}
              {unlocked ? 'Unlocked files' : 'Includes locked files'}
            </p>
            <p>
              Collect up to {Number(limit).toLocaleString()} files (or the
              server’s response limit); finish after {timeout}s without a
              response. Peers may omit quality information or return partial
              matches.
            </p>
          </>
        )}
        {!connected && (
          <p role="status">
            Connect to Soulseek to start a search. You can prepare your search
            here.
          </p>
        )}
      </div>
      <footer className="sr-wizard-actions">
        {onCancel && (
          <button
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        )}
        {step > 0 && (
          <button
            disabled={busy}
            onClick={() => setStep(step - 1)}
            type="button"
          >
            Back
          </button>
        )}
        <button
          className="sr-wizard-primary"
          disabled={!query || busy || (step === 2 && !connected)}
          type="submit"
        >
          {busy ? 'Starting…' : step === 2 ? 'Search Soulseek' : 'Continue'}
        </button>
      </footer>
    </form>
  );
};

export default SearchWizard;
