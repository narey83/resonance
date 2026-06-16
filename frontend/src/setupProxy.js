// Proxy config moved to craco.config.js devServer.proxy so webpack-dev-server
// handles WebSocket upgrades natively and does not intercept /ws (HMR socket).
module.exports = function () {};
