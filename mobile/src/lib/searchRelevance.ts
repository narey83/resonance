// ─────────────────────────────────────────────────────────────────────────────
//   SPDX-FileCopyrightText: John Narey
//   SPDX-License-Identifier: AGPL-3.0-or-later
// ─────────────────────────────────────────────────────────────────────────────
//
//   Soulseek matches search terms against the *whole* path (every folder +
//   the filename), as independent words in any order. So "John Narey" also
//   returns any "John …" file that happens to live under a folder named
//   "narey". These helpers let the client float true phrase/filename matches
//   to the top (relevance ranking) and, optionally, hard-filter to results
//   whose *filename* contains every term.

/** Split a raw query into lowercase word tokens, stripping edge punctuation. */
export function parseQueryTerms(query: string): string[] {
  return (query ?? '')
    .split(/\s+/)
    .map(t => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase())
    .filter(Boolean);
}

/** Last path segment (filename) of a Soulseek path, lowercased. */
function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path;
}

/**
 * Relevance score for a single result path against the query terms. Higher is
 * more relevant. Rewards, in order: the full phrase in the filename, the phrase
 * anywhere in the path, terms in the filename, terms anywhere in the path.
 */
export function scoreFilename(terms: string[], path: string): number {
  if (terms.length === 0) return 0;
  const full = path.replace(/\\/g, '/').toLowerCase();
  const base = basename(full);
  const phrase = terms.join(' ');
  let score = 0;
  if (base.includes(phrase)) score += 1000;
  else if (full.includes(phrase)) score += 400;
  for (const t of terms) {
    if (base.includes(t)) score += 100;
    else if (full.includes(t)) score += 10;
  }
  return score;
}

/** True when every query term appears in the filename (not just a parent folder). */
export function basenameHasAllTerms(terms: string[], path: string): boolean {
  if (terms.length === 0) return true;
  const base = basename(path.replace(/\\/g, '/').toLowerCase());
  return terms.every(t => base.includes(t));
}

/** Best (max) filename score across a set of result paths; 0 when empty. */
export function bestScore(terms: string[], paths: Iterable<string>): number {
  let best = 0;
  for (const p of paths) {
    const s = scoreFilename(terms, p);
    if (s > best) best = s;
  }
  return best;
}
