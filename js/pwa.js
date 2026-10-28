// pwa.js — service worker registration and the "update available" banner.

let registration = null;

function showUpdateBanner(worker) {
  if (document.getElementById('update-banner')) return;
  const btn = document.createElement('button');
  btn.id = 'update-banner';
  btn.className = 'update-banner';
  btn.textContent = 'Update available — tap to reload';
  btn.onclick = () => {
    btn.textContent = 'Updating…';
    worker.postMessage({ type: 'SKIP_WAITING' });
  };
  document.body.appendChild(btn);
}

function watch(reg) {
  // A worker already waiting from an earlier visit.
  if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      // Only an update if a previous worker controls the page (not the first install).
      if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(worker);
    });
  });
}

export function initPwa() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    // Reload only when the user asked for the update.
    if (document.getElementById('update-banner')) {
      reloading = true;
      location.reload();
    }
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    registration = reg;
    watch(reg);
  }).catch((err) => console.warn('Service worker registration failed', err));

  // Home-screen apps are rarely cold-started, so look for updates when reopened.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && registration) registration.update().catch(() => {});
  });
}

/** Version of the running service worker, e.g. "1.0.0", or null without one. */
export function getVersion() {
  const ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!ctrl) return Promise.resolve(null);
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 1500);
    ch.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data && e.data.version); };
    ctrl.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
  });
}
