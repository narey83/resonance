const CracoLessPlugin = require('@semantic-ui-react/craco-less');

// eslint-disable-next-line n/no-process-env -- This is the dev-server environment configuration.
const environment = process.env;
const apiTarget =
  environment.RESONANCE_DEV_API_TARGET || 'http://localhost:5030';

module.exports = {
  eslint: { enable: true },
  webpack: {
    configure: (config) => {
      const configureRules = (rules = []) => {
        for (const rule of rules) {
          if (!rule || typeof rule !== 'object') continue;
          if (
            typeof rule.loader === 'string' &&
            rule.loader.includes('source-map-loader')
          ) {
            const previousFilter = rule.options?.filterSourceMappingUrl;
            rule.options = {
              ...rule.options,
              // The published SoundTouch maps reference TypeScript sources absent from
              // the package. Keep its compiled JS, removing only those broken map URLs.
              filterSourceMappingUrl: (url, resourcePath) => {
                if (
                  resourcePath
                    .replaceAll('\\', '/')
                    .includes('/node_modules/@soundtouchjs/core/.dist/')
                )
                  return false;
                return previousFilter
                  ? previousFilter(url, resourcePath)
                  : true;
              },
            };
          }

          configureRules(rule.rules);
          configureRules(rule.oneOf);
        }
      };

      configureRules(config.module?.rules);
      return config;
    },
  },
  plugins: [{ plugin: CracoLessPlugin }],
  devServer: (config) => {
    const {
      onBeforeSetupMiddleware: before,
      onAfterSetupMiddleware: after,
      setupMiddlewares: setup,
      ...modern
    } = config;

    return {
      ...modern,
      client: {
        ...modern.client,
        webSocketURL: 'auto://0.0.0.0:0/ws',
      },
      proxy: [
        {
          context: ['/api', '/swagger'],
          target: apiTarget,
          changeOrigin: false,
        },
        {
          context: ['/hub'],
          target: apiTarget,
          changeOrigin: false,
          ws: true,
        },
      ],
      setupMiddlewares: (middlewares, server) => {
        // CRA's source-map and custom proxy setup must precede the defaults.
        before?.(server);
        const configured = setup?.(middlewares, server) || middlewares;

        // CRA's after hook registers redirects and its no-op service worker with
        // app.use. Collect them into the modern trailing middleware list so they
        // still execute AFTER the proxy, static files and history fallback.
        const trailing = [];
        const trailingApp = {
          use: (...handlers) => {
            trailing.push(...handlers);
            return trailingApp;
          },
        };
        after?.({ ...server, app: trailingApp });
        configured.push(
          ...trailing.map((middleware, index) => ({
            name: 'cra-after-setup-' + index,
            middleware,
          })),
        );
        return configured;
      },
    };
  },
};
