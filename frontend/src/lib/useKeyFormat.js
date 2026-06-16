import { toCamelot } from './camelot';
import * as prefs from './prefs';
import { useState } from 'react';

const KEY = 'keyFormat';

export const useKeyFormat = () => {
  const [format, setFormatRaw] = useState(() => prefs.get(KEY, 'camelot'));

  const setFormat = (newFormat) => {
    prefs.set(KEY, newFormat);
    setFormatRaw(newFormat);
  };

  const fmtKey = (standardKey) => {
    if (!standardKey) return null;
    if (format === 'camelot') return toCamelot(standardKey) ?? standardKey;
    return standardKey;
  };

  return { fmtKey, format, setFormat };
};
