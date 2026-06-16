// Scores how well `query` matches `target`. Returns 0 for no match.
// Exact substring match scores highest; fuzzy character sequence scores lower.
export const fuzzyScore = (query, target) => {
  if (!query) return 1;

  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  if (targetLower.includes(queryLower)) {
    return 1_000 + (queryLower.length / (targetLower.length || 1)) * 500;
  }

  let queryIndex = 0;
  let run = 0;
  let score = 0;

  for (
    let textIndex = 0;
    textIndex < targetLower.length && queryIndex < queryLower.length;
    textIndex++
  ) {
    if (targetLower[textIndex] === queryLower[queryIndex]) {
      queryIndex++;
      run++;
      score += run * 2;
    } else {
      run = 0;
    }
  }

  return queryIndex === queryLower.length ? score : 0;
};

// Filters `items` by fuzzy match against `getString(item)`, sorted best-first.
export const fuzzyFilter = (query, items, getString) => {
  if (!query) return items;

  return items
    .map((item) => ({ item, score: fuzzyScore(query, getString(item)) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
};

// Returns an array of { text, matched } segments for highlighting matched chars.
export const highlightMatch = (query, text) => {
  if (!query) return [{ matched: false, text }];

  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();

  const matched = Array.from({ length: text.length }, () => false);

  if (textLower.includes(queryLower)) {
    const startIndex = textLower.indexOf(queryLower);

    for (
      let charIndex = startIndex;
      charIndex < startIndex + queryLower.length;
      charIndex++
    ) {
      matched[charIndex] = true;
    }
  } else {
    let queryCharIndex = 0;

    for (
      let textCharIndex = 0;
      textCharIndex < textLower.length && queryCharIndex < queryLower.length;
      textCharIndex++
    ) {
      if (textLower[textCharIndex] === queryLower[queryCharIndex]) {
        matched[textCharIndex] = true;
        queryCharIndex++;
      }
    }
  }

  const segments = [];
  let position = 0;

  while (position < text.length) {
    const isMatch = matched[position];
    let end = position;

    while (end < text.length && matched[end] === isMatch) {
      end++;
    }

    segments.push({ matched: isMatch, text: text.slice(position, end) });
    position = end;
  }

  return segments;
};
