/** Colour maths for the palette generator: sRGB ⇄ OKLCH, gamut mapping and WCAG contrast. */

export type Rgb = { r: number; g: number; b: number };
export type Oklch = { l: number; c: number; h: number };

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function srgbToLinear(channel: number): number {
	return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(channel: number): number {
	return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

/** sRGB (0-255) to OKLCH, via the OKLab matrices from Björn Ottosson's reference. */
export function rgbToOklch({ r, g, b }: Rgb): Oklch {
	const lr = srgbToLinear(r / 255);
	const lg = srgbToLinear(g / 255);
	const lb = srgbToLinear(b / 255);

	const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
	const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
	const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

	const okL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const okA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

	const chroma = Math.sqrt(okA * okA + okB * okB);
	const hue = chroma < 1e-6 ? 0 : ((Math.atan2(okB, okA) * 180) / Math.PI + 360) % 360;
	return { l: okL, c: chroma, h: hue };
}

/** OKLCH to sRGB. `inGamut` is false when the conversion had to be clipped. */
export function oklchToRgb({ l, c, h }: Oklch): { rgb: Rgb; inGamut: boolean } {
	const hueRadians = (h * Math.PI) / 180;
	const okA = c * Math.cos(hueRadians);
	const okB = c * Math.sin(hueRadians);

	const lCube = (l + 0.3963377774 * okA + 0.2158037573 * okB) ** 3;
	const mCube = (l - 0.1055613458 * okA - 0.0638541728 * okB) ** 3;
	const sCube = (l - 0.0894841775 * okA - 1.291485548 * okB) ** 3;

	const linear = [
		4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube,
		-1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube,
		-0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube
	];

	const inGamut = linear.every((channel) => channel >= -1e-4 && channel <= 1 + 1e-4);
	const [r, g, b] = linear.map((channel) => Math.round(clamp(linearToSrgb(clamp(channel))) * 255));
	return { rgb: { r, g, b }, inGamut };
}

/**
 * Reduces chroma until the colour fits in sRGB, which keeps the hue and lightness the generator
 * asked for instead of letting a clipped channel shift them.
 */
export function toDisplayableOklch(color: Oklch): Oklch {
	if (oklchToRgb(color).inGamut) return color;
	let low = 0;
	let high = color.c;
	for (let step = 0; step < 24; step += 1) {
		const mid = (low + high) / 2;
		if (oklchToRgb({ ...color, c: mid }).inGamut) low = mid;
		else high = mid;
	}
	return { ...color, c: low };
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));

/** Formats an OKLCH colour as the CSS function, gamut-mapped so what is written is displayable. */
export function formatOklch(color: Oklch): string {
	const safe = toDisplayableOklch({
		l: clamp(color.l),
		c: Math.max(0, color.c),
		h: ((color.h % 360) + 360) % 360
	});
	return `oklch(${round(safe.l, 4)} ${round(safe.c, 4)} ${round(safe.h, 2)})`;
}

export function formatHex({ r, g, b }: Rgb): string {
	return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function parseHex(value: string): Rgb | undefined {
	const hex = value.trim().replace(/^#/, '');
	if (/^[0-9a-f]{3}$/i.test(hex)) {
		const [r, g, b] = [...hex].map((digit) => parseInt(digit + digit, 16));
		return { r, g, b };
	}
	if (/^[0-9a-f]{6}$/i.test(hex)) {
		return {
			r: parseInt(hex.slice(0, 2), 16),
			g: parseInt(hex.slice(2, 4), 16),
			b: parseInt(hex.slice(4, 6), 16)
		};
	}
	return undefined;
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance({ r, g, b }: Rgb): number {
	const [lr, lg, lb] = [r, g, b].map((channel) => srgbToLinear(channel / 255));
	return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** WCAG 2.1 contrast ratio, from 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
	const first = relativeLuminance(a);
	const second = relativeLuminance(b);
	const [lighter, darker] = first >= second ? [first, second] : [second, first];
	return (lighter + 0.05) / (darker + 0.05);
}

export function contrastRatioOklch(a: Oklch, b: Oklch): number {
	return contrastRatio(oklchToRgb(a).rgb, oklchToRgb(b).rgb);
}

/**
 * Walks the foreground lightness away from the background until the WCAG ratio is met, so every
 * generated text token is AA compliant against the surface it sits on.
 */
export function ensureContrast(foreground: Oklch, background: Oklch, target: number): Oklch {
	const towardsDark = foreground.l <= background.l;
	for (let step = 0; step <= 100; step += 1) {
		const lightness = clamp(foreground.l + (towardsDark ? -step : step) * 0.01);
		const candidate = toDisplayableOklch({ ...foreground, l: lightness });
		if (contrastRatioOklch(candidate, background) >= target) return candidate;
		if (lightness === 0 || lightness === 1) break;
	}
	// Nothing on this hue reached the target, so fall back to the extreme that gets closest.
	const black = { l: 0, c: 0, h: foreground.h };
	const white = { l: 1, c: 0, h: foreground.h };
	return contrastRatioOklch(black, background) >= contrastRatioOklch(white, background)
		? black
		: white;
}
