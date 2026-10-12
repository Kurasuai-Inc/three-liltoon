import {
	DataUtils,
	FloatType,
	HalfFloatType,
	RGBAFormat,
	SRGBColorSpace,
	UnsignedByteType,
	type CubeTexture,
} from "three";

export const CUBE_FACES = ["+X", "−X", "+Y", "−Y", "+Z", "−Z"] as const;
type Face = { width: number; height: number; data?: ArrayLike<number> };

export function cubeFace(
	cube: CubeTexture,
	level: number,
	face: number,
): Face | undefined {
	const images =
		level === 0
			? cube.images
			: (cube.mipmaps[level - 1] as unknown as { image?: unknown[] })?.image;
	const entry = images?.[face] as
		({ image?: Face } & Partial<Face>) | undefined;
	const image = entry?.image ?? entry;
	return image?.width && image.height ? (image as Face) : undefined;
}

/** Bounded display copy; the source's pixels and color-space settings stay untouched. */
export function cubeFacePixels(
	cube: CubeTexture,
	level: number,
	face: number,
	exposure: number,
) {
	const source = cubeFace(cube, level, face);
	if (
		!source?.data ||
		cube.format !== RGBAFormat ||
		![HalfFloatType, FloatType, UnsignedByteType].some(
			(type) => type === cube.type,
		)
	)
		return undefined;
	const width = Math.min(128, source.width),
		height = Math.min(128, source.height);
	const data = new Uint8ClampedArray(width * height * 4);
	const gain = 2 ** exposure;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const sx = Math.min(
				source.width - 1,
				Math.floor(((x + 0.5) * source.width) / width),
			);
			// Texture t increases upward; canvas rows increase downward.
			const sy =
				source.height -
				1 -
				Math.min(
					source.height - 1,
					Math.floor(((y + 0.5) * source.height) / height),
				);
			const offset = (sy * source.width + sx) * 4,
				target = (y * width + x) * 4;
			for (let c = 0; c < 3; c++) {
				let value = source.data[offset + c];
				value =
					cube.type === HalfFloatType
						? DataUtils.fromHalfFloat(value)
						: cube.type === UnsignedByteType
							? value / 255
							: value;
				if (!Number.isFinite(value)) value = 0;
				if (cube.colorSpace === SRGBColorSpace)
					value =
						value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
				value = Math.max(0, value) * gain;
				value /= 1 + value;
				data[target + c] =
					255 *
					(value <= 0.0031308
						? 12.92 * value
						: 1.055 * value ** (1 / 2.4) - 0.055);
			}
			data[target + 3] = 255;
		}
	return { data, width, height };
}
