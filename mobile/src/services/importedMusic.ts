import { Directory, File, Paths } from 'expo-file-system';

const AUDIO = /\.(mp3|flac|wav|m4a|aac|aif|aiff|ogg|opus|alac)$/i;
export const importedMusicDirectory = () => new Directory(Paths.document, 'resonance-local-music');
export function importedMusicFiles(): File[] {
  const directory = importedMusicDirectory();
  directory.create({ intermediates: true, idempotent: true });
  return directory.list().filter((entry): entry is File => entry instanceof File && AUDIO.test(entry.name));
}
export async function importAudioFiles(): Promise<number> {
  const picked = await File.pickFileAsync({ multipleFiles: true, mimeTypes: ['audio/*', 'application/ogg'] });
  if (picked.canceled) return 0;
  const directory = importedMusicDirectory(); directory.create({ intermediates: true, idempotent: true });
  let count = 0;
  for (const source of picked.result) {
    if (!AUDIO.test(source.name)) continue;
    // Copy into app storage: Files-provider grants and iOS temporary picker URLs do not
    // survive a restart. Keep the user's original file untouched, including on Android.
    let target = new File(directory, source.name);
    let suffix = 2;
    const dot = source.name.lastIndexOf('.');
    while (target.exists) target = new File(directory, `${source.name.slice(0, dot)} (${suffix++})${source.name.slice(dot)}`);
    try { source.copy(target); count++; }
    catch (error) {
      if (target.exists) target.delete();
      throw new Error(`Imported ${count} files, but could not copy ${source.name}: ${(error as Error).message}`);
    }
  }
  return count;
}
