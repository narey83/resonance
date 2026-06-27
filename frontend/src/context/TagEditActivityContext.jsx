import { guessFromFilename } from '../lib/tagGuess';
import { writeTags } from '../lib/tags';
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

const TagEditActivityContext = createContext(null);

// Holds folder auto-fill ("magic edit") jobs at app level so they survive
// navigation away from the Tag Editor and remain visible on return.
// jobs shape: { [directory]: { status, total, done, errors: string[], savedMasks: string[] } }
export const TagEditActivityProvider = ({ children }) => {
  const [jobs, setJobs] = useState({});
  const runningRef = useRef(new Set());

  const startFolderAutoFill = useCallback(async (directory, files) => {
    if (!directory || !files?.length) return;
    if (runningRef.current.has(directory)) return;
    runningRef.current.add(directory);

    setJobs((previous) => ({
      ...previous,
      [directory]: {
        status: 'running',
        total: files.length,
        done: 0,
        errors: [],
        savedMasks: [],
      },
    }));

    const errors = [];
    const savedMasks = [];

    for (const file of files) {
      const guessed = guessFromFilename(file.filename, file.directory);
      try {
        await writeTags({
          maskedFilename: file.maskedFilename,
          tags: {
            album: guessed.album || null,
            albumArtist: null,
            artist: guessed.artist || null,
            title: guessed.title || null,
            trackNumber: 0,
            year: 0,
          },
        });
        savedMasks.push(file.maskedFilename);
      } catch {
        errors.push(file.filename);
      }

      setJobs((previous) => {
        const job = previous[directory];
        if (!job) return previous;
        return { ...previous, [directory]: { ...job, done: job.done + 1 } };
      });
    }

    runningRef.current.delete(directory);
    setJobs((previous) => {
      const job = previous[directory];
      if (!job) return previous;
      return {
        ...previous,
        [directory]: { ...job, status: 'done', errors, savedMasks },
      };
    });
  }, []);

  // Called by the Tag Editor once it has reconciled a finished job into its list.
  const clearJob = useCallback((directory) => {
    setJobs((previous) => {
      if (!(directory in previous)) return previous;
      const next = { ...previous };
      delete next[directory];
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ jobs, startFolderAutoFill, clearJob }),
    [clearJob, jobs, startFolderAutoFill],
  );

  return (
    <TagEditActivityContext.Provider value={value}>
      {children}
    </TagEditActivityContext.Provider>
  );
};

export const useTagEditActivity = () => useContext(TagEditActivityContext);
