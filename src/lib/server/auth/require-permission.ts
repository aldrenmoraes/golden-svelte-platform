import { error, type RequestEvent } from '@sveltejs/kit';
import type { Session, User } from 'better-auth';
import type { RoleAuthorizeRequest } from 'better-auth/plugins/access';
import { accessControl, roles } from '$lib/server/auth/access-control';
import { logger } from '$lib/server/observability/logger';

type PlatformStatements = typeof accessControl.statements;

/** A resource declared by the platform access control statements. */
export type Resource = keyof PlatformStatements;

/** A single `resource`/`action` pair declared by the platform access control statements. */
export type Permission = {
	[TResource in Resource]: {
		resource: TResource;
		action: PlatformStatements[TResource][number];
	};
}[Resource];

/** A role code declared in project.manifest.yaml. */
export type PlatformRole = keyof typeof roles;

/** The authenticated and authorized context returned to a route handler. */
export type AuthorizedContext = { user: User; session: Session };

const platformRoles = Object.keys(roles) as PlatformRole[];

export function isPlatformRole(value: unknown): value is PlatformRole {
	return typeof value === 'string' && platformRoles.includes(value as PlatformRole);
}

/**
 * Reads the platform roles from a Better Auth user. The admin plugin stores roles as a single
 * string that may hold a comma-separated list; unknown role codes are ignored.
 */
export function parseRoles(value: unknown): PlatformRole[] {
	if (typeof value !== 'string') return [];
	return value
		.split(',')
		.map((code) => code.trim())
		.filter(isPlatformRole);
}

/** True when at least one of the given roles grants the permission. */
export function hasPermission(userRoles: readonly PlatformRole[], permission: Permission): boolean {
	const request = {
		[permission.resource]: [permission.action]
	} as RoleAuthorizeRequest<PlatformStatements>;
	return userRoles.some((code) => roles[code].authorize(request).success);
}

/**
 * Authenticates the session and authorizes a declared permission for a route handler.
 * Throws 401 when there is no session and 403 when the session lacks the permission.
 */
export function requirePermission(event: RequestEvent, permission: Permission): AuthorizedContext {
	const audit = {
		method: event.request.method,
		path: event.url.pathname,
		resource: permission.resource,
		action: permission.action
	};
	const { user, session } = event.locals;

	if (!user || !session) {
		logger.info({ ...audit, outcome: 'unauthenticated' }, 'Authorization denied');
		error(401, 'unauthenticated');
	}

	const userRoles = parseRoles((user as { role?: unknown }).role);
	if (!hasPermission(userRoles, permission)) {
		logger.info(
			{ ...audit, outcome: 'forbidden', userId: user.id, platformRoles: userRoles },
			'Authorization denied'
		);
		error(403, 'forbidden');
	}

	return { user, session };
}
