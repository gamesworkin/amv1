// Cache permanente do motor FFmpeg (≈31 MB): baixa só na primeira visita
const CACHE = 'ffmpeg-core-0.12.6';
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('ffmpeg-core-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
));
self.addEventListener('fetch', (e) => {
  if (!e.request.url.includes('/ffmpeg/')) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request);
    if (hit) return hit;
    const res = await fetch(e.request);
    if (res.ok) c.put(e.request, res.clone());
    return res;
  }));
});
