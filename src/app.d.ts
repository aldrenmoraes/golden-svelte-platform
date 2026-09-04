import type { Session, User } from 'better-auth';
import type { ThemeMode } from '$lib/theme';

declare global {
	namespace App {
		interface Locals {
			user?: User;
			session?: Session;
			themeMode?: ThemeMode;
		}
	}
}

export {};
