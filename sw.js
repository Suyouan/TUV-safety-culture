const CACHE_NAME = "sign-sys-v2"; // <--- 升級版本號，強制手機更新快取
const assetsToCache = [
  "./index.html",
  "./app.js",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(assetsToCache);
    })
  );
  self.skipWaiting(); // 讓新的 Service Worker 立刻生效
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log("清除舊快取:", cacheName);
            return caches.delete(cacheName); // 自動清掉舊版的 cache-v1
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 改用「網路優先 (Network First)」策略：確保每次開網頁、掃描都能抓到最新參數與資料
self.addEventListener("fetch", (event) => {
  // 針對導航請求（也就是直接輸入網址或掃描 QR Code 開啟網頁的請求）
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          return networkResponse;
        })
        .catch(() => {
          return caches.match('./index.html');
        })
    );
    return;
  }

  // 其他靜態資源維持原本的快取優先
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
