import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { manifestSchema, type ProjectManifest } from './lib/manifest';

const SCAFFOLD_KIND = 'golden-svelte-platform';
const SCAFFOLD_SCHEMA_VERSION = 1;

type ActivationOptions = {
	root: string;
	manifestPath: string;
	dryRun: boolean;
	force: boolean;
};

type JsonRecord = Record<string, unknown>;

function usage(): string {
	return `Uso:
  bun run scripts/activate.ts -- --manifest project.manifest.yaml [--root .] [--dry-run] [--force]

Opções:
  --manifest <arquivo>  Manifesto YAML validado pelo Golden Scaffold.
  --root <diretório>    Diretório raiz do clone do Golden Scaffold. Padrão: diretório atual.
  --dry-run             Exibe os arquivos que seriam gerados sem escrever no disco.
  --force               Atualiza somente artefatos gerados; nunca apaga arquivos de domínio.
  --help                Exibe esta ajuda.`;
}

function parseArgs(argv: string[]): ActivationOptions {
	const options: ActivationOptions = {
		root: process.cwd(),
		manifestPath: 'project.manifest.yaml',
		dryRun: false,
		force: false
	};

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--help' || argument === '-h') {
			console.log(usage());
			process.exit(0);
		}
		if (argument === '--dry-run') {
			options.dryRun = true;
			continue;
		}
		if (argument === '--force') {
			options.force = true;
			continue;
		}
		if (argument === '--root' || argument === '--manifest') {
			const value = argv[index + 1];
			if (!value || value.startsWith('--')) {
				throw new Error(`A opção ${argument} exige um valor.`);
			}
			if (argument === '--root') options.root = value;
			if (argument === '--manifest') options.manifestPath = value;
			index += 1;
			continue;
		}
		throw new Error(`Opção desconhecida: ${argument}`);
	}

	options.root = resolve(options.root);
	options.manifestPath = resolve(options.root, options.manifestPath);
	return options;
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

function humanPath(root: string, path: string): string {
	const localPath = relative(root, path);
	return localPath.length === 0 ? '.' : localPath;
}

function normalizeText(value: string): string {
	return value.trim().replace(/\r\n/g, '\n');
}

function detectSensitiveKeys(value: unknown, path: string[] = []): string[] {
	const forbiddenKey =
		/(?:^|[_-])(secret|token|password|passwd|private[_-]?key|api[_-]?key)(?:$|[_-])/i;
	if (Array.isArray(value)) {
		return value.flatMap((entry, index) => detectSensitiveKeys(entry, [...path, String(index)]));
	}
	if (value && typeof value === 'object') {
		return Object.entries(value as JsonRecord).flatMap(([key, nestedValue]) => {
			const nestedPath = [...path, key];
			return forbiddenKey.test(key)
				? [nestedPath.join('.')]
				: detectSensitiveKeys(nestedValue, nestedPath);
		});
	}
	return [];
}

async function loadManifest(path: string): Promise<{ manifest: ProjectManifest; raw: string }> {
	if (!(await exists(path))) {
		throw new Error(
			`Manifesto não encontrado: ${path}\n` +
				'Crie-o a partir do exemplo antes de ativar:\n' +
				'  cp project.manifest.example.yaml project.manifest.yaml\n' +
				'  # edite nome, domínio, papéis e entidades\n' +
				'  bun run scaffold:plan\n' +
				'  bun run scaffold:activate'
		);
	}
	const raw = normalizeText(await readFile(path, 'utf8'));
	const parsed = parseYaml(raw);
	const secretPaths = detectSensitiveKeys(parsed);
	if (secretPaths.length > 0) {
		throw new Error(
			`O manifesto não pode conter segredos. Chaves proibidas: ${secretPaths.join(', ')}`
		);
	}
	const result = manifestSchema.safeParse(parsed);
	if (!result.success) {
		const details = result.error.issues
			.map((issue) => `- ${issue.path.join('.') || 'manifest'}: ${issue.message}`)
			.join('\n');
		throw new Error(`Manifesto inválido:\n${details}`);
	}
	return { manifest: result.data, raw };
}

async function assertGoldenScaffold(root: string): Promise<void> {
	const markerPath = join(root, '.scaffold', 'template.json');
	if (!(await exists(markerPath))) {
		throw new Error(
			`Este diretório não contém o marcador ${humanPath(root, markerPath)} do Golden Scaffold.`
		);
	}
	const marker = JSON.parse(await readFile(markerPath, 'utf8')) as JsonRecord;
	if (marker.kind !== SCAFFOLD_KIND || marker.schemaVersion !== SCAFFOLD_SCHEMA_VERSION) {
		throw new Error('O marcador do scaffold é incompatível com esta versão do ativador.');
	}
}

class Writer {
	readonly actions: string[] = [];

	constructor(
		private readonly root: string,
		private readonly dryRun: boolean
	) {}

	async text(
		path: string,
		content: string,
		options: { overwrite?: boolean; executable?: boolean } = {}
	): Promise<void> {
		const overwrite = options.overwrite ?? true;
		const alreadyExists = await exists(path);
		if (alreadyExists && !overwrite) {
			this.actions.push(`preservar ${humanPath(this.root, path)}`);
			return;
		}
		this.actions.push(`${alreadyExists ? 'atualizar' : 'criar'} ${humanPath(this.root, path)}`);
		if (this.dryRun) return;
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, content, 'utf8');
		if (options.executable) await chmod(path, 0o755);
	}

	async json(path: string, value: unknown, options: { overwrite?: boolean } = {}): Promise<void> {
		await this.text(path, `${JSON.stringify(value, null, 2)}\n`, options);
	}
}

function localizedCatalog(locale: 'pt-BR' | 'en' | 'fr' | 'es', appName: string): JsonRecord {
	const common = {
		$schema: 'https://inlang.com/schema/inlang-message-format',
		app_name: appName,
		app_loading:
			locale === 'pt-BR'
				? 'Carregando…'
				: locale === 'en'
					? 'Loading…'
					: locale === 'fr'
						? 'Chargement…'
						: 'Cargando…',
		theme_toggle_label:
			locale === 'pt-BR'
				? 'Alterar tema'
				: locale === 'en'
					? 'Change theme'
					: locale === 'fr'
						? 'Changer le thème'
						: 'Cambiar tema',
		theme_mode_light:
			locale === 'pt-BR'
				? 'Claro'
				: locale === 'en'
					? 'Light'
					: locale === 'fr'
						? 'Clair'
						: 'Claro',
		theme_mode_dark:
			locale === 'pt-BR'
				? 'Escuro'
				: locale === 'en'
					? 'Dark'
					: locale === 'fr'
						? 'Sombre'
						: 'Oscuro',
		theme_mode_system:
			locale === 'pt-BR'
				? 'Sistema'
				: locale === 'en'
					? 'System'
					: locale === 'fr'
						? 'Système'
						: 'Sistema'
	};
	const translations: Record<typeof locale, JsonRecord> = {
		'pt-BR': {
			auth_sign_in_title: 'Acesse sua conta',
			validation_required: '{field} é obrigatório',
			errors_generic: 'Não foi possível concluir esta ação. Tente novamente.'
		},
		en: {
			auth_sign_in_title: 'Sign in to your account',
			validation_required: '{field} is required',
			errors_generic: 'We could not complete this action. Please try again.'
		},
		fr: {
			auth_sign_in_title: 'Accédez à votre compte',
			validation_required: '{field} est obligatoire',
			errors_generic: 'Nous n’avons pas pu effectuer cette action. Veuillez réessayer.'
		},
		es: {
			auth_sign_in_title: 'Accede a tu cuenta',
			validation_required: '{field} es obligatorio',
			errors_generic: 'No pudimos completar esta acción. Inténtalo de nuevo.'
		}
	};
	return { ...common, ...translations[locale] };
}

function buildProjectConfig(manifest: ProjectManifest): string {
	return `/** Generated by scripts/activate.ts. Edit project.manifest.yaml and reactivate instead. */
export const projectConfig = {
  name: ${JSON.stringify(manifest.project.name)},
  displayName: ${JSON.stringify(manifest.project.displayName)},
  description: ${JSON.stringify(manifest.project.description)},
  version: ${JSON.stringify(manifest.release.initialVersion)},
  locales: ${JSON.stringify(manifest.experience.supportedLocales)} as const,
  sourceLocale: ${JSON.stringify(manifest.experience.sourceLocale)},
  themeDefault: ${JSON.stringify(manifest.experience.themeDefault)},
  serviceName: ${JSON.stringify(manifest.observability.serviceName)},
} as const;

export type SupportedLocale = (typeof projectConfig.locales)[number];
`;
}

function buildThemeConfig(manifest: ProjectManifest): string {
	return `/** Generated by scripts/activate.ts. */
export const themeConfig = {
  defaultMode: ${JSON.stringify(manifest.experience.themeDefault)},
  enabledModes: ${JSON.stringify(manifest.experience.enabledThemes)} as const,
  cookieName: "${manifest.project.name}_theme",
} as const;

export type ThemeMode = (typeof themeConfig.enabledModes)[number];
`;
}

function buildDevScript(): string {
	return `#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "\${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
env_file="\${ENV_FILE:-.env.dev}"

[[ -f "$env_file" ]] || {
  printf 'Arquivo %s ausente. Copie .env.dev.example e preencha apenas valores locais.\\n' "$env_file" >&2
  exit 1
}

exec docker compose \\
  --env-file "$env_file" \\
  -f compose.yaml \\
  -f compose.dev.yaml \\
  up --build --remove-orphans "$@"
`;
}

function buildProdScript(): string {
	return `#!/usr/bin/env bash
set -Eeuo pipefail

[[ "\${1:-}" == "--confirm" ]] || {
  printf 'Uso: ./scripts/prod.sh --confirm\\n' >&2
  exit 2
}

root="$(cd -- "$(dirname -- "\${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
env_file="\${ENV_FILE:-.env.prod}"

[[ -f "$env_file" ]] || {
  printf 'Arquivo %s ausente. Defina ENV_FILE ou configure o arquivo de produção no host de deploy.\\n' "$env_file" >&2
  exit 1
}

compose=(docker compose --env-file "$env_file" -f compose.yaml -f compose.prod.yaml)
"\${compose[@]}" config --quiet
"\${compose[@]}" pull
"\${compose[@]}" run --rm migrate
"\${compose[@]}" up -d --wait --remove-orphans
"\${compose[@]}" ps
`;
}

function buildDevEnvironment(manifest: ProjectManifest): string {
	return `# Local-only configuration. Copy to .env.dev; never commit real secrets.
COMPOSE_PROJECT_NAME=${manifest.delivery.dockerComposeProject}
APP_NAME=${manifest.project.name}
APP_VERSION=${manifest.release.initialVersion}
PUBLIC_APP_URL=http://${manifest.delivery.publicHost}
POSTGRES_DB=${manifest.project.name.replace(/-/g, '_')}
POSTGRES_USER=app
POSTGRES_PASSWORD=change-me-locally
BETTER_AUTH_SECRET=change-me-with-a-local-random-value
OTEL_SERVICE_NAME=${manifest.observability.serviceName}
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
`;
}

function buildProdEnvironment(manifest: ProjectManifest): string {
	return `# Contract only. Store actual production values in the deployment secret manager or host.
COMPOSE_PROJECT_NAME=${manifest.delivery.dockerComposeProject}
APP_NAME=${manifest.project.name}
APP_VERSION=${manifest.release.initialVersion}
APP_IMAGE=registry.example.com/${manifest.project.name}:${manifest.release.initialVersion}
PUBLIC_APP_URL=https://REPLACE_WITH_PUBLIC_HOST
POSTGRES_DB=${manifest.project.name.replace(/-/g, '_')}
POSTGRES_USER=app
POSTGRES_PASSWORD=REPLACE_WITH_SECRET
BETTER_AUTH_SECRET=REPLACE_WITH_SECRET
OTEL_SERVICE_NAME=${manifest.observability.serviceName}
OTEL_EXPORTER_OTLP_ENDPOINT=https://REPLACE_WITH_OTLP_ENDPOINT
`;
}

function buildProjectBrief(manifest: ProjectManifest): string {
	const roles = manifest.domain.roles
		.map((role) => `| \`${role.code}\` | ${role.description} |`)
		.join('\n');
	return `# ${manifest.project.displayName}

${manifest.project.description}

## Contextos de domínio

${manifest.domain.boundedContexts.map((context) => `- \`${context}\``).join('\n')}

## Papéis

| Papel | Responsabilidade |
| --- | --- |
${roles}

## Regras de plataforma

Este projeto foi ativado a partir do Golden Scaffold. Bun, Svelte 5, Tailwind, Drizzle/PostgreSQL, Better Auth/RBAC, OpenTelemetry, Docker, Paraglide e os quatro idiomas são contratos de plataforma.
`;
}

function buildPackageJson(manifest: ProjectManifest, current: JsonRecord): JsonRecord {
	const currentScripts =
		typeof current.scripts === 'object' && current.scripts !== null
			? (current.scripts as JsonRecord)
			: {};
	return {
		...current,
		name: manifest.project.name,
		version: manifest.release.initialVersion,
		description: manifest.project.description,
		private: current.private ?? true,
		packageManager: current.packageManager ?? `bun@${Bun.version}`,
		scripts: {
			...currentScripts,
			'scaffold:activate': 'bun run scripts/activate.ts -- --manifest project.manifest.yaml',
			'scaffold:plan': 'bun run scripts/activate.ts -- --manifest project.manifest.yaml --dry-run',
			'scaffold:refresh': 'bun run scripts/activate.ts -- --manifest project.manifest.yaml --force',
			'dev:containers': './scripts/dev.sh',
			'prod:up': './scripts/prod.sh --confirm',
			'i18n:check': 'bun run scripts/check-locales.ts',
			verify: currentScripts.verify ?? 'bun run check && bun run test && bun run i18n:check'
		}
	};
}

async function runProjectCommand(
	root: string,
	command: string[],
	description: string
): Promise<void> {
	const process = Bun.spawn(command, { cwd: root, stdout: 'inherit', stderr: 'inherit' });
	if ((await process.exited) !== 0) {
		throw new Error(`${description} falhou.`);
	}
}

async function loadPackageJson(path: string): Promise<JsonRecord> {
	if (!(await exists(path))) return {};
	try {
		return JSON.parse(await readFile(path, 'utf8')) as JsonRecord;
	} catch {
		throw new Error(`package.json inválido: ${path}`);
	}
}

async function activate(options: ActivationOptions): Promise<void> {
	await assertGoldenScaffold(options.root);
	const { manifest, raw } = await loadManifest(options.manifestPath);
	const writer = new Writer(options.root, options.dryRun);
	const statePath = join(options.root, '.scaffold', 'project.json');

	if ((await exists(statePath)) && !options.force) {
		throw new Error(
			'Este scaffold já foi ativado. Use --force somente para regenerar artefatos de plataforma intencionalmente.'
		);
	}

	const packagePath = join(options.root, 'package.json');
	const packageJson = await loadPackageJson(packagePath);
	const activatedAt = new Date().toISOString();
	const manifestSha256 = createHash('sha256').update(raw).digest('hex');

	await writer.json(packagePath, buildPackageJson(manifest, packageJson));
	await writer.json(join(options.root, '.scaffold', 'project.json'), {
		kind: SCAFFOLD_KIND,
		schemaVersion: SCAFFOLD_SCHEMA_VERSION,
		scaffoldVersion: manifest.platform.scaffoldVersion,
		projectName: manifest.project.name,
		activatedAt,
		manifestSha256
	});
	await writer.text(
		join(options.root, 'src', 'lib', 'config', 'project.ts'),
		buildProjectConfig(manifest)
	);
	await writer.text(
		join(options.root, 'src', 'lib', 'theme', 'config.ts'),
		buildThemeConfig(manifest)
	);
	await writer.json(join(options.root, 'project.inlang', 'settings.json'), {
		$schema: 'https://inlang.com/schema/project-settings',
		modules: [
			'https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@4/dist/index.js',
			'https://cdn.jsdelivr.net/npm/@inlang/plugin-m-function-matcher@2/dist/index.js'
		],
		'plugin.inlang.messageFormat': { pathPattern: './messages/{locale}.json' },
		baseLocale: manifest.experience.sourceLocale,
		locales: manifest.experience.supportedLocales
	});

	for (const locale of manifest.experience.supportedLocales) {
		await writer.json(
			join(options.root, 'messages', `${locale}.json`),
			localizedCatalog(locale, manifest.project.displayName),
			{
				overwrite: false
			}
		);
	}

	await writer.text(join(options.root, '.env.dev.example'), buildDevEnvironment(manifest), {
		overwrite: options.force
	});
	await writer.text(join(options.root, '.env.prod.example'), buildProdEnvironment(manifest), {
		overwrite: options.force
	});
	await writer.text(join(options.root, 'scripts', 'dev.sh'), buildDevScript(), {
		overwrite: options.force,
		executable: true
	});
	await writer.text(join(options.root, 'scripts', 'prod.sh'), buildProdScript(), {
		overwrite: options.force,
		executable: true
	});
	await writer.text(join(options.root, 'docs', 'product-brief.md'), buildProjectBrief(manifest), {
		overwrite: options.force
	});

	if (!options.dryRun) {
		await runProjectCommand(
			options.root,
			[
				'bun',
				'x',
				'paraglide-js',
				'compile',
				'--project',
				'./project.inlang',
				'--outdir',
				'./src/lib/paraglide'
			],
			'A compilação do Paraglide'
		);
		await runProjectCommand(options.root, ['bun', 'run', 'format'], 'A formatação do projeto');
	}

	const mode = options.dryRun
		? 'Plano de ativação (nenhum arquivo foi escrito)'
		: 'Ativação concluída';
	console.log(
		`${mode}: ${manifest.project.displayName}\n${writer.actions.map((action) => `  • ${action}`).join('\n')}`
	);
}

try {
	await activate(parseArgs(Bun.argv.slice(2)));
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Falha na ativação: ${message}`);
	process.exit(1);
}
