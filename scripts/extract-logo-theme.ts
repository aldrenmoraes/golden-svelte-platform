import { readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { parseHex } from './lib/color';
import { extractLogoSeed } from './lib/logo';
import { AA_CONTRAST, buildPalette, contrastReport, renderPaletteCss } from './lib/palette';

type Options = { logo?: string; color?: string; out: string; root: string; dryRun: boolean };

export const defaultPalettePath = join('src', 'lib', 'theme', 'palette.css');

function usage(): string {
	return `Uso:
  bun run theme:logo -- --logo static/logo.svg
  bun run theme:logo -- --color '#2563eb'

Opções:
  --logo <arquivo>  Logo .svg ou .png de onde extrair a cor da marca.
  --color <hex>     Usa uma cor de marca explícita em vez de um logo.
  --out <arquivo>   Destino do CSS gerado. Padrão: ${defaultPalettePath}.
  --dry-run         Mostra o resultado sem escrever o arquivo.
  --help            Exibe esta ajuda.`;
}

export function parseArgs(argv: string[]): Options {
	const options: Options = { out: defaultPalettePath, root: process.cwd(), dryRun: false };
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--help' || argument === '-h') {
			console.log(usage());
			process.exit(0);
		} else if (argument === '--dry-run') {
			options.dryRun = true;
		} else if (argument === '--logo' || argument === '--color' || argument === '--out') {
			const value = argv[index + 1];
			if (!value || value.startsWith('--')) throw new Error(`A opção ${argument} exige um valor.`);
			if (argument === '--logo') options.logo = value;
			if (argument === '--color') options.color = value;
			if (argument === '--out') options.out = value;
			index += 1;
		} else {
			throw new Error(`Opção desconhecida: ${argument}`);
		}
	}
	if (!options.logo && !options.color) throw new Error('Informe --logo ou --color.');
	return options;
}

export type GenerationResult = { seedHex: string; outPath: string; css: string; source: string };

/** Extracts the seed colour, builds the palette and writes the stylesheet. */
export async function generateTheme(options: Options): Promise<GenerationResult> {
	let seedHex: string;
	let source: string;

	if (options.color) {
		const parsed = parseHex(options.color);
		if (!parsed) throw new Error(`Cor inválida: ${options.color} (use #rgb ou #rrggbb).`);
		seedHex = options.color;
		source = `cor ${options.color}`;
	} else {
		const logoPath = resolve(options.root, options.logo as string);
		const contents = await readFile(logoPath);
		const seed = extractLogoSeed(logoPath, contents);
		seedHex = seed.hex;
		source = `${options.logo} — ${seed.source.toUpperCase()}, ${seed.sampled} amostras`;
	}

	const rgb = parseHex(seedHex);
	if (!rgb) throw new Error(`Cor inválida: ${seedHex}`);
	const palette = buildPalette(rgb);
	const css = renderPaletteCss(palette, { logo: options.logo });
	const outPath = resolve(options.root, options.out);

	if (!options.dryRun) await writeFile(outPath, css, 'utf8');

	const failures = contrastReport(palette).filter((entry) => entry.ratio < AA_CONTRAST);
	if (failures.length > 0) {
		throw new Error(
			`A paleta gerada não atinge WCAG AA em: ${failures
				.map((entry) => `${entry.pair} (${entry.ratio}:1)`)
				.join(', ')}`
		);
	}

	return { seedHex: palette.seedHex, outPath, css, source };
}

if (import.meta.main) {
	try {
		const options = parseArgs(Bun.argv.slice(2));
		const result = await generateTheme(options);
		const palette = buildPalette(parseHex(result.seedHex) ?? { r: 0, g: 0, b: 0 });
		console.log(`Cor da marca: ${result.seedHex}  (origem: ${result.source})`);
		console.log(
			`Contraste WCAG:\n${contrastReport(palette)
				.map((entry) => `  • ${entry.pair}: ${entry.ratio}:1`)
				.join('\n')}`
		);
		console.log(
			options.dryRun
				? `Prévia gerada (nenhum arquivo escrito) para ${options.out}.`
				: `Tema escrito em ${relative(options.root, result.outPath)}.`
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Falha na geração do tema: ${message}`);
		process.exit(1);
	}
}
