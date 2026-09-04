import { describe, expect, test } from 'bun:test';
import {
	applyAnswersToManifest,
	buildDatabaseUrl,
	buildPublicHost,
	fillProductBrief,
	isSupportedLocale,
	readEnvValue,
	slugify,
	toDatabaseName,
	upsertEnv,
	validate,
	type BootstrapAnswers
} from '../../scripts/lib/bootstrap';

// Fixtures, not the repository's own files: bootstrap rewrites the manifest and the brief, so a
// test that read them from disk would fail for anyone who has actually run the bootstrap.
const manifestFixture = `schemaVersion: 1

project:
  name: 'golden-svelte-platform'
  displayName: 'Golden Svelte Platform'
  description: 'A governed Svelte 5 application platform.'

platform:
  scaffoldVersion: '1.0.0'
  profile: 'operations'
  features:
    auth: true
    rbac: true
    postgres: true
    telemetry: true
    docker: true
    i18n: true
    themes: true
    releases: true

domain:
  boundedContexts:
    - platform
  roles:
    - code: admin
      description: 'Full platform administration'
  entities:
    - user_preference

observability:
  serviceName: 'golden-svelte-platform'
  piiFields: ['email']

delivery:
  dockerComposeProject: 'golden-svelte-platform'
  publicHost: 'golden-svelte-platform.localhost'

experience:
  sourceLocale: 'pt-BR'
  supportedLocales: ['pt-BR', 'en', 'fr', 'es']
  publicRouteStrategy: 'localized'
  privateRouteStrategy: 'user-preference'
  themeDefault: 'system'
  enabledThemes: ['light', 'dark', 'system']

release:
  initialVersion: '0.1.0'
  channel: 'stable'
  commitConvention: 'conventional'
`;

/** The anchors fillProductBrief looks for, in the shape docs/product-brief.md ships with. */
const briefFixture = `# Product brief

## 1. Summary

_One paragraph: what this product is, who operates it, and what changes for them once it exists._

- **Product name:** _TBD_
- **Owner:** _TBD_
- **Last reviewed:** _YYYY-MM-DD_
- **Status:** _draft | in review | approved_

## 2. Problem

_What is broken today?_

## 3. Users and roles

_Every role here must exist in \`project.manifest.yaml\`._

## 7. Authorization matrix

## 11. Out of scope
`;

const answers: BootstrapAnswers = {
	slug: 'acme-portal',
	displayName: 'Acme Portal',
	description: 'Portal interno para operações da Acme.',
	primaryUser: 'Analista de operações',
	databaseName: 'acme_portal',
	databasePort: 5544,
	sourceLocale: 'en'
};

describe('slug derivation', () => {
	test('turns free text into a manifest-safe slug', () => {
		expect(slugify('Acme Portal')).toBe('acme-portal');
		expect(slugify('  Painel de Operações  ')).toBe('painel-de-operacoes');
		expect(slugify('Foo -- Bar!!')).toBe('foo-bar');
	});

	test('derives the database name and public host from the slug', () => {
		expect(toDatabaseName('acme-portal')).toBe('acme_portal');
		expect(buildPublicHost('acme-portal')).toBe('acme-portal.localhost');
	});

	test('produces slugs the manifest schema accepts', () => {
		expect(validate.slug(slugify('Acme Portal'))).toBeNull();
		expect(validate.slug('Acme Portal')).not.toBeNull();
		expect(validate.slug('9lives')).not.toBeNull();
	});
});

describe('answer validation', () => {
	test('enforces the manifest limits', () => {
		expect(validate.description('curta')).not.toBeNull();
		expect(validate.description(answers.description)).toBeNull();
		expect(validate.displayName('A')).not.toBeNull();
		expect(validate.databaseName('acme-portal')).not.toBeNull();
		expect(validate.databaseName('acme_portal')).toBeNull();
		expect(validate.databasePort('0')).not.toBeNull();
		expect(validate.databasePort('70000')).not.toBeNull();
		expect(validate.databasePort('5544')).toBeNull();
	});

	test('recognises only the four platform locales', () => {
		expect(isSupportedLocale('en')).toBe(true);
		expect(isSupportedLocale('de')).toBe(false);
	});
});

describe('manifest generation', () => {
	const manifestYaml = manifestFixture;

	test('writes the answers and keeps the identity fields aligned', () => {
		const { yaml, manifest } = applyAnswersToManifest(manifestYaml, answers);
		expect(manifest.project.name).toBe('acme-portal');
		expect(manifest.project.displayName).toBe('Acme Portal');
		expect(manifest.experience.sourceLocale).toBe('en');
		// The schema requires these to equal project.name, so they are derived, never asked for.
		expect(manifest.observability.serviceName).toBe('acme-portal');
		expect(manifest.delivery.dockerComposeProject).toBe('acme-portal');
		expect(manifest.delivery.publicHost).toBe('acme-portal.localhost');
		expect(yaml).toContain('acme-portal');
	});

	test('preserves sections the bootstrap does not touch', () => {
		const { yaml } = applyAnswersToManifest(manifestYaml, answers);
		expect(yaml).toContain('schemaVersion: 1');
		expect(yaml).toContain('user_preference');
		expect(yaml).toContain('code: admin');
		expect(yaml).toContain('supportedLocales:');
	});

	test('rejects answers the platform schema would refuse', () => {
		expect(() =>
			applyAnswersToManifest(manifestYaml, { ...answers, slug: 'Not A Slug' })
		).toThrow();
	});
});

describe('product brief filling', () => {
	const template = briefFixture;

	test('fills the summary and the primary user', () => {
		const result = fillProductBrief(template, answers, '2026-09-04');
		expect(result.skipped).toEqual([]);
		expect(result.content).toContain('- **Product name:** Acme Portal');
		expect(result.content).toContain('- **Last reviewed:** 2026-09-04');
		expect(result.content).toContain('- **Status:** draft');
		expect(result.content).toContain('Portal interno para operações da Acme.');
		expect(result.content).toContain('- **Primary target user:** Analista de operações');
	});

	test('keeps the untouched sections of the template', () => {
		const result = fillProductBrief(template, answers, '2026-09-04');
		expect(result.content).toContain('## 7. Authorization matrix');
		expect(result.content).toContain('## 11. Out of scope');
	});

	test('reports sections it could not find instead of rewriting them', () => {
		const result = fillProductBrief('# Brief\n\nAlready written by hand.\n', answers, '2026-09-04');
		expect(result.filled).toEqual([]);
		expect(result.skipped.length).toBeGreaterThan(0);
		expect(result.content).toBe('# Brief\n\nAlready written by hand.\n');
	});
});

describe('environment files', () => {
	test('updates a key in place and preserves comments and other keys', () => {
		const before = '# comment\nPOSTGRES_DB=old\nPOSTGRES_USER=app\n';
		const after = upsertEnv(before, { POSTGRES_DB: 'acme_portal' });
		expect(after).toBe('# comment\nPOSTGRES_DB=acme_portal\nPOSTGRES_USER=app\n');
	});

	test('appends keys that are not present yet', () => {
		expect(upsertEnv('POSTGRES_DB=x\n', { POSTGRES_PORT: '5544' })).toBe(
			'POSTGRES_DB=x\nPOSTGRES_PORT=5544\n'
		);
	});

	test('never rewrites an unrelated secret', () => {
		const before = 'BETTER_AUTH_SECRET=keep-me\nPOSTGRES_DB=old\n';
		expect(upsertEnv(before, { POSTGRES_DB: 'new' })).toContain('BETTER_AUTH_SECRET=keep-me');
	});

	test('reads values while ignoring comments', () => {
		expect(readEnvValue('# POSTGRES_USER=ghost\nPOSTGRES_USER=app\n', 'POSTGRES_USER')).toBe('app');
		expect(readEnvValue('POSTGRES_USER="quoted"\n', 'POSTGRES_USER')).toBe('quoted');
		expect(readEnvValue('OTHER=1\n', 'POSTGRES_USER')).toBeUndefined();
	});

	test('builds a database url that escapes credentials', () => {
		expect(
			buildDatabaseUrl({
				user: 'app',
				password: 'p@ss word',
				host: 'localhost',
				port: 5544,
				database: 'acme_portal'
			})
		).toBe('postgres://app:p%40ss%20word@localhost:5544/acme_portal');
	});
});
