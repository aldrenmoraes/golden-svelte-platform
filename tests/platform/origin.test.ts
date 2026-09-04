import { describe, expect, test } from 'bun:test';
import { isSameOriginRequest, requireSameOrigin } from '../../src/lib/server/security/origin';
import type { RequestEvent } from '@sveltejs/kit';

const appUrl = new URL('https://app.example.com/api/preferences/theme');

function post(headers: Record<string, string>): Request {
	return new Request(appUrl, { method: 'POST', headers, body: '{}' });
}

describe('origin validation', () => {
	test('allows non-mutating requests', () => {
		expect(isSameOriginRequest(new Request(appUrl), appUrl)).toBe(true);
	});

	test('allows a mutating request from the app origin', () => {
		expect(isSameOriginRequest(post({ origin: 'https://app.example.com' }), appUrl)).toBe(true);
	});

	test('rejects a mutating request from another origin', () => {
		expect(isSameOriginRequest(post({ origin: 'https://evil.example.com' }), appUrl)).toBe(false);
	});

	test('falls back to the referer when there is no origin header', () => {
		expect(isSameOriginRequest(post({ referer: 'https://app.example.com/settings' }), appUrl)).toBe(
			true
		);
		expect(isSameOriginRequest(post({ referer: 'https://evil.example.com/' }), appUrl)).toBe(false);
	});

	test('rejects a mutating request that declares no origin at all', () => {
		expect(isSameOriginRequest(post({}), appUrl)).toBe(false);
	});

	test('throws 403 for a cross-origin mutation', () => {
		const event = {
			request: post({ origin: 'https://evil.example.com' }),
			url: appUrl
		} as RequestEvent;
		expect(() => requireSameOrigin(event)).toThrow();
		expect(() =>
			requireSameOrigin({ request: post({ origin: appUrl.origin }), url: appUrl } as RequestEvent)
		).not.toThrow();
	});
});
