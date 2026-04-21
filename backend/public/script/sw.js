// Service Worker wurde entfernt.
// Diese Datei existiert nur noch damit alte Installationen keinen 404 erhalten.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
