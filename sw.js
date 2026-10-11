// Offline support: the app's own files come from the network when it answers quickly, else from
// cache; versioned library files from CDNs are cached on first use. Firestore traffic is untouched
// (the Firebase SDK keeps its own offline copy of the data).
const VERSION = 'overload-v1';
const SHELL = ['./', './index.html', './app.js', './styles.css', './firebase-config.js', './manifest.webmanifest', './icons/favicon.svg', './icons/icon-192.png'];
const CDN_HOSTS = ['www.gstatic.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function networkFirst(req){
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 3500));
  const net = fetch(req).then(res => {
    if(res.ok){ const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  });
  net.catch(() => {});
  return Promise.race([net, timeout]).catch(() =>
    caches.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : net)));
}
function cacheFirst(req){
  return caches.match(req).then(hit => hit || fetch(req).then(res => {
    if(res.ok || res.type === 'opaque'){ const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  }));
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin === self.location.origin) e.respondWith(networkFirst(req));
  else if(CDN_HOSTS.includes(url.hostname)) e.respondWith(cacheFirst(req));
});
