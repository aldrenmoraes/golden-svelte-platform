import { inflateSync } from 'node:zlib';
import { formatHex, parseHex, rgbToOklch, type Rgb } from './color';

export type LogoSeed = { rgb: Rgb; hex: string; source: 'svg' | 'png'; sampled: number };

/** The handful of CSS keywords a logo realistically uses; anything else is ignored. */
const namedColors: Record<string, string> = {
	black: '#000000',
	white: '#ffffff',
	red: '#ff0000',
	green: '#008000',
	blue: '#0000ff',
	yellow: '#ffff00',
	orange: '#ffa500',
	purple: '#800080',
	teal: '#008080',
	cyan: '#00ffff',
	magenta: '#ff00ff',
	gray: '#808080',
	grey: '#808080',
	navy: '#000080',
	silver: '#c0c0c0'
};

function parseColorToken(token: string): Rgb | undefined {
	const value = token.trim().toLowerCase();
	if (value.length === 0 || value === 'none' || value === 'transparent') return undefined;
	if (value === 'currentcolor' || value.startsWith('url(')) return undefined;

	const hex = parseHex(value);
	if (hex) return hex;

	const named = namedColors[value];
	if (named) return parseHex(named);

	const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(value);
	if (rgb) {
		const channels = [rgb[1], rgb[2], rgb[3]].map((channel) => {
			const numeric = Number(channel);
			return Math.round(Math.min(255, Math.max(0, numeric)));
		});
		return { r: channels[0], g: channels[1], b: channels[2] };
	}
	return undefined;
}

/** Chroma is what separates a brand colour from the neutrals a logo uses for text and outlines. */
function isBrandCandidate(color: Rgb): boolean {
	const { l, c } = rgbToOklch(color);
	return c >= 0.04 && l > 0.05 && l < 0.98;
}

function pickDominant(counts: Map<string, { color: Rgb; weight: number }>): Rgb | undefined {
	let winner: { color: Rgb; weight: number } | undefined;
	for (const entry of counts.values()) {
		if (!winner || entry.weight > winner.weight) winner = entry;
	}
	return winner?.color;
}

/**
 * Reads fill and stroke colours from SVG attributes and inline styles, then returns the most
 * used chromatic one. Neutrals only win when the logo has no chromatic colour at all.
 */
export function extractSvgSeed(svg: string): LogoSeed {
	const chromatic = new Map<string, { color: Rgb; weight: number }>();
	const neutral = new Map<string, { color: Rgb; weight: number }>();
	let sampled = 0;

	const patterns = [
		/(?:fill|stroke)\s*=\s*"([^"]*)"/gi,
		/(?:fill|stroke)\s*=\s*'([^']*)'/gi,
		/(?:fill|stroke)\s*:\s*([^;"'}\s]+)/gi,
		/stop-color\s*[:=]\s*["']?([^;"'}\s]+)/gi
	];

	for (const pattern of patterns) {
		for (const match of svg.matchAll(pattern)) {
			const color = parseColorToken(match[1]);
			if (!color) continue;
			sampled += 1;
			const key = formatHex(color);
			const bucket = isBrandCandidate(color) ? chromatic : neutral;
			const entry = bucket.get(key) ?? { color, weight: 0 };
			entry.weight += 1;
			bucket.set(key, entry);
		}
	}

	const dominant = pickDominant(chromatic) ?? pickDominant(neutral);
	if (!dominant) throw new Error('Nenhuma cor encontrada no SVG.');
	return { rgb: dominant, hex: formatHex(dominant), source: 'svg', sampled };
}

type PngHeader = { width: number; height: number; depth: number; colorType: number };

function readChunks(data: Buffer): { header: PngHeader; idat: Buffer; palette?: Buffer } {
	const signature = [137, 80, 78, 71, 13, 10, 26, 10];
	if (data.length < 8 || signature.some((byte, index) => data[index] !== byte)) {
		throw new Error('Arquivo PNG inválido: assinatura ausente.');
	}

	let offset = 8;
	let header: PngHeader | undefined;
	let palette: Buffer | undefined;
	const idatParts: Buffer[] = [];

	while (offset + 8 <= data.length) {
		const length = data.readUInt32BE(offset);
		const type = data.toString('ascii', offset + 4, offset + 8);
		const body = data.subarray(offset + 8, offset + 8 + length);
		if (type === 'IHDR') {
			header = {
				width: body.readUInt32BE(0),
				height: body.readUInt32BE(4),
				depth: body[8],
				colorType: body[9]
			};
			if (body[12] !== 0) throw new Error('PNG entrelaçado não é suportado.');
		} else if (type === 'PLTE') palette = Buffer.from(body);
		else if (type === 'IDAT') idatParts.push(Buffer.from(body));
		else if (type === 'IEND') break;
		offset += 12 + length;
	}

	if (!header) throw new Error('Arquivo PNG inválido: IHDR ausente.');
	if (header.depth !== 8) throw new Error(`PNG com profundidade ${header.depth} não é suportado.`);
	if (idatParts.length === 0) throw new Error('Arquivo PNG inválido: IDAT ausente.');
	return { header, idat: Buffer.concat(idatParts), palette };
}

function paeth(a: number, b: number, c: number): number {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	if (pa <= pb && pa <= pc) return a;
	return pb <= pc ? b : c;
}

/** Reverses the per-scanline PNG filters, returning raw samples. */
function unfilter(raw: Buffer, width: number, height: number, channels: number): Buffer {
	const stride = width * channels;
	const output = Buffer.alloc(stride * height);
	let position = 0;

	for (let row = 0; row < height; row += 1) {
		const filter = raw[position];
		position += 1;
		const line = raw.subarray(position, position + stride);
		position += stride;
		const target = output.subarray(row * stride, (row + 1) * stride);
		const previous = row === 0 ? undefined : output.subarray((row - 1) * stride, row * stride);

		for (let index = 0; index < stride; index += 1) {
			const left = index >= channels ? target[index - channels] : 0;
			const up = previous ? previous[index] : 0;
			const upLeft = previous && index >= channels ? previous[index - channels] : 0;
			const value = line[index];
			if (filter === 0) target[index] = value;
			else if (filter === 1) target[index] = (value + left) & 0xff;
			else if (filter === 2) target[index] = (value + up) & 0xff;
			else if (filter === 3) target[index] = (value + ((left + up) >> 1)) & 0xff;
			else if (filter === 4) target[index] = (value + paeth(left, up, upLeft)) & 0xff;
			else throw new Error(`Filtro PNG desconhecido: ${filter}`);
		}
	}
	return output;
}

export type PngPixels = { width: number; height: number; pixels: Uint8Array };

/** Decodes 8-bit non-interlaced PNGs (grayscale, RGB, palette and RGBA) into RGBA samples. */
export function decodePng(data: Buffer): PngPixels {
	const { header, idat, palette } = readChunks(data);
	const channelsByType: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
	const channels = channelsByType[header.colorType];
	if (!channels) throw new Error(`Tipo de cor PNG ${header.colorType} não é suportado.`);

	const samples = unfilter(inflateSync(idat), header.width, header.height, channels);
	const pixels = new Uint8Array(header.width * header.height * 4);

	for (let index = 0; index < header.width * header.height; index += 1) {
		const source = index * channels;
		const target = index * 4;
		if (header.colorType === 0) {
			pixels.fill(samples[source], target, target + 3);
			pixels[target + 3] = 255;
		} else if (header.colorType === 4) {
			pixels.fill(samples[source], target, target + 3);
			pixels[target + 3] = samples[source + 1];
		} else if (header.colorType === 2 || header.colorType === 6) {
			pixels[target] = samples[source];
			pixels[target + 1] = samples[source + 1];
			pixels[target + 2] = samples[source + 2];
			pixels[target + 3] = header.colorType === 6 ? samples[source + 3] : 255;
		} else {
			if (!palette) throw new Error('PNG indexado sem paleta PLTE.');
			const entry = samples[source] * 3;
			pixels[target] = palette[entry];
			pixels[target + 1] = palette[entry + 1];
			pixels[target + 2] = palette[entry + 2];
			pixels[target + 3] = 255;
		}
	}

	return { width: header.width, height: header.height, pixels };
}

/**
 * Buckets the opaque pixels by quantised colour and returns the heaviest chromatic bucket,
 * weighting each pixel by its chroma so a large flat background cannot outvote the mark itself.
 */
export function extractPngSeed(data: Buffer): LogoSeed {
	const { pixels } = decodePng(data);
	const chromatic = new Map<string, { sum: Rgb; count: number; weight: number }>();
	const neutral = new Map<string, { sum: Rgb; count: number; weight: number }>();
	let sampled = 0;

	for (let index = 0; index < pixels.length; index += 4) {
		const alpha = pixels[index + 3];
		if (alpha < 128) continue;
		const color = { r: pixels[index], g: pixels[index + 1], b: pixels[index + 2] };
		sampled += 1;

		const { c } = rgbToOklch(color);
		const brand = isBrandCandidate(color);
		const bucket = brand ? chromatic : neutral;
		// 5 bits per channel keeps gradients of the same brand colour in one bucket.
		const key = [color.r, color.g, color.b].map((channel) => channel >> 3).join(',');
		const entry = bucket.get(key) ?? { sum: { r: 0, g: 0, b: 0 }, count: 0, weight: 0 };
		entry.sum.r += color.r;
		entry.sum.g += color.g;
		entry.sum.b += color.b;
		entry.count += 1;
		entry.weight += brand ? 1 + c * 4 : 1;
		bucket.set(key, entry);
	}

	if (sampled === 0) throw new Error('O PNG não tem pixels opacos para amostrar.');

	const source = chromatic.size > 0 ? chromatic : neutral;
	let winner: { sum: Rgb; count: number; weight: number } | undefined;
	for (const entry of source.values()) {
		if (!winner || entry.weight > winner.weight) winner = entry;
	}
	if (!winner) throw new Error('Nenhuma cor dominante encontrada no PNG.');

	// The bucket average is closer to the real colour than the quantised key.
	const rgb = {
		r: Math.round(winner.sum.r / winner.count),
		g: Math.round(winner.sum.g / winner.count),
		b: Math.round(winner.sum.b / winner.count)
	};
	return { rgb, hex: formatHex(rgb), source: 'png', sampled };
}

/** Picks the reader by extension and returns the brand seed colour. */
export function extractLogoSeed(path: string, contents: Buffer): LogoSeed {
	const extension = path.toLowerCase().split('.').pop();
	if (extension === 'svg') return extractSvgSeed(contents.toString('utf8'));
	if (extension === 'png') return extractPngSeed(contents);
	throw new Error(`Formato de logo não suportado: .${extension ?? '?'} (use .svg ou .png)`);
}
