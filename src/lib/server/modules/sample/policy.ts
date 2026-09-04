import type { RequestEvent } from '@sveltejs/kit';
import {
	requirePermission,
	type AuthorizedContext,
	type Permission
} from '$lib/server/auth/require-permission';

/**
 * The permissions this module is governed by. The sample module is part of the `project`
 * bounded context, so it reuses that resource from the platform access control statements;
 * a module with its own resource declares it in `src/lib/server/auth/access-control.ts` first.
 */
export const samplePermissions = {
	read: { resource: 'project', action: 'read' },
	create: { resource: 'project', action: 'create' },
	update: { resource: 'project', action: 'update' },
	archive: { resource: 'project', action: 'delete' }
} as const satisfies Record<string, Permission>;

export type SampleAction = keyof typeof samplePermissions;

/** Authorizes one module action. Throws 401 when unauthenticated and 403 when not permitted. */
export function requireSampleAccess(event: RequestEvent, action: SampleAction): AuthorizedContext {
	return requirePermission(event, samplePermissions[action]);
}
