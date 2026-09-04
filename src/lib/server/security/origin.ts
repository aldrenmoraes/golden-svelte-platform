import { error, type RequestEvent } from '@sveltejs/kit';
import { logger } from '$lib/server/observability/logger';

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isMutatingMethod(method: string): boolean {
	return mutatingMethods.has(method.toUpperCase());
}

function originOf(value: string | null): string | null {
	if (!value) return null;
	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
}

/**
 * Cross-site request forgery guard. A mutating request must carry an `Origin` (or, as a fallback,
 * a `Referer`) that matches the origin the app is served from. Requests with neither header are
 * rejected rather than trusted.
 */
export function isSameOriginRequest(request: Request, url: URL): boolean {
	if (!isMutatingMethod(request.method)) return true;
	const claimed =
		originOf(request.headers.get('origin')) ?? originOf(request.headers.get('referer'));
	return claimed !== null && claimed === url.origin;
}

/** Throws 403 when a mutating request does not originate from this app. */
export function requireSameOrigin(event: RequestEvent): void {
	if (isSameOriginRequest(event.request, event.url)) return;
	logger.info(
		{
			method: event.request.method,
			path: event.url.pathname,
			outcome: 'invalid_origin',
			origin: event.request.headers.get('origin') ?? 'none'
		},
		'Request rejected by origin check'
	);
	error(403, 'invalid_origin');
}
