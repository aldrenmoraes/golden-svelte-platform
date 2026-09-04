import { describe, expect, test } from 'bun:test';
import {
	applySecurityHeaders,
	buildContentSecurityPolicy,
	securityHeaders
} from '../../src/lib/server/security/headers';

describe('security headers', () => {
	test('sets the standard hardening headers', () => {
		const headers = securityHeaders({ dev: false });
		expect(headers['X-Frame-Options']).toBe('DENY');
		expect(headers['X-Content-Type-Options']).toBe('nosniff');
		expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
		expect(headers['Permissions-Policy']).toContain('camera=()');
		expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
	});

	test('sends strict transport security only outside development', () => {
		expect(securityHeaders({ dev: false })['Strict-Transport-Security']).toBe(
			'max-age=31536000; includeSubDomains'
		);
		expect(securityHeaders({ dev: true })['Strict-Transport-Security']).toBeUndefined();
	});

	test('relaxes the policy for the dev server only', () => {
		expect(buildContentSecurityPolicy({ dev: true })).toContain('ws:');
		const production = buildContentSecurityPolicy({ dev: false });
		expect(production).not.toContain('ws:');
		expect(production).not.toContain("'unsafe-eval'");
		expect(production).toContain('upgrade-insecure-requests');
	});

	test('applies the headers to a response', () => {
		const response = applySecurityHeaders(new Response('ok'), { dev: false });
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	});
});
