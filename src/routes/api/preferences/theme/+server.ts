import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isThemeMode } from '$lib/theme';
import { themeConfig } from '$lib/theme/config';

export const POST: RequestHandler = async ({ request, cookies, url }) => {
	const body = (await request.json().catch(() => null)) as { mode?: unknown } | null;
	if (!body || !isThemeMode(body.mode))
		return json({ error: 'invalid_theme_mode' }, { status: 400 });
	cookies.set(themeConfig.cookieName, body.mode, {
		path: '/',
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		httpOnly: false,
		maxAge: 60 * 60 * 24 * 365
	});
	return json({ mode: body.mode });
};