import { readFile, writeFile } from 'node:fs/promises';

const dryRun = process.argv.includes('--dry-run');
const run = async (args: string[]) => {
	const process = Bun.spawn({ cmd: ['git', ...args], stdout: 'pipe', stderr: 'pipe' });
	const output = await new Response(process.stdout).text();
	const error = await new Response(process.stderr).text();
	if ((await process.exited) !== 0) throw new Error(error || 'git command failed');
	return output.trim();
};
const packagePath = new URL('../package.json', import.meta.url);
const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as { version: string };
const tags = await run(['tag', '--sort=-v:refname']);
const previousTag = tags.split('\n').find((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
const commits = await run(
	previousTag ? ['log', previousTag + '..HEAD', '--format=%B%n---'] : ['log', '--format=%B%n---']
);
if (!commits) throw new Error('No commits are available for a release.');
const bump = /BREAKING CHANGE:|^[a-z]+(?:\(.+?\))?!:/m.test(commits)
	? 'major'
	: /^feat(?:\(.+?\))?:/m.test(commits)
		? 'minor'
		: /^fix(?:\(.+?\))?:/m.test(commits)
			? 'patch'
			: null;
if (!bump) throw new Error('No feat, fix, or breaking Conventional Commit was found.');
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(packageJson.version);
if (!match) throw new Error('package.json version must use MAJOR.MINOR.PATCH.');
let [major, minor, patch] = match.slice(1).map(Number);
if (bump === 'major') {
	major += 1;
	minor = 0;
	patch = 0;
}
if (bump === 'minor') {
	minor += 1;
	patch = 0;
}
if (bump === 'patch') patch += 1;
const next = major + '.' + minor + '.' + patch;
console.log(JSON.stringify({ previousTag: previousTag ?? null, bump, next, dryRun }, null, 2));
if (dryRun) process.exit(0);
const verification = Bun.spawn({
	cmd: ['bun', 'run', 'verify'],
	stdout: 'inherit',
	stderr: 'inherit'
});
if ((await verification.exited) !== 0) throw new Error('Verification failed; refusing release.');
packageJson.version = next;
await writeFile(packagePath, JSON.stringify(packageJson, null, 2) + '\n');
await writeFile('CHANGELOG.md', '# Changelog\n\n## ' + next + '\n\n' + commits + '\n', {
	flag: 'a'
});
await run(['add', 'package.json', 'CHANGELOG.md']);
await run(['commit', '-m', 'chore(release): v' + next]);
await run(['tag', '-a', 'v' + next, '-m', 'v' + next]);
