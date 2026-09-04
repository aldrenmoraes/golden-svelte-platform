/** Options that make the policy usable in development without weakening production. */
export type SecurityHeaderOptions = {
	/** When true, relax the policy for the Vite dev server (HMR websocket, eval-based tooling). */
	dev: boolean;
};

const permissionsPolicy = [
	'accelerometer=()',
	'autoplay=()',
	'camera=()',
	'display-capture=()',
	'encrypted-media=()',
	'fullscreen=(self)',
	'geolocation=()',
	'gyroscope=()',
	'magnetometer=()',
	'microphone=()',
	'midi=()',
	'payment=()',
	'usb=()'
].join(', ');

const strictTransportSecurity = 'max-age=31536000; includeSubDomains';

/**
 * Builds the Content-Security-Policy. SvelteKit inlines hydration scripts and Svelte injects
 * component styles at runtime, so `'unsafe-inline'` is required until the app opts into nonces.
 */
export function buildContentSecurityPolicy({ dev }: SecurityHeaderOptions): string {
	const scriptSrc = ["'self'", "'unsafe-inline'"];
	const connectSrc = ["'self'"];

	if (dev) {
		scriptSrc.push("'unsafe-eval'");
		connectSrc.push('ws:', 'wss:');
	}

	const directives = [
		['default-src', "'self'"],
		['base-uri', "'self'"],
		['object-src', "'none'"],
		['frame-ancestors', "'none'"],
		['form-action', "'self'"],
		['img-src', "'self'", 'data:', 'blob:'],
		['font-src', "'self'", 'data:'],
		['style-src', "'self'", "'unsafe-inline'"],
		['script-src', ...scriptSrc],
		['connect-src', ...connectSrc],
		['manifest-src', "'self'"],
		['worker-src', "'self'", 'blob:']
	];

	if (!dev) directives.push(['upgrade-insecure-requests']);

	return directives.map((directive) => directive.join(' ')).join('; ');
}

/** The security headers applied to every response. */
export function securityHeaders(options: SecurityHeaderOptions): Record<string, string> {
	const headers: Record<string, string> = {
		'Content-Security-Policy': buildContentSecurityPolicy(options),
		'X-Frame-Options': 'DENY',
		'X-Content-Type-Options': 'nosniff',
		'Referrer-Policy': 'strict-origin-when-cross-origin',
		'Permissions-Policy': permissionsPolicy
	};

	if (!options.dev) headers['Strict-Transport-Security'] = strictTransportSecurity;

	return headers;
}

/** Applies the security headers to a response in place. */
export function applySecurityHeaders(response: Response, options: SecurityHeaderOptions): Response {
	for (const [name, value] of Object.entries(securityHeaders(options))) {
		response.headers.set(name, value);
	}
	return response;
}
