self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const data = event.data?.json?.() || {};
  event.waitUntil(self.registration.showNotification(data.title || "Inspite People", {
    body: data.body || "You have a new notification.",
    icon: "/app-icon.svg",
    badge: "/app-icon.svg",
    data: { url: data.url || "/" }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url || "/"));
});
