import './Tools.css';
import api from '../../../lib/api';
import React, { useEffect, useRef, useState } from 'react';

const message = (error) =>
  error?.response?.data?.message || 'The request failed. Please try again.';

const descriptions = {
  ytdlp:
    'Finds and downloads audio from supported video sites. Updates keep it working when those sites change.',
  ffmpeg:
    'Converts media into your chosen audio format and reads details such as duration and codecs.',
  deno: 'Runs the JavaScript needed to resolve YouTube playback links so downloads can start.',
  bgutil:
    'Generates the playback tokens YouTube may require for downloads. Node runs this helper inside the backend.',
};

const Tools = () => {
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState('');
  const [checkedAt, setCheckedAt] = useState(null);
  const mounted = useRef(true);

  const load = async (check = false) => {
    if (check) setChecking(true);
    try {
      const { data } = await api.get('/tools', { params: { check } });
      if (!mounted.current) return;
      setTools(data);
      if (check) setCheckedAt(new Date());
      setErrors((previous) => ({ ...previous, page: null }));
    } catch (error) {
      if (mounted.current)
        setErrors((previous) => ({ ...previous, page: message(error) }));
    } finally {
      if (mounted.current) {
        setLoading(false);
        setChecking(false);
      }
    }
  };

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
  }, []);

  const update = async (items) => {
    setNotice('');
    let completed = 0;
    for (const tool of items) {
      if (!mounted.current) break;
      setBusy(tool.id);
      setErrors((previous) => ({ ...previous, [tool.id]: null }));
      try {
        await api.post(`/tools/${tool.id}/update`, {}, { timeout: 310_000 });
        completed += 1;
      } catch (error) {
        if (mounted.current)
          setErrors((previous) => ({ ...previous, [tool.id]: message(error) }));
      }
    }

    if (mounted.current) {
      setBusy(null);
      setNotice(`${completed} of ${items.length} updates completed.`);
      await load(true);
    }
  };

  const available = tools.filter(
    (tool) => tool.canUpdate && tool.updateAvailable === true,
  );
  const locked = Boolean(busy) || checking;

  return (
    <section
      aria-label="Tools and updates"
      className="tools-page"
    >
      <header className="tools-heading">
        <div>
          <h2>Tools &amp; updates</h2>
          <p>Keep the server’s media tools ready for your next download.</p>
        </div>
        <div className="tools-actions">
          <button
            className="ui button"
            disabled={locked || loading}
            onClick={() => load(true)}
            type="button"
          >
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
          <button
            className="ui primary button"
            disabled={locked || !available.length}
            onClick={() => update(available)}
            type="button"
          >
            {busy
              ? 'Updating…'
              : `Update available tools (${available.length})`}
          </button>
        </div>
      </header>
      <div
        aria-live="polite"
        className="tools-feedback"
      >
        {errors.page && <p role="alert">{errors.page}</p>}
        {notice && <p>{notice}</p>}
        {checkedAt && <p>Last checked {checkedAt.toLocaleTimeString()}</p>}
        {loading && <p>Loading installed tools…</p>}
      </div>
      <div className="tools-grid">
        {tools.map((tool) => (
          <article
            className="tool-card"
            key={tool.id}
          >
            <div className="tool-card-heading">
              <h3>{tool.name}</h3>
              <span className={tool.updateAvailable ? 'tool-update' : ''}>
                {busy === tool.id
                  ? 'Installing…'
                  : tool.updateAvailable === true
                    ? 'Update available'
                    : tool.updateAvailable === false
                      ? 'Up to date'
                      : 'Not checked'}
              </span>
            </div>
            <p className="tool-description">{descriptions[tool.id]}</p>
            <dl>
              <dt>Installed</dt>
              <dd>{tool.current || 'Unavailable'}</dd>
              <dt>Latest stable</dt>
              <dd>{tool.latest || 'Check for updates'}</dd>
            </dl>
            {tool.note && <p>{tool.note}</p>}
            {errors[tool.id] && <p role="alert">{errors[tool.id]}</p>}
            {tool.canUpdate ? (
              <button
                aria-label={`Update ${tool.name}`}
                className="ui button"
                disabled={locked || tool.updateAvailable !== true}
                onClick={() => update([tool])}
                type="button"
              >
                {busy === tool.id ? 'Installing…' : 'Update tool'}
              </button>
            ) : (
              <span className="tool-bundled">
                Backend image update required
              </span>
            )}
          </article>
        ))}
      </div>
      <p className="tools-footnote">
        Tools are installed automatically on first startup. Docker includes them
        in the image; missing standalone tools are downloaded and verified.
        Updates use verified upstream downloads. yt-dlp, Deno and FFmpeg retain
        their existing automatic-update settings. Bundled bgutil, its plugin and
        Node are updated together through the backend image.
      </p>
    </section>
  );
};

export default Tools;
