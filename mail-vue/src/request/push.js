import http from '@/axios/index.js';

export function pushPublicKey() {
    return http.get('/push/key');
}

export function pushSubscribe(subscription) {
    return http.post('/push/subscribe', subscription);
}

export function pushUnsubscribe(endpoint) {
    return http.delete('/push/subscribe', { data: { endpoint } });
}
