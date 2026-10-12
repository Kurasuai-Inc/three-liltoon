import {
	CubeTexture,
	DataTexture,
	DataUtils,
	HalfFloatType,
	LinearSRGBColorSpace,
} from "three";
import type { GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it, vi } from "vitest";
import { CubeTextureReader } from "../../src/loaders/cubeTextures.js";
import { GLTFLilToonExtension } from "../../src/loaders/GLTFLilToonExtension.js";
import { normalizeLilToonTexture } from "../../src/utils/texture.js";

function fixture() {
	const buffers = [2, 1].map((size) => {
		const data = new Uint16Array(size * size * 6 * 4);
		for (let face = 0; face < 6; face++)
			data.fill(
				DataUtils.toHalfFloat(face + size),
				face * size * size * 4,
				(face + 1) * size * size * 4,
			);
		return data.buffer;
	});
	const info = {
		encoding: "rgba16f-linear" as const,
		size: 2,
		mipmaps: [0, 1],
	};
	const definition = {
		specVersion: "1.3",
		cubeTextures: { _ReflectionCubeTex: info },
	};
	const parser = {
		json: {
			bufferViews: buffers.map((b) => ({ byteLength: b.byteLength })),
			materials: [{ extensions: { MOCHIYA_materials_liltoon: definition } }],
		},
		associations: new Map(),
		getDependency: vi.fn(
			async (_kind: string, index: number) => buffers[index],
		),
	} as unknown as GLTFParser;
	return { parser, info, buffers };
}

describe("embedded cubemaps", () => {
	it("preserves HDR and each face/mip with independent retained storage", async () => {
		const { parser, info, buffers } = fixture();
		const reader = new CubeTextureReader(parser);
		const [cube, shared] = await Promise.all([
			reader.load(info),
			reader.load({ ...info }),
		]);
		expect(shared).toBe(cube);
		expect(parser.getDependency).toHaveBeenCalledTimes(2);
		expect(cube.type).toBe(HalfFloatType);
		expect(cube.generateMipmaps).toBe(false);
		expect(cube.mipmaps).toHaveLength(1);
		for (let face = 0; face < 6; face++) {
			const image = (cube.images[face] as DataTexture).image;
			expect(DataUtils.fromHalfFloat(image.data![0])).toBe(face + 2);
			expect(image.data!.buffer).not.toBe(buffers[0]);
		}
		expect(
			normalizeLilToonTexture("_ReflectionCubeTex", cube.clone()).colorSpace,
		).toBe(LinearSRGBColorSpace);
		expect(parser.associations.has(cube)).toBe(true);
	});
	it("constructs a lilToon material through the extension", async () => {
		const { parser } = fixture();
		const material = await new GLTFLilToonExtension(parser).loadMaterial(0);
		expect(material).not.toBeNull();
		expect(
			[...parser.associations.keys()].some((x) => x instanceof CubeTexture),
		).toBe(true);
		material!.dispose();
	});
	it.each([
		{ size: 3 },
		{ size: 0 },
		{ size: Infinity },
		{ encoding: "png" },
		{ mipmaps: [] },
		{ mipmaps: [0, 1, 2] },
		{ mipmaps: [-1] },
		{ mipmaps: [0.5] },
		{ mipmaps: [1] },
	])("rejects malformed descriptors before reading: %j", async (change) => {
		const { parser, info } = fixture();
		await expect(
			new CubeTextureReader(parser).load({ ...info, ...change } as typeof info),
		).rejects.toThrow("Invalid lilToon cubemap");
		expect(parser.getDependency).not.toHaveBeenCalled();
	});
	it("rejects non-finite half pixels", async () => {
		const { parser, info, buffers } = fixture();
		new Uint16Array(buffers[0])[0] = 0x7c00;
		await expect(new CubeTextureReader(parser).load(info)).rejects.toThrow(
			"non-finite",
		);
		expect(parser.associations.size).toBe(0);
	});
});

// Check the device boundary before attempting an oversized data-cube upload.
it("rejects cube faces above the actual renderer limit", async () => {
	const { checkCubeTextureSizes } =
		await import("../../src/renderer/textureLimits.js");
	const renderer = { capabilities: { maxCubemapSize: 2 } } as any;
	const uniforms = {
		reflection: {
			value: { isCubeTexture: true, images: [{ image: { width: 4 } }] },
		},
	};
	expect(() => checkCubeTextureSizes(renderer, uniforms)).toThrow(
		"exceeds this device's limit 2",
	);
	renderer.capabilities.maxCubemapSize = 4;
	expect(() => checkCubeTextureSizes(renderer, uniforms)).not.toThrow();
});
