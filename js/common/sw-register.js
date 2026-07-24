(function registerTragoServiceWorker() {
  'use strict';

  if (!('serviceWorker' in navigator) || !['http:', 'https:'].includes(location.protocol)) return;

  const reloadKey = 'trago:sw:reloaded:final-v4';
  let refreshing = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing || sessionStorage.getItem(reloadKey) === '1') return;
    refreshing = true;
    sessionStorage.setItem(reloadKey, '1');
    location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', {
        scope: './',
        updateViaCache: 'none'
      });
      await registration.update();
    } catch (error) {
      console.warn('TraGo: não foi possível actualizar o suporte offline.', error);
    }
  });
})();
