const { withInfoPlist, withEntitlementsPlist, withPodfile, withAppDelegate } = require('@expo/config-plugins');
module.exports = config => {
  config = withEntitlementsPlist(config, mod => {
    mod.modResults['com.apple.developer.carplay-audio'] = true;
    return mod;
  });
  config = withInfoPlist(config, mod => {
    const manifest = mod.modResults.UIApplicationSceneManifest ?? {};
    manifest.UIApplicationSupportsMultipleScenes = true;
    manifest.UISceneConfigurations = manifest.UISceneConfigurations ?? {};
    manifest.UISceneConfigurations.CPTemplateApplicationSceneSessionRoleApplication = [{
      UISceneClassName: 'CPTemplateApplicationScene',
      UISceneConfigurationName: 'Resonance CarPlay',
      UISceneDelegateClassName: 'ResonanceCarPlaySceneDelegate',
    }];
    mod.modResults.UIApplicationSceneManifest = manifest;
    mod.modResults.UIBackgroundModes = [...new Set([...(mod.modResults.UIBackgroundModes ?? []), 'audio'])];
    return mod;
  });
  config = withPodfile(config, mod => {
    if (!mod.modResults.contents.includes("pod 'ResonanceCarPlay'")) {
      mod.modResults.contents = mod.modResults.contents.replace('use_expo_modules!', "use_expo_modules!\n  pod 'ResonanceCarPlay', :path => '../carplay-native'");
    }
    return mod;
  });
  config = withAppDelegate(config, mod => {
    if (!mod.modResults.contents.includes('func startCarPlayRuntime()')) {
      mod.modResults.contents = mod.modResults.contents.replace('  // Linking API', `  private var carPlayRuntimeView: UIView?

  @objc func startCarPlayRuntime() {
    guard carPlayRuntimeView == nil, let factory = reactNativeFactory else { return }
    carPlayRuntimeView = factory.rootViewFactory.view(withModuleName: "ResonanceCarPlayRuntime", initialProperties: nil, launchOptions: nil)
  }

  // Linking API`);
    }
    return mod;
  });
  return config;
};
