import { describe, expect, test } from 'bun:test';
import { isHttpError, type RequestEvent } from '@sveltejs/kit';
import {
	hasPermission,
	isPlatformRole,
	parseRoles,
	requirePermission,
	type Permission
} from '../../src/lib/server/auth/require-permission';

const url = new URL('https://app.example.com/api/projects');

function eventFor(role?: string): RequestEvent {
	const locals = role
		? { user: { id: 'user-1', role }, session: { id: 'session-1' } }
		: ({} as Record<string, unknown>);
	return {
		request: new Request(url, { method: 'POST' }),
		url,
		locals
	} as unknown as RequestEvent;
}

function statusOf(run: () => unknown): number {
	try {
		run();
	} catch (thrown) {
		if (isHttpError(thrown)) return thrown.status;
		throw thrown;
	}
	throw new Error('expected the guard to throw');
}

const deleteProject: Permission = { resource: 'project', action: 'delete' };
const readProject: Permission = { resource: 'project', action: 'read' };

describe('role parsing', () => {
	test('accepts only roles declared in the manifest', () => {
		expect(isPlatformRole('operator')).toBe(true);
		expect(isPlatformRole('superuser')).toBe(false);
	});

	test('reads a comma-separated role claim and drops unknown codes', () => {
		expect(parseRoles('viewer, operator')).toEqual(['viewer', 'operator']);
		expect(parseRoles('viewer,superuser')).toEqual(['viewer']);
		expect(parseRoles(undefined)).toEqual([]);
	});
});

describe('permission checks', () => {
	test('grants a permission held by the role', () => {
		expect(hasPermission(['admin'], deleteProject)).toBe(true);
		expect(hasPermission(['viewer'], readProject)).toBe(true);
	});

	test('denies a permission the role does not hold', () => {
		expect(hasPermission(['operator'], deleteProject)).toBe(false);
		expect(hasPermission(['viewer'], deleteProject)).toBe(false);
		expect(hasPermission([], readProject)).toBe(false);
	});

	test('grants when any of the roles holds the permission', () => {
		expect(hasPermission(['viewer', 'admin'], deleteProject)).toBe(true);
	});
});

describe('requirePermission', () => {
	test('rejects an anonymous request with 401', () => {
		expect(statusOf(() => requirePermission(eventFor(), readProject))).toBe(401);
	});

	test('rejects an authenticated request without the permission with 403', () => {
		expect(statusOf(() => requirePermission(eventFor('viewer'), deleteProject))).toBe(403);
	});

	test('rejects a session whose role is not a platform role with 403', () => {
		expect(statusOf(() => requirePermission(eventFor('superuser'), readProject))).toBe(403);
	});

	test('returns the user and session when authorized', () => {
		const { user, session } = requirePermission(eventFor('admin'), deleteProject);
		expect(user.id).toBe('user-1');
		expect(session.id).toBe('session-1');
	});
});
