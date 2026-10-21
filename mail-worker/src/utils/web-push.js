function concatBytes(...parts) {
	const length = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(length);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

function bytesToB64url(bytes) {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlToBytes(value) {
	const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
	const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
	return out;
}

async function hkdf(salt, ikm, info, length) {
	const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'HKDF', hash: 'SHA-256', salt, info },
		key,
		length * 8
	);
	return new Uint8Array(bits);
}

async function encryptPayload(userPublicKey, userAuth, payload) {
	const localPair = await crypto.subtle.generateKey(
		{ name: 'ECDH', namedCurve: 'P-256' },
		true,
		['deriveBits']
	);
	const localPublic = new Uint8Array(await crypto.subtle.exportKey('raw', localPair.publicKey));
	const remotePublic = await crypto.subtle.importKey(
		'raw',
		userPublicKey,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[]
	);
	const shared = new Uint8Array(await crypto.subtle.deriveBits(
		{ name: 'ECDH', public: remotePublic },
		localPair.privateKey,
		256
	));
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const ikm = await hkdf(
		userAuth,
		shared,
		concatBytes(new TextEncoder().encode('WebPush: info\0'), userPublicKey, localPublic),
		32
	);
	const contentKey = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
	const nonce = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);
	const aesKey = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt']);
	const cipher = new Uint8Array(await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: nonce },
		aesKey,
		concatBytes(payload, new Uint8Array([2]))
	));
	const recordSize = new Uint8Array(4);
	new DataView(recordSize.buffer).setUint32(0, 4096, false);
	return concatBytes(salt, recordSize, new Uint8Array([localPublic.length]), localPublic, cipher);
}

async function signVapid(privateJwk, audience, subject) {
	const header = bytesToB64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
	const body = bytesToB64url(new TextEncoder().encode(JSON.stringify({
		aud: audience,
		exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
		sub: subject
	})));
	const key = await crypto.subtle.importKey(
		'jwk',
		privateJwk,
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['sign']
	);
	const signature = new Uint8Array(await crypto.subtle.sign(
		{ name: 'ECDSA', hash: 'SHA-256' },
		key,
		new TextEncoder().encode(`${header}.${body}`)
	));
	return `${header}.${body}.${bytesToB64url(signature)}`;
}

const webPush = {
	bytesToB64url,
	b64urlToBytes,

	async createVapidKeys() {
		const pair = await crypto.subtle.generateKey(
			{ name: 'ECDSA', namedCurve: 'P-256' },
			true,
			['sign']
		);
		const publicKey = bytesToB64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
		const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
		return { publicKey, privateJwk };
	},

	async sendNotification({ endpoint, p256dh, auth, publicKey, privateJwk, subject, payload }) {
		const url = new URL(endpoint);
		const jwt = await signVapid(privateJwk, `${url.protocol}//${url.host}`, subject);
		const body = await encryptPayload(
			b64urlToBytes(p256dh),
			b64urlToBytes(auth),
			new TextEncoder().encode(payload)
		);
		return fetch(endpoint, {
			method: 'POST',
			headers: {
				TTL: '86400',
				Urgency: 'high',
				'Content-Encoding': 'aes128gcm',
				'Content-Type': 'application/octet-stream',
				Authorization: `vapid t=${jwt}, k=${publicKey}`
			},
			body
		});
	}
};

export default webPush;
