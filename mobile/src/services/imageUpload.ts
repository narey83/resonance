import { File } from 'expo-file-system';

// Resize before FormData is constructed: changing an Image view's display size does
// not change the uploaded file. Never fall back to uploading the original photo.
export async function prepareImageUpload(uri: string, maxSize = 1024): Promise<{ uri: string; dispose(): void }> {
  let manipulator: typeof import('expo-image-manipulator');
  try { manipulator = await import('expo-image-manipulator'); }
  catch { throw new Error('Photo uploads need the updated app build with image resizing support.'); }
  const context = manipulator.ImageManipulator.manipulate(uri);
  try {
    let image = await context.renderAsync();
    if (Math.max(image.width, image.height) > maxSize) {
      context.resize(image.width >= image.height ? { width: maxSize } : { height: maxSize });
      image = await context.renderAsync();
    }
    const saved = await image.saveAsync({ format: manipulator.SaveFormat.JPEG, compress: .78 });
    return { uri: saved.uri, dispose: () => {
      try { const file = new File(saved.uri); if (file.exists) file.delete(); } catch { /* Cache cleanup is best effort. */ }
    } };
  } finally { context.release(); }
}
