import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import pushService from '../service/push-service';

app.get('/push/key', async (c) => {
	const publicKey = await pushService.publicKey(c);
	return c.json(result.ok({ publicKey }));
});

app.post('/push/subscribe', async (c) => {
	await pushService.subscribe(c, userContext.getUserId(c), await c.req.json());
	return c.json(result.ok());
});

app.delete('/push/subscribe', async (c) => {
	const { endpoint } = await c.req.json();
	await pushService.unsubscribe(c, userContext.getUserId(c), endpoint);
	return c.json(result.ok());
});
