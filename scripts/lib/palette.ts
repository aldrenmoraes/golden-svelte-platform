import {
	contrastRatioOklch,
	ensureContrast,
	formatOklch,
	oklchToRgb,
	rgbToOklch,
	toDisplayableOklch,
	type Oklch,
	type Rgb
} from './color';

/** WCAG AA for body text. Every generated text token is checked against its own surface. */
export const AA_CONTRAST = 4.5;

export const primarySteps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

/** Lightness ramp for the brand scale, and how much of the seed chroma each step keeps. */
const primaryRamp: Record<number, { l: number; chroma: number }> = {
	50: { l: 0.971, chroma: 0.14 },
	100: { l: 0.936, chroma: 0.26 },
	200: { l: 0.885, chroma: 0.42 },
	300: { l: 0.808, chroma: 0.62 },
	400: { l: 0.712, chroma: 0.84 },
	500: { l: 0.637, chroma: 1 },
	600: { l: 0.567, chroma: 1 },
	700: { l: 0.492, chroma: 0.92 },
	800: { l: 0.415, chroma: 0.8 },
	900: { l: 0.349, chroma: 0.68 },
	950: { l: 0.256, chroma: 0.54 }
};

export type ThemeTokens = {
	surfaceBase: Oklch;
	surfaceRaised: Oklch;
	surfaceSunken: Oklch;
	surfaceBorder: Oklch;
	textStrong: Oklch;
	textMuted: Oklch;
	textInverted: Oklch;
	primary: Oklch;
	primaryHover: Oklch;
	primaryContrast: Oklch;
};

export type Palette = {
	seed: Oklch;
	seedHex: string;
	primary: Record<number, Oklch>;
	light: ThemeTokens;
	dark: ThemeTokens;
};

/** Neutrals carry a trace of the brand hue so surfaces feel related to the logo. */
function surface(l: number, hue: number, chroma: number): Oklch {
	return toDisplayableOklch({ l, c: chroma, h: hue });
}

function buildTokens(
	mode: 'light' | 'dark',
	seed: Oklch,
	scale: Record<number, Oklch>
): ThemeTokens {
	const hue = seed.h;
	const isLight = mode === 'light';

	const surfaceBase = isLight ? surface(0.985, hue, 0.004) : surface(0.165, hue, 0.014);
	const surfaceRaised = isLight ? surface(1, hue, 0) : surface(0.213, hue, 0.019);
	const surfaceSunken = isLight ? surface(0.955, hue, 0.007) : surface(0.128, hue, 0.012);
	const surfaceBorder = isLight ? surface(0.885, hue, 0.014) : surface(0.32, hue, 0.024);

	// Text starts from a tinted neutral and is then pushed until it clears AA on its surface.
	const textStrong = ensureContrast(
		surface(isLight ? 0.26 : 0.93, hue, isLight ? 0.02 : 0.011),
		surfaceBase,
		AA_CONTRAST
	);
	const textMuted = ensureContrast(
		surface(isLight ? 0.48 : 0.73, hue, isLight ? 0.026 : 0.022),
		surfaceBase,
		AA_CONTRAST
	);
	const textInverted = ensureContrast(
		surface(isLight ? 0.985 : 0.16, hue, 0.004),
		isLight ? surface(0.26, hue, 0.02) : surface(0.93, hue, 0.011),
		AA_CONTRAST
	);

	const primary = isLight ? scale[600] : scale[400];
	const primaryHover = isLight ? scale[700] : scale[300];
	// Whichever of the two extremes reads better on the brand colour, then nudged to clear AA.
	const onWhite = contrastRatioOklch({ l: 1, c: 0, h: hue }, primary);
	const onBlack = contrastRatioOklch({ l: 0, c: 0, h: hue }, primary);
	const primaryContrast = ensureContrast(
		onWhite >= onBlack ? { l: 0.99, c: 0.002, h: hue } : { l: 0.16, c: 0.01, h: hue },
		primary,
		AA_CONTRAST
	);

	return {
		surfaceBase,
		surfaceRaised,
		surfaceSunken,
		surfaceBorder,
		textStrong,
		textMuted,
		textInverted,
		primary,
		primaryHover,
		primaryContrast
	};
}

/** Builds the whole palette from one brand seed colour. */
export function buildPalette(seedRgb: Rgb): Palette {
	const rawSeed = rgbToOklch(seedRgb);
	// A washed-out or near-black logo colour still has to produce a usable brand scale.
	const seed = { l: rawSeed.l, c: Math.max(rawSeed.c, 0.04), h: rawSeed.h };

	const primary: Record<number, Oklch> = {};
	for (const step of primarySteps) {
		const ramp = primaryRamp[step];
		primary[step] = toDisplayableOklch({ l: ramp.l, c: seed.c * ramp.chroma, h: seed.h });
	}

	return {
		seed,
		seedHex: `#${[seedRgb.r, seedRgb.g, seedRgb.b].map((c) => c.toString(16).padStart(2, '0')).join('')}`,
		primary,
		light: buildTokens('light', seed, primary),
		dark: buildTokens('dark', seed, primary)
	};
}

/** The runtime custom properties, in the order they are written for each mode. */
function modeVariables(tokens: ThemeTokens): [string, Oklch][] {
	return [
		['--brand-surface-base', tokens.surfaceBase],
		['--brand-surface-raised', tokens.surfaceRaised],
		['--brand-surface-sunken', tokens.surfaceSunken],
		['--brand-surface-border', tokens.surfaceBorder],
		['--brand-text-strong', tokens.textStrong],
		['--brand-text-muted', tokens.textMuted],
		['--brand-text-inverted', tokens.textInverted],
		['--brand-primary', tokens.primary],
		['--brand-primary-hover', tokens.primaryHover],
		['--brand-primary-contrast', tokens.primaryContrast]
	];
}

/** Aliases kept so the existing layout stylesheet keeps working unchanged. */
const legacyAliases: [string, string][] = [
	['--surface', '--brand-surface-base'],
	['--surface-raised', '--brand-surface-raised'],
	['--text', '--brand-text-strong'],
	['--muted', '--brand-text-muted'],
	['--border', '--brand-surface-border'],
	['--accent', '--brand-primary']
];

function block(selector: string, tokens: ThemeTokens, indent: string): string {
	const lines = modeVariables(tokens).map(
		([name, value]) => `${indent}\t${name}: ${formatOklch(value)};`
	);
	const aliases = legacyAliases.map(([alias, target]) => `${indent}\t${alias}: var(${target});`);
	return `${indent}${selector} {\n${[...lines, '', ...aliases].join('\n')}\n${indent}}`;
}

/**
 * Emits the Tailwind v4 stylesheet. The scales live in `@theme` so utilities such as
 * `bg-primary-500` exist; the semantic tokens are `var()` references so the same utility follows
 * the active theme instead of being frozen at build time.
 */
export function renderPaletteCss(palette: Palette, meta: { logo?: string }): string {
	const source = meta.logo ? `${meta.logo} (${palette.seedHex})` : palette.seedHex;
	const scale = primarySteps
		.map((step) => `\t--color-primary-${step}: ${formatOklch(palette.primary[step])};`)
		.join('\n');

	const semantic = [
		'--color-primary: var(--brand-primary)',
		'--color-primary-hover: var(--brand-primary-hover)',
		'--color-primary-contrast: var(--brand-primary-contrast)',
		'--color-surface-base: var(--brand-surface-base)',
		'--color-surface-raised: var(--brand-surface-raised)',
		'--color-surface-sunken: var(--brand-surface-sunken)',
		'--color-surface-border: var(--brand-surface-border)',
		'--color-text-strong: var(--brand-text-strong)',
		'--color-text-muted: var(--brand-text-muted)',
		'--color-text-inverted: var(--brand-text-inverted)'
	]
		.map((line) => `\t${line};`)
		.join('\n');

	return `/* Generated by scripts/extract-logo-theme.ts from ${source}. Do not edit by hand. */

@theme {
${scale}

${semantic}
}

${block(':root', palette.light, '')}

${block(":root[data-theme='dark']", palette.dark, '')}

@media (prefers-color-scheme: dark) {
${block(":root[data-theme='system']", palette.dark, '\t')}
}
`;
}

/** Every text/background pair the palette promises to keep at AA, for tests and the CLI report. */
export function contrastReport(palette: Palette): { pair: string; ratio: number }[] {
	const pairs: { pair: string; ratio: number }[] = [];
	for (const mode of ['light', 'dark'] as const) {
		const tokens = palette[mode];
		pairs.push(
			{
				pair: `${mode}: text-strong on surface-base`,
				ratio: contrastRatioOklch(tokens.textStrong, tokens.surfaceBase)
			},
			{
				pair: `${mode}: text-muted on surface-base`,
				ratio: contrastRatioOklch(tokens.textMuted, tokens.surfaceBase)
			},
			{
				pair: `${mode}: text-strong on surface-raised`,
				ratio: contrastRatioOklch(tokens.textStrong, tokens.surfaceRaised)
			},
			{
				pair: `${mode}: primary-contrast on primary`,
				ratio: contrastRatioOklch(tokens.primaryContrast, tokens.primary)
			}
		);
	}
	return pairs.map(({ pair, ratio }) => ({ pair, ratio: Number(ratio.toFixed(2)) }));
}

export { oklchToRgb };
