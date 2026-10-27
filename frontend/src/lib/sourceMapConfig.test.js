const { webpack } = require('../../craco.config');
// eslint-disable-next-line import/no-extraneous-dependencies, n/no-extraneous-require -- Exercise the loader already bundled by react-scripts.
const sourceMapLoader = require('source-map-loader');

const configuredRule = (options = {}) => {
  const rule = { loader: '/deps/source-map-loader/dist/cjs.js', options };
  webpack.configure({ module: { rules: [{ oneOf: [rule] }] } });
  return rule;
};

const runLoader = (rule, resourcePath, input, emitWarning) =>
  new Promise((resolve, reject) => {
    const complete = (error, result) => {
      if (error) reject(error);
      else resolve(result);
    };

    sourceMapLoader.call(
      {
        resourcePath,
        getOptions: () => rule.options,
        emitWarning,
        async: () => complete,
      },
      input,
    );
  });

describe('SoundTouch dependency source maps', () => {
  it.each([
    '/app/node_modules/@soundtouchjs/core/.dist/SoundTouch.js',
    [
      'C:',
      'app',
      'node_modules',
      '@soundtouchjs',
      'core',
      '.dist',
      'SoundTouch.js',
    ].join(String.fromCodePoint(92)),
  ])(
    'removes the broken map reference while preserving compiled code: %s',
    async (resourcePath) => {
      expect.assertions(2);
      const rule = configuredRule();
      const emitWarning = jest.fn();
      const code = 'export const audio = 42;';
      const output = await runLoader(
        rule,
        resourcePath,
        code + '\n//# sourceMappingURL=missing.js.map',
        emitWarning,
      );
      expect(output.trim()).toBe(code);
      expect(emitWarning).not.toHaveBeenCalled();
    },
  );

  it('continues loading source maps for application code and other packages', () => {
    const filter = configuredRule().options.filterSourceMappingUrl;
    expect(filter('App.js.map', '/app/src/App.js')).toBe(true);
    expect(
      filter('other.js.map', '/app/node_modules/another-package/index.js'),
    ).toBe(true);
  });

  it('preserves any pre-existing source-map filter for other modules', () => {
    const previous = jest.fn(() => 'skip');
    const filter = configuredRule({ filterSourceMappingUrl: previous }).options
      .filterSourceMappingUrl;
    expect(filter('other.map', '/app/src/App.js')).toBe('skip');
    expect(previous).toHaveBeenCalledWith('other.map', '/app/src/App.js');
  });
});
