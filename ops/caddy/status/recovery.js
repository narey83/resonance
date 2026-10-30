/* Caddy owns readiness. This independent page only follows its HTTP response. */
(() => {
  const message = document.querySelector('#recovery');
  document.querySelector('#retry').addEventListener('click', () => window.location.reload());
  const check = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    let delay = 5000;
    try {
      const response = await fetch('/__site/status', { cache: 'no-store', signal: controller.signal });
      const state = response.headers.get('X-Resonance-Site-State');
      if (response.status === 200 && response.headers.get('X-Resonance-Gateway') === 'caddy'
        && ['available', 'degraded'].includes(state)) {
        window.location.reload();
        return;
      }
      const retry = Number(response.headers.get('Retry-After'));
      if (retry > 0 && Number.isFinite(retry)) delay = Math.max(1000, Math.min(60000, retry * 1000));
      message.textContent = 'Waiting for the server. We’ll reconnect automatically.';
    } catch {
      message.textContent = 'Waiting for a connection. We’ll keep trying automatically.';
    } finally {
      clearTimeout(timeout);
    }
    setTimeout(check, delay);
  };
  void check();
})();
