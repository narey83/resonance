// Copies the shared DSP and native adapters into TrackPlayer's existing native targets.
// Run after patch-package and from Expo prebuild; no extra playback service is created.
const fs = require('node:fs');
const path = require('node:path');
function installStudio(root = path.resolve(__dirname, '..')) {
  const target = path.dirname(require.resolve('react-native-track-player/package.json', { paths: [root] }));
  const source = path.join(root, 'studio-native');
  for (const name of ['StudioDSP.h', 'ResonanceStudio.mm']) {
    fs.copyFileSync(path.join(source, name), path.join(target, 'ios', name));
  }
  const kotlin = path.join(target, 'android/src/main/java/com/doublesymmetry/trackplayer/studio');
  const cpp = path.join(target, 'android/src/main/cpp/studio');
  fs.mkdirSync(kotlin, { recursive: true }); fs.mkdirSync(cpp, { recursive: true });
  for (const name of ['StudioModule.kt', 'StudioProcessor.kt', 'StudioRendererFactory.kt']) fs.copyFileSync(path.join(source, name), path.join(kotlin, name));
  for (const name of ['StudioDSP.h', 'StudioJNI.cpp', 'CMakeLists.txt']) fs.copyFileSync(path.join(source, name), path.join(cpp, name));
}
module.exports = installStudio;
if (require.main === module) installStudio();
