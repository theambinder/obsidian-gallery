const MEDIA_MIME_TYPES: Readonly<Record<string, string>> = {
	avif: 'image/avif',
	bmp: 'image/bmp',
	gif: 'image/gif',
	heic: 'image/heic',
	heif: 'image/heif',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	jxl: 'image/jxl',
	m4v: 'video/x-m4v',
	mov: 'video/quicktime',
	mp4: 'video/mp4',
	ogv: 'video/ogg',
	png: 'image/png',
	svg: 'image/svg+xml',
	webm: 'video/webm',
	webp: 'image/webp',
};

export interface ImageDimensions {
	height: number;
	width: number;
}

export function getMediaMimeType(extension: string): string {
	return MEDIA_MIME_TYPES[extension.toLowerCase()] ??
		'application/octet-stream';
}

export function getEncodedImageDimensions(
	bytes: ArrayBuffer,
	extension: string,
): ImageDimensions | null {
	const view = new DataView(bytes);
	let dimensions: ImageDimensions | null = null;
	switch (extension.toLowerCase()) {
		case 'bmp':
			dimensions = readBmpDimensions(view);
			break;
		case 'gif':
			dimensions = readGifDimensions(view);
			break;
		case 'jpeg':
		case 'jpg':
			dimensions = readJpegDimensions(view);
			break;
		case 'png':
			dimensions = readPngDimensions(view);
			break;
		case 'svg':
			dimensions = readSvgDimensions(bytes);
			break;
		case 'webp':
			dimensions = readWebpDimensions(view);
			break;
		case 'avif':
		case 'heic':
		case 'heif':
			dimensions = readIsobmffDimensions(view);
			break;
	}
	return normalizeDimensions(dimensions);
}

function normalizeDimensions(
	dimensions: ImageDimensions | null,
): ImageDimensions | null {
	if (
		!dimensions ||
		!Number.isFinite(dimensions.width) ||
		!Number.isFinite(dimensions.height) ||
		dimensions.width <= 0 ||
		dimensions.height <= 0
	) {
		return null;
	}
	return {
		height: Math.round(dimensions.height),
		width: Math.round(dimensions.width),
	};
}

function readPngDimensions(view: DataView): ImageDimensions | null {
	if (
		view.byteLength < 24 ||
		view.getUint32(0) !== 0x89504e47 ||
		view.getUint32(4) !== 0x0d0a1a0a
	) {
		return null;
	}
	return { height: view.getUint32(20), width: view.getUint32(16) };
}

function readGifDimensions(view: DataView): ImageDimensions | null {
	if (view.byteLength < 10 || readAscii(view, 0, 3) !== 'GIF') {
		return null;
	}
	return { height: view.getUint16(8, true), width: view.getUint16(6, true) };
}

function readBmpDimensions(view: DataView): ImageDimensions | null {
	if (view.byteLength < 26 || readAscii(view, 0, 2) !== 'BM') {
		return null;
	}
	if (view.getUint32(14, true) === 12) {
		return {
			height: view.getUint16(20, true),
			width: view.getUint16(18, true),
		};
	}
	return {
		height: Math.abs(view.getInt32(22, true)),
		width: Math.abs(view.getInt32(18, true)),
	};
}

function readJpegDimensions(view: DataView): ImageDimensions | null {
	if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) {
		return null;
	}
	let offset = 2;
	let orientation = 1;
	let dimensions: ImageDimensions | null = null;
	while (offset + 4 <= view.byteLength) {
		if (view.getUint8(offset) !== 0xff) {
			offset += 1;
			continue;
		}
		while (offset < view.byteLength && view.getUint8(offset) === 0xff) {
			offset += 1;
		}
		if (offset >= view.byteLength) {
			break;
		}
		const marker = view.getUint8(offset);
		offset += 1;
		if (marker === 0xd9 || marker === 0xda) {
			break;
		}
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			continue;
		}
		if (offset + 2 > view.byteLength) {
			break;
		}
		const segmentLength = view.getUint16(offset);
		if (segmentLength < 2 || offset + segmentLength > view.byteLength) {
			break;
		}
		const segmentStart = offset + 2;
		if (marker === 0xe1) {
			orientation = readExifOrientation(
				view,
				segmentStart,
				offset + segmentLength,
			) ?? orientation;
		}
		if (isJpegStartOfFrame(marker) && segmentLength >= 7) {
			dimensions = {
				height: view.getUint16(segmentStart + 1),
				width: view.getUint16(segmentStart + 3),
			};
		}
		offset += segmentLength;
	}
	if (dimensions && orientation >= 5 && orientation <= 8) {
		return { height: dimensions.width, width: dimensions.height };
	}
	return dimensions;
}

function isJpegStartOfFrame(marker: number): boolean {
	return (
		marker >= 0xc0 &&
		marker <= 0xcf &&
		marker !== 0xc4 &&
		marker !== 0xc8 &&
		marker !== 0xcc
	);
}

function readExifOrientation(
	view: DataView,
	start: number,
	end: number,
): number | null {
	if (end - start < 14 || readAscii(view, start, 6) !== 'Exif\0\0') {
		return null;
	}
	const tiffStart = start + 6;
	const byteOrder = view.getUint16(tiffStart);
	const littleEndian = byteOrder === 0x4949;
	if (!littleEndian && byteOrder !== 0x4d4d) {
		return null;
	}
	const ifdOffset = view.getUint32(tiffStart + 4, littleEndian);
	const ifdStart = tiffStart + ifdOffset;
	if (ifdStart + 2 > end) {
		return null;
	}
	const entryCount = view.getUint16(ifdStart, littleEndian);
	for (let index = 0; index < entryCount; index += 1) {
		const entry = ifdStart + 2 + index * 12;
		if (entry + 12 > end) {
			return null;
		}
		if (view.getUint16(entry, littleEndian) === 0x0112) {
			return view.getUint16(entry + 8, littleEndian);
		}
	}
	return null;
}

function readWebpDimensions(view: DataView): ImageDimensions | null {
	if (
		view.byteLength < 30 ||
		readAscii(view, 0, 4) !== 'RIFF' ||
		readAscii(view, 8, 4) !== 'WEBP'
	) {
		return null;
	}
	let offset = 12;
	while (offset + 8 <= view.byteLength) {
		const type = readAscii(view, offset, 4);
		const size = view.getUint32(offset + 4, true);
		const dataStart = offset + 8;
		if (dataStart + size > view.byteLength) {
			return null;
		}
		if (type === 'VP8X' && size >= 10) {
			return {
				height: readUint24(view, dataStart + 7) + 1,
				width: readUint24(view, dataStart + 4) + 1,
			};
		}
		if (type === 'VP8L' && size >= 5 && view.getUint8(dataStart) === 0x2f) {
			const bits = view.getUint32(dataStart + 1, true);
			return {
				height: ((bits >>> 14) & 0x3fff) + 1,
				width: (bits & 0x3fff) + 1,
			};
		}
		if (
			type === 'VP8 ' &&
			size >= 10 &&
			readUint24(view, dataStart + 3) === 0x2a019d
		) {
			return {
				height: view.getUint16(dataStart + 8, true) & 0x3fff,
				width: view.getUint16(dataStart + 6, true) & 0x3fff,
			};
		}
		offset = dataStart + size + (size % 2);
	}
	return null;
}

function readIsobmffDimensions(view: DataView): ImageDimensions | null {
	for (let offset = 4; offset + 16 <= view.byteLength; offset += 1) {
		if (view.getUint32(offset) !== 0x69737065) {
			continue;
		}
		const boxSize = view.getUint32(offset - 4);
		if (boxSize < 20 || offset - 4 + boxSize > view.byteLength) {
			continue;
		}
		return {
			height: view.getUint32(offset + 12),
			width: view.getUint32(offset + 8),
		};
	}
	return null;
}

function readSvgDimensions(bytes: ArrayBuffer): ImageDimensions | null {
	const text = new TextDecoder().decode(bytes.slice(0, 64 * 1024));
	const svgTag = /<svg\b[^>]*>/iu.exec(text)?.[0];
	if (!svgTag) {
		return null;
	}
	const viewBox = /\bviewBox\s*=\s*["']\s*([\d.+-]+)[ ,]+([\d.+-]+)[ ,]+([\d.+-]+)[ ,]+([\d.+-]+)\s*["']/iu.exec(
		svgTag,
	);
	if (viewBox) {
		return { height: Number(viewBox[4]), width: Number(viewBox[3]) };
	}
	const width = readSvgLength(svgTag, 'width');
	const height = readSvgLength(svgTag, 'height');
	return width && height ? { height, width } : null;
}

function readSvgLength(tag: string, name: string): number | null {
	const match = new RegExp(
		`\\b${name}\\s*=\\s*["']\\s*([\\d.+-]+)\\s*([a-z%]*)[^"']*["']`,
		'iu',
	).exec(tag);
	const value = Number(match?.[1]);
	return match?.[2] !== '%' && Number.isFinite(value) && value > 0
		? value
		: null;
}

function readUint24(view: DataView, offset: number): number {
	return (
		view.getUint8(offset) |
		(view.getUint8(offset + 1) << 8) |
		(view.getUint8(offset + 2) << 16)
	);
}

function readAscii(view: DataView, offset: number, length: number): string {
	let value = '';
	for (let index = 0; index < length; index += 1) {
		value += String.fromCharCode(view.getUint8(offset + index));
	}
	return value;
}
