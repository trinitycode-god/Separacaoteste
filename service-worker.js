/* CONDOR WMS — Service Worker
   Faz cache do "app shell" (HTML/CSS/JS/assets) para permitir abrir o app
   rapidamente em tablets mesmo com conexão instável.
   Os dados (OPs, itens) sempre vêm da rede — nunca do cache. */

const CACHE_NAME = "condor-wms-v1";
const APP_SHELL = [
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.json",
  "./assets/logo.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // Nunca cachear chamadas ao Apps Script (dados dinâmicos)
  if (url.includes("script.google.com")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).then((response) => {
          if (event.request.method === "GET" && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached)
      );
    })
  );
});
