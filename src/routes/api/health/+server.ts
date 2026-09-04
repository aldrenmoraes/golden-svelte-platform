import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () =>
	json({
		status: 'ok',
		appVersion: process.env.APP_VERSION ?? '0.0.0-dev',
		gitSha: process.env.GIT_SHA ?? 'unknown'
	});
