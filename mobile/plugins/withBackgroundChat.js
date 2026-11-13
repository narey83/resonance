// First-party Android foreground chat delivery. Native files are copied during prebuild.
const { withAndroidManifest, withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const files = ['BackgroundChatModule.kt', 'BackgroundChatPackage.kt', 'BackgroundChatService.kt'];
const templatePackage = 'com.resonance.mobile';

module.exports = (config) => {
  const androidPackage = config.android?.package || templatePackage;
  const scheme = Array.isArray(config.scheme) ? config.scheme[0] : (config.scheme || 'resonance');
  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const permissions = manifest['uses-permission'] ?? [];
    for (const name of ['android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING']) {
      if (!permissions.some((item) => item.$?.['android:name'] === name)) {
        permissions.push({ $: { 'android:name': name } });
      }
    }
    manifest['uses-permission'] = permissions;
    const application = manifest.application[0];
    application.service = application.service ?? [];
    if (!application.service.some((item) => item.$?.['android:name'] === '.BackgroundChatService')) {
      application.service.push({ $: {
        'android:name': '.BackgroundChatService',
        'android:exported': 'false',
        'android:stopWithTask': 'false',
        'android:foregroundServiceType': 'remoteMessaging',
      } });
    }
    return mod;
  });

  config = withDangerousMod(config, ['android', (mod) => {
    const sourceDir = path.join(mod.modRequest.projectRoot, 'plugins', 'background-chat-native');
    const destDir = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/java', androidPackage.replace(/\./g, '/'));
    fs.mkdirSync(destDir, { recursive: true });
    for (const file of files) {
      const source = fs.readFileSync(path.join(sourceDir, file), 'utf8')
        .replace(`package ${templatePackage}`, `package ${androidPackage}`)
        .replaceAll('resonance://', `${scheme}://`);
      fs.writeFileSync(path.join(destDir, file), source);
    }
    return mod;
  }]);

  config = withMainApplication(config, (mod) => {
    if (!mod.modResults.contents.includes('BackgroundChatPackage()')) {
      mod.modResults.contents = mod.modResults.contents.replace(
        /(PackageList\(this\)\.packages\.apply\s*\{)/,
        '$1\n          add(BackgroundChatPackage())',
      );
    }
    return mod;
  });
  return config;
};
