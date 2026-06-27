import './TagEditor.css';
import { useTagEditActivity } from '../../context/TagEditActivityContext';
import { lookup as lookupMetadata } from '../../lib/metadataLookup';
import { guessFromFilename } from '../../lib/tagGuess';
import {
  getIncomplete,
  getTagged,
  getUntagged,
  renameDirectory,
  writeTags,
} from '../../lib/tags';
import PageInfo from '../Shared/PageInfo';
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  FolderEdit,
  Globe,
  Loader,
  Lock,
  Pencil,
  RefreshCw,
  Save,
  SkipForward,
  Sparkles,
  Tag,
  X,
} from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'react-toastify';

const EMPTY_FORM = {
  album: '',
  albumArtist: '',
  artist: '',
  bpm: '',
  comment: '',
  discNumber: '',
  genre: '',
  key: '',
  title: '',
  trackNumber: '',
  year: '',
};

const FOLDER_FORM_EMPTY = {
  album: '',
  albumArtist: '',
  comment: '',
  discNumber: '',
  genre: '',
  year: '',
};

const tagsToForm = (tags) => ({
  album: tags?.album ?? '',
  albumArtist: tags?.albumArtist ?? '',
  artist: tags?.artist ?? '',
  bpm: tags?.bpm ? String(tags.bpm) : '',
  comment: tags?.comment ?? '',
  discNumber: tags?.discNumber ? String(tags.discNumber) : '',
  genre: tags?.genre ?? '',
  key: tags?.key ?? '',
  title: tags?.title ?? '',
  trackNumber: tags?.trackNumber ? String(tags.trackNumber) : '',
  year: tags?.year ? String(tags.year) : '',
});

// Returns existingValue when formValue is blank, otherwise overwrites with formValue
const pickTag = (formValue, existingValue, fallback = null) =>
  formValue === '' ? existingValue ?? fallback : formValue || fallback;

// Mirrors the backend's incomplete predicate (Shares.IsIncomplete): only title and artist
// are mandatory; album/year/genre are optional.
const isIncomplete = (tags) =>
  !tags || !`${tags.title ?? ''}`.trim() || !`${tags.artist ?? ''}`.trim();

const applyFolderForm = (existing, form) => ({
  album: pickTag(form.album, existing.album),
  albumArtist: pickTag(form.albumArtist, existing.albumArtist),
  artist: existing.artist ?? null,
  bpm: existing.bpm ?? 0,
  comment: pickTag(form.comment, existing.comment),
  discNumber:
    form.discNumber === ''
      ? existing.discNumber ?? 0
      : Number.parseInt(form.discNumber, 10),
  genre: pickTag(form.genre, existing.genre),
  key: existing.key ?? null,
  title: existing.title ?? null,
  trackNumber: existing.trackNumber ?? 0,
  year: form.year === '' ? existing.year ?? 0 : Number.parseInt(form.year, 10),
});

const groupByDirectory = (files) => {
  const groups = {};
  for (const file of files) {
    if (!groups[file.directory]) groups[file.directory] = [];
    groups[file.directory].push(file);
  }

  return groups;
};

// Returns the common value for a field across files, or '' if they differ
const commonValue = (files, field) => {
  if (!files?.length) return '';
  const first = files[0]?.tags?.[field];
  const same = files.every(
    (f) => (f.tags?.[field] ?? null) === (first ?? null),
  );
  if (!same) return '';
  if (first == null || first === 0) return '';
  return String(first);
};

const FolderEditorForm = ({ directory, files, onSave, saving }) => {
  const [form, setForm] = useState(FOLDER_FORM_EMPTY);

  useEffect(() => {
    if (!directory) return;
    const folderParts = directory.split('\\');
    const albumGuess = folderParts.at(-1) ?? '';
    setForm({
      album: commonValue(files, 'album') || albumGuess,
      albumArtist: commonValue(files, 'albumArtist'),
      genre: commonValue(files, 'genre'),
      year: commonValue(files, 'year'),
      discNumber: commonValue(files, 'discNumber'),
      comment: commonValue(files, 'comment'),
    });
  }, [directory, files]);

  const handleChange = ({ target }) => {
    const { name, value } = target;
    setForm((previous) => ({ ...previous, [name]: value }));
  };

  const handleSubmit = (submitEvent) => {
    submitEvent.preventDefault();
    if (!Object.values(form).some(Boolean)) return;
    onSave({ directory, form, files });
  };

  if (!directory) {
    return (
      <div className="te-empty">
        <Tag
          size={40}
          strokeWidth={1}
        />
        <p>Select a file to edit its tags</p>
      </div>
    );
  }

  const directoryParts = directory.split('\\');

  return (
    <form
      className="te-form"
      onSubmit={handleSubmit}
    >
      <div className="te-form-path">
        <span className="te-form-dir">{directoryParts.join(' › ')}</span>
        <span className="te-form-sep"> — </span>
        <span className="te-form-file">
          {files.length} file{files.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="te-folder-note">
        Album-level fields only. Track-specific tags (title, artist, key, BPM)
        are preserved per file. Leave a field blank to keep existing values
        unchanged.
      </div>

      <div className="te-sections">
        <div className="te-section">
          <div className="te-section-title">Album</div>
          <div className="te-section-body">
            <div className="te-field">
              <div className="te-field-label">Album</div>
              <input
                autoComplete="off"
                className="te-field-input"
                name="album"
                onChange={handleChange}
                placeholder="Album name"
                type="text"
                value={form.album}
              />
            </div>
            <div className="te-field">
              <div className="te-field-label">Album Artist</div>
              <input
                autoComplete="off"
                className="te-field-input"
                name="albumArtist"
                onChange={handleChange}
                placeholder="e.g. Various Artists"
                type="text"
                value={form.albumArtist}
              />
            </div>
            <div className="te-field">
              <div className="te-field-label">Year</div>
              <input
                autoComplete="off"
                className="te-field-input te-field-input--short"
                max="2099"
                min="1900"
                name="year"
                onChange={handleChange}
                placeholder="2024"
                type="number"
                value={form.year}
              />
            </div>
            <div className="te-field">
              <div className="te-field-label">Disc #</div>
              <input
                autoComplete="off"
                className="te-field-input te-field-input--short"
                min="0"
                name="discNumber"
                onChange={handleChange}
                placeholder="0"
                type="number"
                value={form.discNumber}
              />
            </div>
          </div>
        </div>

        <div className="te-section">
          <div className="te-section-title">Details</div>
          <div className="te-section-body">
            <div className="te-field">
              <div className="te-field-label">Genre</div>
              <input
                autoComplete="off"
                className="te-field-input"
                name="genre"
                onChange={handleChange}
                placeholder="e.g. Electronic"
                type="text"
                value={form.genre}
              />
            </div>
          </div>
        </div>

        <div className="te-section">
          <div className="te-section-title">Notes</div>
          <div className="te-section-body">
            <div className="te-field te-field--full">
              <div className="te-field-label">Comment</div>
              <textarea
                autoComplete="off"
                className="te-field-textarea"
                name="comment"
                onChange={handleChange}
                placeholder="Optional comment"
                rows={3}
                value={form.comment}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="te-form-actions">
        <div className="te-form-actions-right">
          <button
            className={`te-btn te-btn--primary${saving ? ' te-btn--loading' : ''}`}
            disabled={saving || !Object.values(form).some(Boolean)}
            type="submit"
          >
            {saving ? (
              <Loader
                className="te-spin"
                size={14}
              />
            ) : (
              <Save size={14} />
            )}
            Apply to all
          </button>
        </div>
      </div>
    </form>
  );
};

const TagEditorForm = ({ file, mode, onSave, onSkip, saving }) => {
  const [form, setForm] = useState(EMPTY_FORM);
  const [looking, setLooking] = useState(false);
  const titleRef = useRef(null);

  useEffect(() => {
    if (!file) return;
    setForm(file.tags ? tagsToForm(file.tags) : EMPTY_FORM);
    setTimeout(() => titleRef.current?.focus(), 50);
  }, [file]);

  const handleChange = ({ target }) => {
    const { name, value } = target;
    setForm((previous) => ({ ...previous, [name]: value }));
  };

  const handleAutoFill = () => {
    if (!file) return;
    const guessed = guessFromFilename(file.filename, file.directory);
    setForm((previous) => ({
      ...previous,
      album: previous.album || guessed.album,
      artist: previous.artist || guessed.artist,
      title: previous.title || guessed.title,
    }));
  };

  const handleLookup = async () => {
    if (!file || looking) return;
    setLooking(true);
    try {
      const matches = await lookupMetadata({
        maskedFilename: file.maskedFilename,
      });
      const match = matches?.[0];
      if (!match) {
        toast.info('No online match found for this track.');
        return;
      }

      setForm((previous) => ({
        ...previous,
        album: match.album || previous.album,
        albumArtist: match.albumArtist || previous.albumArtist,
        artist: match.artist || previous.artist,
        discNumber: match.discNumber
          ? String(match.discNumber)
          : previous.discNumber,
        genre: match.genre || previous.genre,
        title: match.title || previous.title,
        trackNumber: match.trackNumber
          ? String(match.trackNumber)
          : previous.trackNumber,
        year: match.year ? String(match.year) : previous.year,
      }));
      toast.success('Filled from MusicBrainz — review, then save.');
    } catch {
      toast.error('Online lookup failed.');
    } finally {
      setLooking(false);
    }
  };

  const handleSubmit = (submitEvent) => {
    submitEvent.preventDefault();
    if (!Object.values(form).some(Boolean)) return;
    onSave({
      maskedFilename: file.maskedFilename,
      tags: {
        album: form.album || null,
        albumArtist: form.albumArtist || null,
        artist: form.artist || null,
        bpm: form.bpm ? Number.parseInt(form.bpm, 10) : 0,
        comment: form.comment || null,
        discNumber: form.discNumber ? Number.parseInt(form.discNumber, 10) : 0,
        genre: form.genre || null,
        key: form.key || null,
        title: form.title || null,
        trackNumber: form.trackNumber
          ? Number.parseInt(form.trackNumber, 10)
          : 0,
        year: form.year ? Number.parseInt(form.year, 10) : 0,
      },
    });
  };

  if (!file) {
    return (
      <div className="te-empty">
        <Tag
          size={40}
          strokeWidth={1}
        />
        <p>Select a file to edit its tags</p>
      </div>
    );
  }

  const directoryParts = file.directory.split('\\');

  return (
    <form
      className="te-form"
      onSubmit={handleSubmit}
    >
      <div className="te-form-path">
        <span className="te-form-dir">{directoryParts.join(' › ')}</span>
        <span className="te-form-sep"> / </span>
        <span className="te-form-file">
          {file.filename.replace(/\.[^.]+$/u, '')}
        </span>
        <span className="te-form-ext">.{file.extension}</span>
      </div>

      <div className="te-sections">
        <div className="te-section">
          <div className="te-section-title">Track</div>
          <div className="te-section-body">
            <div className="te-field">
              <div className="te-field-label">Title</div>
              <input
                autoComplete="off"
                className="te-field-input"
                name="title"
                onChange={handleChange}
                placeholder="Track title"
                ref={titleRef}
                type="text"
                value={form.title}
              />
            </div>
            <div className="te-field">
              <div className="te-field-label">Artist</div>
              <input
                autoComplete="off"
                className="te-field-input"
                name="artist"
                onChange={handleChange}
                placeholder="Track artist"
                type="text"
                value={form.artist}
              />
            </div>
          </div>
        </div>

        <div className="te-section">
          <div className="te-section-title">Album</div>
          <div className="te-section-body">
            <div className="te-field">
              <div className="te-field-label">Album</div>
              <input
                autoComplete="off"
                className="te-field-input"
                name="album"
                onChange={handleChange}
                placeholder="Album name"
                type="text"
                value={form.album}
              />
            </div>
            <div className="te-field">
              <div className="te-field-label">Album Artist</div>
              <input
                autoComplete="off"
                className="te-field-input"
                name="albumArtist"
                onChange={handleChange}
                placeholder="e.g. Various Artists"
                type="text"
                value={form.albumArtist}
              />
            </div>
            <div className="te-field">
              <div className="te-field-label">Track #</div>
              <input
                autoComplete="off"
                className="te-field-input te-field-input--short"
                min="0"
                name="trackNumber"
                onChange={handleChange}
                placeholder="0"
                type="number"
                value={form.trackNumber}
              />
            </div>
            <div className="te-field">
              <div className="te-field-label">Year</div>
              <input
                autoComplete="off"
                className="te-field-input te-field-input--short"
                max="2099"
                min="1900"
                name="year"
                onChange={handleChange}
                placeholder="2024"
                type="number"
                value={form.year}
              />
            </div>
            <div className="te-field">
              <div className="te-field-label">Disc #</div>
              <input
                autoComplete="off"
                className="te-field-input te-field-input--short"
                min="0"
                name="discNumber"
                onChange={handleChange}
                placeholder="0"
                type="number"
                value={form.discNumber}
              />
            </div>
          </div>
        </div>

        <div className="te-section">
          <div className="te-section-title">Details</div>
          <div className="te-section-body">
            <div className="te-field">
              <div className="te-field-label">Genre</div>
              <input
                autoComplete="off"
                className="te-field-input"
                name="genre"
                onChange={handleChange}
                placeholder="e.g. Electronic"
                type="text"
                value={form.genre}
              />
            </div>
            <div className="te-field">
              <div className="te-field-label">Key</div>
              <input
                autoComplete="off"
                className="te-field-input te-field-input--short"
                name="key"
                onChange={handleChange}
                placeholder="e.g. 8A"
                type="text"
                value={form.key}
              />
            </div>
            <div className="te-field">
              <div className="te-field-label">BPM</div>
              <input
                autoComplete="off"
                className="te-field-input te-field-input--short"
                min="0"
                name="bpm"
                onChange={handleChange}
                placeholder="0"
                type="number"
                value={form.bpm}
              />
            </div>
          </div>
        </div>

        <div className="te-section">
          <div className="te-section-title">Notes</div>
          <div className="te-section-body">
            <div className="te-field te-field--full">
              <div className="te-field-label">Comment</div>
              <textarea
                autoComplete="off"
                className="te-field-textarea"
                name="comment"
                onChange={handleChange}
                placeholder="Optional comment"
                rows={3}
                value={form.comment}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="te-form-actions">
        <button
          className="te-btn te-btn--ghost"
          onClick={handleAutoFill}
          title="Guess tags from filename and folder structure"
          type="button"
        >
          <Sparkles size={14} />
          Auto-fill
        </button>
        <button
          className="te-btn te-btn--ghost"
          disabled={looking}
          onClick={handleLookup}
          title="Look up track details online (MusicBrainz)"
          type="button"
        >
          {looking ? (
            <Loader
              className="te-spin"
              size={14}
            />
          ) : (
            <Globe size={14} />
          )}
          Look up online
        </button>

        <div className="te-form-actions-right">
          <button
            className="te-btn te-btn--ghost"
            onClick={onSkip}
            type="button"
          >
            <SkipForward size={14} />
            Skip
          </button>
          <button
            className={`te-btn te-btn--primary${saving ? ' te-btn--loading' : ''}`}
            disabled={saving || !Object.values(form).some(Boolean)}
            type="submit"
          >
            {saving ? (
              <Loader
                className="te-spin"
                size={14}
              />
            ) : (
              <Save size={14} />
            )}
            {mode === 'tagged' ? 'Update' : 'Save'}
          </button>
        </div>
      </div>
    </form>
  );
};

const TagEditor = () => {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('untagged');
  const [selected, setSelected] = useState(null);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState(null);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState({});
  const { clearJob, jobs, startFolderAutoFill } = useTagEditActivity();
  const [renamingDirectory, setRenamingDirectory] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const renameInputRef = useRef(null);
  const [sidebarWidth, setSidebarWidth] = useState(500);
  const dragging = useRef(false);
  const dragStart = useRef(0);
  const widthAtDragStart = useRef(380);

  const onDividerMouseDown = (mouseEvent) => {
    dragging.current = true;
    dragStart.current = mouseEvent.clientX;
    widthAtDragStart.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const onMouseMove = (moveEvent) => {
      if (!dragging.current) return;
      const delta = moveEvent.clientX - dragStart.current;
      setSidebarWidth(
        Math.max(200, Math.min(900, widthAtDragStart.current + delta)),
      );
    };

    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const data =
        mode === 'tagged'
          ? await getTagged()
          : mode === 'incomplete'
            ? await getIncomplete()
            : await getUntagged();
      setFiles(data);
      setCollapsed({});
      setSelected(null);
      setSelectedFolder(null);
    } catch (error) {
      setErrorMessage(
        error?.response?.data || error?.message || 'Failed to load files',
      );
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const filtered = useMemo(() => {
    if (!search.trim()) return files;
    const query = search.toLowerCase();
    return files.filter(
      (f) =>
        f.filename.toLowerCase().includes(query) ||
        f.directory.toLowerCase().includes(query),
    );
  }, [files, search]);

  const groups = useMemo(() => groupByDirectory(filtered), [filtered]);
  const directories = useMemo(() => Object.keys(groups).sort(), [groups]);

  const toggleDirectory = (directory) =>
    setCollapsed((previous) => ({
      ...previous,
      [directory]: previous[directory] === false,
    }));

  const handleSelectFolder = (directory) => {
    setSelected(null);
    setSelectedFolder(directory);
  };

  const handleSave = async ({ maskedFilename, tags }) => {
    setSaving(true);
    setErrorMessage(null);
    try {
      await writeTags({ maskedFilename, tags });
      setSavedCount((count) => count + 1);
      // Drop the file from the list once it no longer belongs there: always in untagged
      // mode, and in incomplete mode once the edit has filled every core field.
      const removeFromList =
        mode === 'untagged' || (mode === 'incomplete' && !isIncomplete(tags));
      if (removeFromList) {
        const remaining = files.filter(
          (f) => f.maskedFilename !== maskedFilename,
        );
        setFiles(remaining);
        const index = files.findIndex(
          (f) => f.maskedFilename === maskedFilename,
        );
        setSelected(remaining[index] ?? remaining[index - 1] ?? null);
      } else {
        const index = files.findIndex(
          (f) => f.maskedFilename === maskedFilename,
        );
        // Update the file's tags in place
        setFiles((previous) =>
          previous.map((f) =>
            f.maskedFilename === maskedFilename ? { ...f, tags } : f,
          ),
        );
        setSelected(files[index + 1] ?? files[0] ?? null);
      }
    } catch (error) {
      setErrorMessage(
        error?.response?.data || error?.message || 'Failed to save tags',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleFolderSave = async ({ files: folderFiles, form }) => {
    setSaving(true);
    setErrorMessage(null);

    let savedAny = false;
    const errors = [];

    for (const file of folderFiles) {
      try {
        await writeTags({
          maskedFilename: file.maskedFilename,
          tags: applyFolderForm(file.tags ?? {}, form),
        });
        savedAny = true;
      } catch {
        errors.push(file.filename);
      }
    }

    if (savedAny) {
      const successMasks = new Set(
        folderFiles
          .filter((f) => !errors.includes(f.filename))
          .map((f) => f.maskedFilename),
      );

      if (mode === 'untagged') {
        setFiles((previous) =>
          previous.filter((f) => !successMasks.has(f.maskedFilename)),
        );
        setSelectedFolder(null);
      } else {
        setFiles((previous) =>
          previous.map((f) =>
            successMasks.has(f.maskedFilename)
              ? { ...f, tags: applyFolderForm(f.tags ?? {}, form) }
              : f,
          ),
        );
      }

      setSavedCount((count) => count + successMasks.size);
    }

    if (errors.length > 0) {
      setErrorMessage(
        `Apply failed for ${errors.length} file${errors.length === 1 ? '' : 's'}`,
      );
    }

    setSaving(false);
  };

  const handleSkip = () => {
    if (!selected) return;
    const index = files.findIndex(
      (f) => f.maskedFilename === selected.maskedFilename,
    );
    const next = files[index + 1] ?? files[0] ?? null;
    setSelected(next);
  };

  const handleFolderAutoFill = (directory) => {
    const directoryFiles = groups[directory];
    if (!directoryFiles?.length) return;
    setErrorMessage(null);
    // Runs in TagEditActivityContext so it survives navigation / tab switches.
    startFolderAutoFill(directory, directoryFiles);
  };

  // Reconcile finished background jobs into the local list (whether the job
  // started here or completed while we were on another page).
  useEffect(() => {
    for (const [directory, job] of Object.entries(jobs)) {
      if (job.status !== 'done') continue;

      const savedMasks = new Set(job.savedMasks);
      if (savedMasks.size > 0) {
        setSavedCount((count) => count + savedMasks.size);
        setFiles((previous) => {
          const remaining = previous.filter(
            (f) => !savedMasks.has(f.maskedFilename),
          );
          setSelected((sel) =>
            sel && savedMasks.has(sel.maskedFilename)
              ? remaining[0] ?? null
              : sel,
          );
          return remaining;
        });
      }

      if (job.errors.length > 0) {
        setErrorMessage(
          `Auto-fill failed for ${job.errors.length} file${job.errors.length === 1 ? '' : 's'}`,
        );
      }

      clearJob(directory);
    }
  }, [clearJob, jobs]);

  const startRename = (directory, currentLeafName, clickEvent) => {
    clickEvent.stopPropagation();
    setRenamingDirectory(directory);
    setRenameValue(currentLeafName);
    setRenameError(null);
    setTimeout(() => renameInputRef.current?.select(), 30);
  };

  const cancelRename = (clickEvent) => {
    clickEvent?.stopPropagation();
    setRenamingDirectory(null);
    setRenameError(null);
  };

  const commitRename = async (directory, clickEvent) => {
    clickEvent?.stopPropagation();
    const newName = renameValue.trim();
    if (!newName) {
      cancelRename();
      return;
    }

    const leafName = directory.split('\\').at(-1);
    if (newName === leafName) {
      cancelRename();
      return;
    }

    setRenaming(true);
    setRenameError(null);
    try {
      await renameDirectory({ maskedDirectory: directory, newName });
      setRenamingDirectory(null);
      await loadFiles();
    } catch (error) {
      const message =
        error?.response?.data || error?.message || 'Rename failed';
      setRenameError({ directory, message });
    } finally {
      setRenaming(false);
    }
  };

  const handleModeChange = (newMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    setSearch('');
    setSavedCount(0);
    setErrorMessage(null);
  };

  const mainPanel = (() => {
    if (selectedFolder) {
      const folderFiles = groups[selectedFolder] ?? [];
      return (
        <FolderEditorForm
          directory={selectedFolder}
          files={folderFiles}
          onSave={handleFolderSave}
          saving={saving}
        />
      );
    }

    return (
      <TagEditorForm
        file={selected}
        mode={mode}
        onSave={handleSave}
        onSkip={handleSkip}
        saving={saving}
      />
    );
  })();

  return (
    <div className="te-shell">
      <PageInfo storageKey="tageditor">
        <p>
          Edit track metadata and write it back to the file on disk. Select a
          track from the left panel to load it into the editor.
        </p>
        <ul>
          <li>
            <strong>Save</strong> — writes the current form values to the file
            and moves to the next track.
          </li>
          <li>
            <strong>Skip</strong> — moves to the next track without saving any
            changes.
          </li>
          <li>
            <strong>Auto-fill</strong> — guesses title and artist from the
            filename when the existing tags are blank.
          </li>
          <li>
            <strong>Click a folder name</strong> — opens an album-level editor
            that applies blanket changes to all files in the folder.
          </li>
          <li>
            <strong>Rename folder</strong> — use the pencil icon on a folder
            header to rename the filesystem directory. Disabled while uploads
            are active.
          </li>
        </ul>
        <p>
          Switch between <strong>Untagged</strong> (files with no metadata at
          all), <strong>Incomplete</strong> (tagged files missing a title or
          artist) and <strong>Tagged</strong> (all files) using the toggle at
          the top of the list. Running <strong>Tag Sanitization</strong> first
          is recommended to ensure the tags you edit are written cleanly as
          ID3v2.3.
        </p>
      </PageInfo>
      <div className="te-root">
        <div
          className="te-sidebar"
          style={{
            width: sidebarWidth,
            minWidth: sidebarWidth,
            maxWidth: sidebarWidth,
          }}
        >
          <div className="te-sidebar-header">
            <div className="te-sidebar-title">
              <div className="te-mode-toggle">
                <button
                  className={`te-mode-btn${mode === 'untagged' ? ' te-mode-btn--active' : ''}`}
                  onClick={() => handleModeChange('untagged')}
                  type="button"
                >
                  Untagged
                </button>
                <button
                  className={`te-mode-btn${mode === 'incomplete' ? ' te-mode-btn--active' : ''}`}
                  onClick={() => handleModeChange('incomplete')}
                  type="button"
                >
                  Incomplete
                </button>
                <button
                  className={`te-mode-btn${mode === 'tagged' ? ' te-mode-btn--active' : ''}`}
                  onClick={() => handleModeChange('tagged')}
                  type="button"
                >
                  Tagged
                </button>
              </div>
              {!loading && <span className="te-badge">{files.length}</span>}
            </div>
            <div className="te-sidebar-controls">
              <input
                className="te-search"
                onChange={({ target }) => setSearch(target.value)}
                placeholder="Filter…"
                type="text"
                value={search}
              />
              <button
                className="te-icon-btn"
                disabled={loading}
                onClick={loadFiles}
                title="Refresh"
                type="button"
              >
                <RefreshCw
                  className={loading ? 'te-spin' : ''}
                  size={14}
                />
              </button>
            </div>
          </div>

          {savedCount > 0 && (
            <div className="te-saved-notice">
              <CheckCircle size={13} />
              {savedCount} file{savedCount === 1 ? '' : 's'}{' '}
              {mode === 'untagged' ? 'tagged' : 'updated'} this session
            </div>
          )}

          {errorMessage && (
            <div className="te-error-notice">
              <AlertCircle size={13} />
              {errorMessage}
            </div>
          )}

          <div className="te-list">
            {loading && (
              <div className="te-list-loading">
                <Loader
                  className="te-spin"
                  size={18}
                />
              </div>
            )}

            {!loading && files.length === 0 && (
              <div className="te-list-empty">
                <CheckCircle
                  size={28}
                  strokeWidth={1}
                />
                <p>
                  {mode === 'tagged'
                    ? 'No tagged files found.'
                    : mode === 'incomplete'
                      ? 'No incomplete files — every track has full tags!'
                      : 'All files are tagged!'}
                </p>
              </div>
            )}

            {!loading &&
              directories.map((directory) => {
                const isOpen = collapsed[directory] === false;
                const items = groups[directory];
                const directoryParts = directory.split('\\');
                const leafName = directoryParts.at(-1) ?? directory;
                const directoryLabel =
                  directoryParts.slice(1).join(' › ') || directory;
                const job = jobs[directory];
                const isAutoFilling = job?.status === 'running';
                const isRenaming = renamingDirectory === directory;
                const isSelected = selectedFolder === directory;
                const thisRenameError =
                  renameError?.directory === directory
                    ? renameError.message
                    : null;

                return (
                  <div
                    className="te-group"
                    key={directory}
                  >
                    <div
                      className={`te-group-header${isSelected ? ' te-group-header--selected' : ''}`}
                    >
                      <button
                        className="te-group-chevron"
                        onClick={() => toggleDirectory(directory)}
                        title={isOpen ? 'Collapse' : 'Expand'}
                        type="button"
                      >
                        {isOpen ? (
                          <ChevronDown size={13} />
                        ) : (
                          <ChevronRight size={13} />
                        )}
                      </button>

                      {isRenaming ? (
                        <div className="te-rename-row">
                          <input
                            className="te-rename-input"
                            disabled={renaming}
                            onChange={(changeEvent) =>
                              setRenameValue(changeEvent.target.value)
                            }
                            onClick={(clickEvent) =>
                              clickEvent.stopPropagation()
                            }
                            onKeyDown={(keyEvent) => {
                              if (keyEvent.key === 'Enter')
                                commitRename(directory, keyEvent);
                              if (keyEvent.key === 'Escape')
                                cancelRename(keyEvent);
                            }}
                            ref={renameInputRef}
                            type="text"
                            value={renameValue}
                          />
                          {renaming ? (
                            <Loader
                              className="te-spin te-rename-spinner"
                              size={12}
                            />
                          ) : (
                            <>
                              <button
                                className="te-rename-confirm"
                                onClick={(clickEvent) =>
                                  commitRename(directory, clickEvent)
                                }
                                title="Confirm rename"
                                type="button"
                              >
                                <Save size={12} />
                              </button>
                              <button
                                className="te-rename-cancel"
                                onClick={cancelRename}
                                title="Cancel"
                                type="button"
                              >
                                <X size={12} />
                              </button>
                            </>
                          )}
                        </div>
                      ) : (
                        <button
                          className="te-group-name-btn"
                          onClick={() => handleSelectFolder(directory)}
                          title={`Edit all files in ${directory}`}
                          type="button"
                        >
                          <FolderEdit
                            className="te-group-folder-icon"
                            size={11}
                          />
                          <span
                            className="te-group-name"
                            title={directory}
                          >
                            {directoryLabel}
                          </span>
                        </button>
                      )}

                      <span className="te-group-count">{items.length}</span>

                      {!isRenaming && (
                        <>
                          {mode === 'untagged' && (
                            <button
                              className="te-group-autofill"
                              disabled={isAutoFilling}
                              onClick={(clickEvent) => {
                                clickEvent.stopPropagation();
                                handleFolderAutoFill(directory);
                              }}
                              title="Auto-fill all files in this folder"
                              type="button"
                            >
                              {isAutoFilling ? (
                                <Loader
                                  className="te-spin"
                                  size={11}
                                />
                              ) : (
                                <Sparkles size={11} />
                              )}
                            </button>
                          )}
                          {isAutoFilling && (
                            <span className="te-group-progress">
                              {job.done}/{job.total}
                            </span>
                          )}
                          <button
                            className="te-group-rename"
                            onClick={(clickEvent) =>
                              startRename(directory, leafName, clickEvent)
                            }
                            title="Rename folder"
                            type="button"
                          >
                            <Pencil size={11} />
                          </button>
                        </>
                      )}
                    </div>

                    {thisRenameError && (
                      <div className="te-rename-error">
                        <Lock size={11} />
                        {thisRenameError}
                      </div>
                    )}

                    {isOpen &&
                      items.map((f) => (
                        <button
                          className={`te-item${selected?.maskedFilename === f.maskedFilename ? ' te-item--active' : ''}`}
                          key={f.maskedFilename}
                          onClick={() => {
                            setSelected(f);
                            setSelectedFolder(null);
                          }}
                          title={f.filename}
                          type="button"
                        >
                          {f.filename}
                        </button>
                      ))}
                  </div>
                );
              })}
          </div>
        </div>

        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className="te-divider"
          onMouseDown={onDividerMouseDown}
          role="separator"
        />

        <div className="te-main">{mainPanel}</div>
      </div>
    </div>
  );
};

export default TagEditor;
