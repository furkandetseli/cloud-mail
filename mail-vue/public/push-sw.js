self.addEventListener('push', (event) => {
	let data = { title: 'Mail', body: '', url: '/inbox' };
	try {
		if (event.data) data = { ...data, ...event.data.json() };
	} catch (e) {
		data.body = event.data ? event.data.text() : '';
	}
	event.waitUntil(self.registration.showNotification(data.title || 'Mail', {
		body: data.body || '',
		icon: '/mail-pwa.png',
		badge: '/mail-pwa.png',
		data: { url: data.url || '/inbox' }
	}));
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = new URL(event.notification.data?.url || '/inbox', self.location.origin).href;
	event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
		for (const client of list) {
			if (client.url.startsWith(self.location.origin) && 'focus' in client) {
				if ('navigate' in client) client.navigate(url);
				return client.focus();
			}
		}
		if (self.clients.openWindow) return self.clients.openWindow(url);
	}));
});
