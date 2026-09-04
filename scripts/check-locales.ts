import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const EXPECTED_LOCALES = ['pt-BR', 'en', 'fr', 'es'] as const;

function flatten(value: unknown, prefix = ''): Map<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return new Map([[prefix, value]]);
	}
	return Object.entries(value as Record<string, unknown>).reduce((entries, [key, nestedValue]) => {
		const nestedPrefix = prefix ? `${prefix}.${key}` : key;
		for (const [nestedKey, entry] of flatten(nestedValue, nestedPrefix))
			entries.set(nestedKey, entry);
		return entries;
	}, new Map<string, unknown>());
}

const root = process.cwd();
const messagesDir = join(root, 'messages');
const names = await readdir(messagesDir);
const unexpected = names.filter(
	(name) =>
		name.endsWith('.json') &&
		!EXPECTED_LOCALES.includes(name.replace(/\.json$/, '') as (typeof EXPECTED_LOCALES)[number])
);
if (unexpected.length > 0) throw new Error(`Catálogos inesperados: ${unexpected.join(', ')}`);

const catalogs = new Map<string, Map<string, unknown>>();
for (const locale of EXPECTED_LOCALES) {
	const path = join(messagesDir, `${locale}.json`);
	const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
	catalogs.set(locale, flatten(raw));
}

const reference = catalogs.get('pt-BR')!;
const errors: string[] = [];
for (const locale of EXPECTED_LOCALES.filter((value) => value !== 'pt-BR')) {
	const catalog = catalogs.get(locale)!;
	const missing = [...reference.keys()].filter((key) => !catalog.has(key));
	const extra = [...catalog.keys()].filter((key) => !reference.has(key));
	if (missing.length > 0) errors.push(`${locale}: faltam ${missing.join(', ')}`);
	if (extra.length > 0) errors.push(`${locale}: sobram ${extra.join(', ')}`);
}

if (errors.length > 0)
	throw new Error(`i18n inválido:\n${errors.map((error) => `- ${error}`).join('\n')}`);
console.log(`i18n válido: ${reference.size} chave(s) em ${EXPECTED_LOCALES.join(', ')}.`);
