const CracoLessPlugin = require('@semantic-ui-react/craco-less');

module.exports = {
  eslint: { enable: true },
  plugins: [{ plugin: CracoLessPlugin }],
  devServer: {
    client: {
      webSocketURL: 'auto://0.0.0.0:0/ws',
    },
    proxy: [
      {
        context: ['/api', '/swagger'],
        target: 'http://localhost:5030',
        changeOrigin: true,
      },
      {
        context: ['/hub'],
        target: 'http://localhost:5030',
        changeOrigin: true,
        ws: true,
      },
    ],
  },
};
