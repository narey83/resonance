const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { localRequire } = require('./helpers.cjs');

test('a cold entrypoint initializes Expo before native-dependent imports and registers playback before main', () => {
  const ts = localRequire('typescript');
  const file = path.join(__dirname, '../index.ts');
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: file,
  });
  let initialized = false;
  const calls = [];
  const App = () => null;
  const playbackService = () => null;
  const requireModule = (name) => {
    if (name === 'expo') {
      initialized = true;
      return { registerRootComponent: (component) => {
        assert.equal(component, App);
        calls.push('main');
      } };
    }
    // SecureStore and other Expo modules need the globals installed by Expo.fx.
    assert.ok(initialized, `${name} imported before the Expo runtime`);
    switch (name) {
      case 'react-native':
        return { AppRegistry: { registerComponent: (component) => calls.push(component) } };
      case 'react-native-track-player':
        return { registerPlaybackService: (factory) => {
          assert.equal(factory(), playbackService);
          calls.push('playback');
        } };
      case './App':
        return { __esModule: true, default: App };
      case './src/services/carPlay':
        return { registerCarPlay: () => calls.push('carplay') };
      case './src/services/playback-service':
        return { __esModule: true, default: playbackService };
      default:
        throw new Error(`Unexpected entrypoint import: ${name}`);
    }
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(requireModule, module, module.exports);
  assert.deepEqual(calls, ['playback', 'ResonanceCarPlayRuntime', 'carplay', 'main']);
});
