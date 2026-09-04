import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const appVersion = process.env.APP_VERSION ?? '0.0.0-dev';
const gitSha = process.env.GIT_SHA ?? 'unknown';
const payload = { appVersion, gitSha, builtAt: new Date().toISOString() };
await mkdir(join(process.cwd(), 'static'), { recursive: true });
await writeFile(
	join(process.cwd(), 'static', 'build-info.json'),
	JSON.stringify(payload, null, 2) + '\n'
);
