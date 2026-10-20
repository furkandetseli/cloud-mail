import i18next from 'i18next';
import zh from './zh.js'
import en from './en.js'
import tr from './tr.js'
import app from '../hono/hono';

const supportedLangs = ['zh', 'en', 'tr']

const resources = {
	en: {
		translation: en
	},
	zh: {
		translation: zh,
	},
	tr: {
		translation: tr,
	},
};

i18next.init({
	lng: 'en',
	fallbackLng: 'en',
	resources,
	initImmediate: false,
});

let currentLng = 'en'

app.use('*', async (c, next) => {
	const lang = c.req.header('accept-language')?.split(',')[0]?.split('-')[0]
	currentLng = supportedLangs.includes(lang) ? lang : 'en'
	return await next()
})

export const t = (key, values) => i18next.t(key, { ...(values || {}), lng: currentLng })

export default i18next;
