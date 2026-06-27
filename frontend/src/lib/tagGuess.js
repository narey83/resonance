const MIX_PATTERN =
  /\s(Original\sMix|Extended\sMix|Extended\sVersion|Club\sMix|Radio\sEdit|Radio\sMix|VIP\sMix|Dub\sMix|Album\sVersion|Single\sVersion|Instrumental)$/iu;

const normalizeMixType = (title) => {
  if (title.endsWith(')')) return title;
  const match = title.match(MIX_PATTERN);
  if (!match) return title;
  return `${title.slice(0, -match[0].length)} (${match[1]})`;
};

export const guessFromFilename = (filename, directory) => {
  const base = filename.replace(/\.[^.]+$/u, '');
  const directoryParts = directory ? directory.split('\\') : [];
  const albumGuess = directoryParts.at(-1) ?? '';
  const artistGuess = directoryParts.at(-2) ?? '';

  let title = base;
  let artist = artistGuess;

  // eslint-disable-next-line regexp/no-super-linear-backtracking
  const numbered = base.match(/^(\d+)[\s._-]+(.+)$/u);
  if (numbered) title = numbered[2].trim();

  if (title.includes(' - ')) {
    const [firstPart, ...rest] = title.split(' - ');
    artist = firstPart.trim();
    title = rest.join(' - ').trim();
  }

  return { album: albumGuess, artist, title: normalizeMixType(title) };
};
