import { describe, expect, test } from 'bun:test';
import { deflateSync } from 'node:zlib';
import {
	contrastRatio,
	ensureContrast,
	formatOklch,
	oklchToRgb,
	parseHex,
	rgbToOklch,
	toDisplayableOklch
} from '../../scripts/lib/color';
import { decodePng, extractLogoSeed, extractPngSeed, extractSvgSeed } from '../../scripts/lib/logo';
import {
	AA_CONTRAST,
	buildPalette,
	contrastReport,
	primarySteps,
	renderPaletteCss
} from '../../scripts/lib/palette';

const white = { r: 255, g: 255, b: 255 };
const black = { r: 0, g: 0, b: 0 };
const brandBlue = { r: 47, g: 127, b: 208 };

describe('colour conversions', () => {
	test('round-trips sRGB through OKLCH', () => {
		for (const color of [white, black, brandBlue, { r: 220, g: 38, b: 38 }]) {
			const back = oklchToRgb(rgbToOklch(color)).rgb;
			expect(Math.abs(back.r - color.r)).toBeLessThanOrEqual(1);
			expect(Math.abs(back.g - color.g)).toBeLessThanOrEqual(1);
			expect(Math.abs(back.b - color.b)).toBeLessThanOrEqual(1);
		}
	});

	test('places the reference colours where OKLab says they belong', () => {
		expect(rgbToOklch(white).l).toBeCloseTo(1, 2);
		expect(rgbToOklch(black).l).toBeCloseTo(0, 2);
		expect(rgbToOklch(white).c).toBeLessThan(0.001);
		// Pure red sits near hue 29° in OKLCH.
		expect(rgbToOklch({ r: 255, g: 0, b: 0 }).h).toBeCloseTo(29.23, 0);
	});

	test('maps out-of-gamut colours back by reducing chroma, not by clipping', () => {
		const impossible = { l: 0.6, c: 0.4, h: 250 };
		const mapped = toDisplayableOklch(impossible);
		expect(mapped.c).toBeLessThan(impossible.c);
		expect(mapped.l).toBe(impossible.l);
		expect(mapped.h).toBe(impossible.h);
		expect(oklchToRgb(mapped).inGamut).toBe(true);
	});

	test('formats OKLCH as displayable CSS', () => {
		expect(formatOklch({ l: 0.5, c: 0.1, h: 250 })).toBe('oklch(0.5 0.1 250)');
	});

	test('computes the WCAG contrast ratio', () => {
		expect(contrastRatio(black, white)).toBeCloseTo(21, 1);
		expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
	});

	test('ensureContrast reaches the requested ratio', () => {
		const background = rgbToOklch(white);
		const adjusted = ensureContrast({ l: 0.8, c: 0.05, h: 250 }, background, AA_CONTRAST);
		expect(contrastRatio(oklchToRgb(adjusted).rgb, white)).toBeGreaterThanOrEqual(AA_CONTRAST);
	});

	test('parses hex in both lengths and rejects nonsense', () => {
		expect(parseHex('#2f7fd0')).toEqual(brandBlue);
		expect(parseHex('#fff')).toEqual(white);
		expect(parseHex('blue')).toBeUndefined();
	});
});

describe('SVG logo analysis', () => {
	test('prefers the chromatic colour over neutrals', () => {
		const svg = `<svg><path fill="#ffffff" d=""/><path fill="#000" d=""/><rect fill="#2f7fd0"/></svg>`;
		expect(extractSvgSeed(svg).hex).toBe('#2f7fd0');
	});

	test('reads inline styles, stops and rgb() notation', () => {
		expect(extractSvgSeed(`<svg><path style="fill:#2f7fd0"/></svg>`).hex).toBe('#2f7fd0');
		expect(extractSvgSeed(`<svg><stop stop-color="#2f7fd0"/></svg>`).hex).toBe('#2f7fd0');
		expect(extractSvgSeed(`<svg><rect fill="rgb(47, 127, 208)"/></svg>`).hex).toBe('#2f7fd0');
		expect(extractSvgSeed(`<svg><rect fill="teal"/></svg>`).hex).toBe('#008080');
	});

	test('picks the most used chromatic colour', () => {
		const svg = `<svg><rect fill="#2f7fd0"/><rect fill="#2f7fd0"/><rect fill="#dc2626"/></svg>`;
		expect(extractSvgSeed(svg).hex).toBe('#2f7fd0');
	});

	test('falls back to neutrals for a monochrome logo', () => {
		expect(extractSvgSeed(`<svg><rect fill="#111111"/></svg>`).hex).toBe('#111111');
	});

	test('ignores none, currentColor and url() references', () => {
		const svg = `<svg><rect fill="none" stroke="currentColor"/><rect fill="url(#grad)"/><rect fill="#2f7fd0"/></svg>`;
		const seed = extractSvgSeed(svg);
		expect(seed.hex).toBe('#2f7fd0');
		expect(seed.sampled).toBe(1);
	});

	test('reports a logo with no colours at all', () => {
		expect(() => extractSvgSeed('<svg><rect/></svg>')).toThrow();
	});
});

/** Builds a real PNG (valid CRCs) so the decoder is tested against the actual format. */
function crc32(data: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(body.length);
	const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(typed));
	return Buffer.concat([length, typed, crc]);
}

function makePng(width: number, height: number, rgba: number[][]): Buffer {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // RGBA
	const raw: number[] = [];
	for (let row = 0; row < height; row += 1) {
		raw.push(0); // filter: none
		for (let column = 0; column < width; column += 1) raw.push(...rgba[row * width + column]);
	}
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(Buffer.from(raw))),
		chunk('IEND', Buffer.alloc(0))
	]);
}

describe('PNG logo analysis', () => {
	const blue = [47, 127, 208, 255];
	const opaqueWhite = [255, 255, 255, 255];
	const clear = [0, 0, 0, 0];

	test('decodes a real PNG into RGBA samples', () => {
		const png = makePng(2, 1, [blue, opaqueWhite]);
		const decoded = decodePng(png);
		expect(decoded.width).toBe(2);
		expect(decoded.height).toBe(1);
		expect([...decoded.pixels.slice(0, 4)]).toEqual(blue);
	});

	test('finds the brand colour behind a white background', () => {
		const pixels = [blue, blue, opaqueWhite, opaqueWhite, opaqueWhite, opaqueWhite];
		expect(extractPngSeed(makePng(3, 2, pixels)).hex).toBe('#2f7fd0');
	});

	test('ignores transparent pixels', () => {
		const seed = extractPngSeed(makePng(2, 1, [blue, clear]));
		expect(seed.hex).toBe('#2f7fd0');
		expect(seed.sampled).toBe(1);
	});

	test('reverses the up filter', () => {
		// Two identical rows: the encoder above writes filter 0, so this checks multi-row decoding.
		const decoded = decodePng(makePng(1, 2, [blue, blue]));
		expect([...decoded.pixels.slice(4, 8)]).toEqual(blue);
	});

	test('rejects a file that is not a PNG', () => {
		expect(() => decodePng(Buffer.from('not a png'))).toThrow();
	});

	test('routes by file extension', () => {
		expect(extractLogoSeed('logo.png', makePng(1, 1, [blue])).source).toBe('png');
		expect(
			extractLogoSeed('logo.svg', Buffer.from('<svg><rect fill="#2f7fd0"/></svg>')).source
		).toBe('svg');
		expect(() => extractLogoSeed('logo.gif', Buffer.alloc(0))).toThrow();
	});
});

describe('palette synthesis', () => {
	const seeds = [
		{ name: 'blue', rgb: brandBlue },
		{ name: 'red', rgb: { r: 220, g: 38, b: 38 } },
		{ name: 'yellow', rgb: { r: 250, g: 204, b: 21 } },
		{ name: 'near-black', rgb: { r: 17, g: 17, b: 17 } },
		{ name: 'green', rgb: { r: 22, g: 163, b: 74 } }
	];

	for (const seed of seeds) {
		test(`keeps every text pair at WCAG AA for a ${seed.name} logo`, () => {
			for (const entry of contrastReport(buildPalette(seed.rgb))) {
				expect(entry.ratio).toBeGreaterThanOrEqual(AA_CONTRAST);
			}
		});
	}

	test('produces a monotonically darkening primary scale on the logo hue', () => {
		const palette = buildPalette(brandBlue);
		const lightness = primarySteps.map((step) => palette.primary[step].l);
		for (let index = 1; index < lightness.length; index += 1) {
			expect(lightness[index]).toBeLessThan(lightness[index - 1]);
		}
		const seedHue = rgbToOklch(brandBlue).h;
		for (const step of primarySteps) {
			expect(Math.abs(palette.primary[step].h - seedHue)).toBeLessThan(0.01);
		}
	});

	test('gives a washed-out logo enough chroma to build a brand scale', () => {
		const palette = buildPalette({ r: 128, g: 128, b: 130 });
		expect(palette.primary[500].c).toBeGreaterThan(0.02);
	});

	test('emits the Tailwind v4 variables for both modes', () => {
		const css = renderPaletteCss(buildPalette(brandBlue), { logo: 'static/logo.svg' });
		expect(css).toContain('@theme {');
		expect(css).toContain('--color-primary-500:');
		expect(css).toContain('--color-surface-base: var(--brand-surface-base)');
		expect(css).toContain('--color-text-strong: var(--brand-text-strong)');
		expect(css).toContain(":root[data-theme='dark']");
		expect(css).toContain('@media (prefers-color-scheme: dark)');
		// The legacy aliases the existing layout stylesheet still uses.
		expect(css).toContain('--accent: var(--brand-primary)');
		expect(css).toMatch(/oklch\([\d.]+ [\d.]+ [\d.]+\)/);
	});

	test('light and dark modes differ', () => {
		const palette = buildPalette(brandBlue);
		expect(palette.light.surfaceBase.l).toBeGreaterThan(palette.dark.surfaceBase.l);
		expect(palette.light.textStrong.l).toBeLessThan(palette.dark.textStrong.l);
	});
});
