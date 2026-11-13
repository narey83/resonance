// Keep app.json as the production config. Set APP_VARIANT=development when
// building or serving the separately installed Expo development client.
module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== 'development') return config;

  return {
    ...config,
    name: 'Resonance Dev',
    slug: 'resonance-mobile-dev',
    scheme: 'resonance-dev',
    ios: { ...config.ios, bundleIdentifier: 'com.resonance.mobile.dev' },
    android: { ...config.android, package: 'com.resonance.mobile.dev' },
  };
};
