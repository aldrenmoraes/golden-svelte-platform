import { createAccessControl } from 'better-auth/plugins/access';

export const accessControl = createAccessControl({
	project: ['create', 'read', 'update', 'delete'],
	user: ['create', 'read', 'list', 'update', 'set-role', 'ban'],
	audit: ['read']
} as const);

export const roles = {
	admin: accessControl.newRole({
		project: ['create', 'read', 'update', 'delete'],
		user: ['create', 'read', 'list', 'update', 'set-role', 'ban'],
		audit: ['read']
	}),
	operator: accessControl.newRole({
		project: ['create', 'read', 'update'],
		user: ['read', 'list'],
		audit: ['read']
	}),
	viewer: accessControl.newRole({ project: ['read'], user: ['read'], audit: ['read'] })
} as const;
