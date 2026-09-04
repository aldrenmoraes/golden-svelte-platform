import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { auth } from '$lib/server/auth';
import { logger, withRequestContext } from '$lib/server/observability/logger';
import { isThemeMode } from '$lib/theme';
import { themeConfig } from '$lib/theme/config';
import { svelteKitHandler } from 'better-auth/svelte-kit';

const handleParaglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;
		return resolve(event, {
			transformPageChunk: ({ html }) =>
				html
					.replace('%paraglide.lang%', locale)
					.replace('%paraglide.dir%', getTextDirection(locale))
		});
	});

const handleTheme: Handle = ({ event, resolve }) => {
	const storedMode = event.cookies.get(themeConfig.cookieName);
	const mode = isThemeMode(storedMode) ? storedMode : themeConfig.defaultMode;
	event.locals.themeMode = mode;
	return resolve(event, { transformPageChunk: ({ html }) => html.replace('%app.theme%', mode) });
};

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });
	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}
	return svelteKitHandler({ event, resolve, auth, building });
};

const handleLogging: Handle = async ({ event, resolve }) => {
	const startedAt = performance.now();
	const platformRole = (event.locals.user as { role?: string } | undefined)?.role;
	return withRequestContext(
		{
			correlationId: event.request.headers.get('x-correlation-id') ?? crypto.randomUUID(),
			userId: event.locals.user?.id,
			platformRole
		},
		async () => {
			const response = await resolve(event);
			logger.info(
				{
					method: event.request.method,
					path: event.url.pathname,
					status: response.status,
					latency_ms: Number((performance.now() - startedAt).toFixed(2)),
					clientIp: event.getClientAddress(),
					userAgent: event.request.headers.get('user-agent') ?? 'unknown',
					responseSize: response.headers.get('content-length') ?? 'unknown'
				},
				'Request completed'
			);
			return response;
		}
	);
};

export const handle: Handle = sequence(
	handleParaglide,
	handleTheme,
	handleBetterAuth,
	handleLogging
);
