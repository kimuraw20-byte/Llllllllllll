const CACHE_NAME = 'munazzam-app-v3';
const urlsToCache = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  // يمكنك إضافة أيقونات التطبيق هنا إذا كانت متوفرة
  // '/icon-192.png',
  // '/icon-512.png'
];

// تثبيت Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

// تفعيل Service Worker
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// جلب الطلبات
self.addEventListener('fetch', event => {
  // تجاهل طلبات غير HTTP/HTTPS
  if (!event.request.url.startsWith('http')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // إذا وجدنا تطابق في الكاش نرجعه
        if (response) {
          return response;
        }

        // نجلب من الشبكة ثم نخزن في الكاش
        return fetch(event.request).then(response => {
          // نتحقق من أن الرد صالح للتخزين
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          const responseToCache = response.clone();

          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });

          return response;
        });
      })
  );
});