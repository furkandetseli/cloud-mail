import webPush from '../utils/web-push';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';

let ready = false;

async function ensure(env) {
	if (ready) return;
	await env.db.batch([
		env.db.prepare(`CREATE TABLE IF NOT EXISTS push_key (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			public_key TEXT NOT NULL,
			private_jwk TEXT NOT NULL
		)`),
		env.db.prepare(`CREATE TABLE IF NOT EXISTS push_sub (
			push_id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			endpoint TEXT NOT NULL,
			p256dh TEXT NOT NULL,
			auth TEXT NOT NULL,
			create_time TEXT DEFAULT CURRENT_TIMESTAMP
		)`),
		env.db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_push_sub_endpoint ON push_sub(endpoint)`),
		env.db.prepare(`CREATE INDEX IF NOT EXISTS idx_push_sub_user ON push_sub(user_id)`)
	]);
	ready = true;
}

function clip(value, max) {
	const text = String(value || '').replace(/\s+/g, ' ').trim();
	if (text.length <= max) return text;
	return text.slice(0, max - 1) + '…';
}

const pushService = {
	async publicKey(c) {
		const keys = await this.keys(c.env);
		return keys.publicKey;
	},

	async keys(env) {
		await ensure(env);
		let row = await env.db.prepare('SELECT public_key, private_jwk FROM push_key WHERE id = 1').first();
		if (row) {
			return { publicKey: row.public_key, privateJwk: JSON.parse(row.private_jwk) };
		}
		const created = await webPush.createVapidKeys();
		try {
			await env.db.prepare('INSERT INTO push_key (id, public_key, private_jwk) VALUES (1, ?, ?)')
				.bind(created.publicKey, JSON.stringify(created.privateJwk))
				.run();
		} catch (e) {
			row = await env.db.prepare('SELECT public_key, private_jwk FROM push_key WHERE id = 1').first();
			if (!row) throw e;
			return { publicKey: row.public_key, privateJwk: JSON.parse(row.private_jwk) };
		}
		return created;
	},

	async subscribe(c, userId, body) {
		const endpoint = body?.endpoint;
		const p256dh = body?.keys?.p256dh;
		const auth = body?.keys?.auth;
		if (!endpoint || !endpoint.startsWith('https://') || !p256dh || !auth) {
			throw new BizError(t('pushBad'));
		}
		await ensure(c.env);
		await c.env.db.prepare(`INSERT INTO push_sub (user_id, endpoint, p256dh, auth)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
			.bind(userId, endpoint, p256dh, auth)
			.run();
	},

	async unsubscribe(c, userId, endpoint) {
		if (!endpoint) return;
		await ensure(c.env);
		await c.env.db.prepare('DELETE FROM push_sub WHERE user_id = ? AND endpoint = ?')
			.bind(userId, endpoint)
			.run();
	},

	async notifyNewEmail(c, emailRow) {
		if (!emailRow?.userId) return;
		await ensure(c.env);
		const { results } = await c.env.db.prepare(
			'SELECT endpoint, p256dh, auth FROM push_sub WHERE user_id = ?'
		).bind(emailRow.userId).all();
		if (!results?.length) return;

		const keys = await this.keys(c.env);
		const admin = c.env.admin && String(c.env.admin).includes('@') ? c.env.admin : 'mail@localhost';
		const title = clip(emailRow.name || emailRow.sendEmail, 80) || 'Mail';
		const subject = clip(emailRow.subject, 120);
		const body = emailRow.code
			? `${subject ? subject + ' · ' : ''}${emailRow.code}`
			: (subject || emailRow.toEmail || '');
		const payload = JSON.stringify({
			title,
			body,
			url: '/inbox'
		});

		await Promise.all(results.map(async (sub) => {
			try {
				const res = await webPush.sendNotification({
					endpoint: sub.endpoint,
					p256dh: sub.p256dh,
					auth: sub.auth,
					publicKey: keys.publicKey,
					privateJwk: keys.privateJwk,
					subject: `mailto:${admin}`,
					payload
				});
				if (res.status === 404 || res.status === 410) {
					await c.env.db.prepare('DELETE FROM push_sub WHERE endpoint = ?').bind(sub.endpoint).run();
				} else if (!res.ok) {
					console.error('push fail', res.status, await res.text());
				}
			} catch (e) {
				console.error('push fail', e);
			}
		}));
	}
};

export default pushService;
