import { parseDocument } from 'yaml';
import { manifestSchema, type ProjectManifest } from './manifest';

export const supportedLocales = ['pt-BR', 'en', 'fr', 'es'] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

export type BootstrapAnswers = {
	slug: string;
	displayName: string;
	description: string;
	primaryUser: string;
	databaseName: string;
	databasePort: number;
	sourceLocale: SupportedLocale;
	/** Optional path to a PNG/SVG logo the brand palette is generated from. */
	logoPath?: string;
	/** The colour extracted from that logo, as #rrggbb. */
	seedColor?: string;
};

const accents: Record<string, string> = { ç: 'c', ñ: 'n', ß: 'ss' };

/** Converts free text into a manifest-safe project slug. */
export function slugify(value: string): string {
	const normalized = value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[çñß]/g, (match) => accents[match] ?? match);
	return normalized
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-')
		.slice(0, 63);
}

/** PostgreSQL identifiers cannot carry hyphens, so the slug becomes snake_case. */
export function toDatabaseName(slug: string): string {
	return slug.replace(/-/g, '_');
}

export function buildPublicHost(slug: string): string {
	return `${slug}.localhost`;
}

export function buildDatabaseUrl(options: {
	user: string;
	password: string;
	host: string;
	port: number;
	database: string;
}): string {
	const credentials = `${encodeURIComponent(options.user)}:${encodeURIComponent(options.password)}`;
	return `postgres://${credentials}@${options.host}:${options.port}/${options.database}`;
}

/** Each validator returns an error message, in the language of the CLI, or null when valid. */
export const validate = {
	slug(value: string): string | null {
		if (!/^[a-z][a-z0-9-]{1,62}$/.test(value)) {
			return 'Use kebab-case, começando com letra, de 2 a 63 caracteres.';
		}
		return null;
	},
	displayName(value: string): string | null {
		const trimmed = value.trim();
		if (trimmed.length < 2 || trimmed.length > 120) return 'Use de 2 a 120 caracteres.';
		return null;
	},
	description(value: string): string | null {
		const trimmed = value.trim();
		if (trimmed.length < 12 || trimmed.length > 500) return 'Use de 12 a 500 caracteres.';
		return null;
	},
	primaryUser(value: string): string | null {
		const trimmed = value.trim();
		if (trimmed.length < 3 || trimmed.length > 180) return 'Use de 3 a 180 caracteres.';
		return null;
	},
	databaseName(value: string): string | null {
		if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
			return 'Use letras minúsculas, dígitos e underscore, começando com letra ou underscore.';
		}
		return null;
	},
	logoPath(value: string): string | null {
		if (value.length === 0) return null;
		if (!/\.(svg|png)$/i.test(value)) return 'Use um arquivo .svg ou .png.';
		return null;
	},
	databasePort(value: string): string | null {
		const port = Number(value);
		if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Use uma porta de 1 a 65535.';
		return null;
	}
};

export function isSupportedLocale(value: string): value is SupportedLocale {
	return (supportedLocales as readonly string[]).includes(value);
}

/**
 * Writes the answers into the manifest while preserving every untouched line, then validates the
 * result against the platform schema. `serviceName` and `dockerComposeProject` must equal
 * `project.name`, so they are derived rather than asked for.
 */
export function applyAnswersToManifest(
	manifestYaml: string,
	answers: BootstrapAnswers
): { yaml: string; manifest: ProjectManifest } {
	const document = parseDocument(manifestYaml);
	if (document.errors.length > 0) {
		throw new Error(`project.manifest.yaml inválido: ${document.errors[0].message}`);
	}

	document.setIn(['project', 'name'], answers.slug);
	document.setIn(['project', 'displayName'], answers.displayName.trim());
	document.setIn(['project', 'description'], answers.description.trim());
	document.setIn(['observability', 'serviceName'], answers.slug);
	document.setIn(['delivery', 'dockerComposeProject'], answers.slug);
	document.setIn(['delivery', 'publicHost'], buildPublicHost(answers.slug));
	document.setIn(['experience', 'sourceLocale'], answers.sourceLocale);
	if (answers.logoPath && answers.seedColor) {
		document.setIn(['experience', 'brand', 'logo'], answers.logoPath);
		document.setIn(['experience', 'brand', 'seedColor'], answers.seedColor);
	}

	const result = manifestSchema.safeParse(document.toJS());
	if (!result.success) {
		const details = result.error.issues
			.map((issue) => `- ${issue.path.join('.') || 'manifest'}: ${issue.message}`)
			.join('\n');
		throw new Error(`O manifesto gerado é inválido:\n${details}`);
	}

	return { yaml: document.toString(), manifest: result.data };
}

export type BriefFillResult = { content: string; filled: string[]; skipped: string[] };

/**
 * Fills the answers into the product brief template. Replacements are exact and optional: a
 * section that has already been edited by hand is reported as skipped instead of being rewritten.
 */
export function fillProductBrief(
	template: string,
	answers: BootstrapAnswers,
	today: string
): BriefFillResult {
	const replacements: { section: string; find: string; replace: string }[] = [
		{
			section: 'Summary/description',
			find: '_One paragraph: what this product is, who operates it, and what changes for them once it exists._',
			replace: answers.description.trim()
		},
		{
			section: 'Summary/product name',
			find: '- **Product name:** _TBD_',
			replace: `- **Product name:** ${answers.displayName.trim()}`
		},
		{
			section: 'Summary/last reviewed',
			find: '- **Last reviewed:** _YYYY-MM-DD_',
			replace: `- **Last reviewed:** ${today}`
		},
		{
			section: 'Summary/status',
			find: '- **Status:** _draft | in review | approved_',
			replace: '- **Status:** draft'
		},
		{
			section: 'Users/primary target user',
			find: '## 3. Users and roles\n',
			replace: `## 3. Users and roles\n\n- **Primary target user:** ${answers.primaryUser.trim()}\n`
		}
	];

	let content = template;
	const filled: string[] = [];
	const skipped: string[] = [];

	for (const { section, find, replace } of replacements) {
		if (content.includes(find)) {
			content = content.replace(find, replace);
			filled.push(section);
		} else {
			skipped.push(section);
		}
	}

	return { content, filled, skipped };
}

/**
 * Sets each key in a dotenv file, preserving comments, ordering, and every key not listed.
 * Missing keys are appended.
 */
export function upsertEnv(content: string, values: Record<string, string>): string {
	const lines = content.length === 0 ? [] : content.replace(/\r\n/g, '\n').split('\n');
	const pending = new Map(Object.entries(values));

	const updated = lines.map((line) => {
		const match = /^(\s*)([A-Z_][A-Z0-9_]*)=/.exec(line);
		if (!match) return line;
		const key = match[2];
		if (!pending.has(key)) return line;
		const value = pending.get(key) as string;
		pending.delete(key);
		return `${match[1]}${key}=${value}`;
	});

	while (updated.length > 0 && updated[updated.length - 1].trim() === '') updated.pop();
	for (const [key, value] of pending) updated.push(`${key}=${value}`);

	return `${updated.join('\n')}\n`;
}

/** Reads a value from a dotenv file, ignoring comments. */
export function readEnvValue(content: string, key: string): string | undefined {
	for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
		if (/^\s*#/.test(line)) continue;
		const match = new RegExp(`^\\s*${key}=(.*)$`).exec(line);
		if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
	}
	return undefined;
}
