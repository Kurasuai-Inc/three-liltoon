import {
	CubeTexture,
	DataTexture,
	HalfFloatType,
	LinearFilter,
	LinearMipmapLinearFilter,
	LinearSRGBColorSpace,
	RGBAFormat,
} from "three";
import type { GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTFLilToonCubeTextureInfo } from "./types.js";

/** One cache per file; typed pixels own their storage independently of parser caches. */
export class CubeTextureReader {
	private readonly cache = new Map<string, Promise<CubeTexture>>();
	constructor(private readonly parser: GLTFParser) {}

	load(info: GLTFLilToonCubeTextureInfo): Promise<CubeTexture> {
		try {
			this.validate(info);
		} catch (error) {
			return Promise.reject(error);
		}
		const key = JSON.stringify([info.encoding, info.size, info.mipmaps]);
		let pending = this.cache.get(key);
		if (!pending) {
			pending = this.read(info);
			this.cache.set(key, pending);
		}
		return pending;
	}

	private validate(info: GLTFLilToonCubeTextureInfo): void {
		const fail = (reason: string): never => {
			throw new Error(`Invalid lilToon cubemap: ${reason}`);
		};
		if (!info || info.encoding !== "rgba16f-linear")
			fail("unsupported encoding");
		const { size, mipmaps } = info;
		if (!Number.isSafeInteger(size) || size < 1 || Math.log2(size) % 1 !== 0)
			fail("face size must be a positive power of two");
		if (
			!Array.isArray(mipmaps) ||
			(mipmaps.length !== 1 && mipmaps.length !== Math.log2(size) + 1)
		)
			fail("expected a base level or a complete mip chain");
		for (let level = 0; level < mipmaps.length; level++) {
			const index = mipmaps[level];
			const view = this.parser.json.bufferViews?.[index];
			const width = size / 2 ** level;
			const bytes = width * width * 6 * 8;
			if (
				!Number.isSafeInteger(index) ||
				index < 0 ||
				!view ||
				!Number.isSafeInteger(bytes) ||
				view.byteLength !== bytes ||
				view.byteStride
			)
				fail(`mip ${level} has an invalid bufferView or byte length`);
		}
	}

	private async read(info: GLTFLilToonCubeTextureInfo): Promise<CubeTexture> {
		const levels: DataTexture[][] = [];
		// Serial reads avoid multiplying transient copies for large HDR cubes.
		for (let level = 0; level < info.mipmaps.length; level++) {
			const width = info.size / 2 ** level;
			const buffer: ArrayBuffer = await this.parser.getDependency(
				"bufferView",
				info.mipmaps[level],
			);
			const count = width * width * 4;
			if (buffer.byteLength !== count * 6 * 2)
				throw new Error(`Invalid lilToon cubemap: mip ${level} byte length`);
			const source = new DataView(buffer);
			const faces: DataTexture[] = [];
			for (let face = 0; face < 6; face++) {
				const pixels = new Uint16Array(count);
				for (let i = 0; i < count; i++) {
					const value = source.getUint16((face * count + i) * 2, true);
					if ((value & 0x7c00) === 0x7c00)
						throw new Error("Invalid lilToon cubemap: non-finite pixel");
					pixels[i] = value;
				}
				faces.push(
					new DataTexture(pixels, width, width, RGBAFormat, HalfFloatType),
				);
			}
			levels.push(faces);
		}
		const cube = new CubeTexture(levels[0]);
		cube.name = "lilToon reflection cubemap";
		cube.type = HalfFloatType;
		cube.format = RGBAFormat;
		cube.colorSpace = LinearSRGBColorSpace;
		cube.generateMipmaps = false;
		cube.magFilter = LinearFilter;
		cube.minFilter =
			levels.length > 1 ? LinearMipmapLinearFilter : LinearFilter;
		// Uncompressed Three cubes keep level zero in images, subsequent levels in mipmaps.
		cube.mipmaps = levels
			.slice(1)
			.map((image) => ({ image })) as CubeTexture["mipmaps"];
		cube.needsUpdate = true;
		// Generic glTF resource inventories (including Avatar Composition) own this source.
		this.parser.associations.set(cube, {});
		return cube;
	}
}
