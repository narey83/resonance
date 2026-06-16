// Dynamic config layered on top of app.json. Selecting the `development` variant
// (via APP_VARIANT=development, set by the dev/preview EAS profiles and local runs)
// gives the build a distinct package name and display name so it installs
// side by side with a production build instead of colliding with it.
const IS_DEV = process.env.APP_VARIANT === 'development';

module.exports = ({ config }) => ({
  ...config,
  name: IS_DEV ? 'Resonance Dev' : 'Resonance',
  // Dev variant gets an orange-ribboned icon so it's distinguishable on the home screen.
  icon: IS_DEV ? './assets/icon-dev.png' : config.icon,
  ios: {
    ...config.ios,
    bundleIdentifier: IS_DEV ? 'com.resonance.mobile.dev' : config.ios.bundleIdentifier,
  },
  android: {
    ...config.android,
    package: IS_DEV ? 'com.resonance.mobile.dev' : config.android.package,
    adaptiveIcon: {
      ...config.android.adaptiveIcon,
      // Same Resonance logo in the foreground, but a solid dev-orange background.
      ...(IS_DEV
        ? {
            backgroundColor: '#FF6D00',
            backgroundImage: './assets/android-icon-background-dev.png',
          }
        : {}),
    },
  },
});
