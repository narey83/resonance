const { withPodfile } = require('@expo/config-plugins');
const installStudio = require('../scripts/install-studio.cjs');
const hook = `
    # Resonance Studio: resolve audio tracks in the existing asynchronous asset load,
    # before the AVPlayer processing tap is attached at item replacement.
    studio_wrapper = File.join(installer.sandbox.root, 'SwiftAudioEx/Sources/SwiftAudioEx/AVPlayerWrapper/AVPlayerWrapper.swift')
    if File.exist?(studio_wrapper)
      File.chmod(0644, studio_wrapper)
      File.write(studio_wrapper, File.read(studio_wrapper).gsub('let playableKeys = ["playable"]', 'let playableKeys = ["playable", "tracks"]'))
    end
`;
module.exports = config => {
  installStudio();
  return withPodfile(config, mod => {
    if (!mod.modResults.contents.includes('studio_wrapper =')) {
      mod.modResults.contents = mod.modResults.contents.replace('post_install do |installer|', 'post_install do |installer|' + hook);
    }
    return mod;
  });
};
