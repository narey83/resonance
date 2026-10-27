const { devServer } = require('../../craco.config');

describe('modern dev-server middleware', () => {
  it('removes deprecated options while preserving middleware order and proxy setup', () => {
    const events = [];
    const registered = [];
    const beforeMiddleware = () => events.push('before');
    const defaultMiddleware = () => events.push('defaults');
    const customMiddleware = () => events.push('custom');
    const redirect = () => events.push('redirect');
    const serviceWorker = () => events.push('service-worker');
    const before = jest.fn((instance) => instance.app.use(beforeMiddleware));
    const after = jest.fn((instance) => {
      instance.app.use(redirect);
      instance.app.use(serviceWorker);
    });
    const setup = jest.fn((entries) => [
      ...entries,
      { name: 'custom', middleware: customMiddleware },
    ]);
    const raw = {
      hot: true,
      static: { directory: '/public' },
      client: { overlay: true },
      onBeforeSetupMiddleware: before,
      onAfterSetupMiddleware: after,
      setupMiddlewares: setup,
    };
    const config = devServer(raw);
    const app = { use: (middleware) => registered.push(middleware) };
    const server = { app };
    const middlewares = config.setupMiddlewares(
      [{ name: 'defaults', middleware: defaultMiddleware }],
      server,
    );
    for (const item of middlewares) app.use(item.middleware);
    for (const middleware of registered) middleware();

    expect(events).toEqual([
      'before',
      'defaults',
      'custom',
      'redirect',
      'service-worker',
    ]);
    expect(config).not.toHaveProperty('onBeforeSetupMiddleware');
    expect(config).not.toHaveProperty('onAfterSetupMiddleware');
    expect(config.hot).toBe(true);
    expect(config.static).toEqual(raw.static);
    expect(config.client).toMatchObject({
      overlay: true,
      webSocketURL: 'auto://0.0.0.0:0/ws',
    });
    expect(config.proxy[0].context).toEqual(['/api', '/swagger']);
    expect(config.proxy[1]).toMatchObject({ context: ['/hub'], ws: true });
    expect(before).toHaveBeenCalledWith(server);
    expect(after).toHaveBeenCalledTimes(1);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(raw.onBeforeSetupMiddleware).toBe(before);
  });

  it('supports configurations without legacy middleware hooks', () => {
    const config = devServer({});
    const middlewares = [];
    expect(config.setupMiddlewares(middlewares, { app: {} })).toBe(middlewares);
  });
});
