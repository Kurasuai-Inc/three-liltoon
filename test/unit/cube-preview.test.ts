import { expect, it } from "vitest";
import {
	CubeTexture,
	DataTexture,
	DataUtils,
	HalfFloatType,
	RGBAFormat,
} from "three";
import {
	cubeFace,
	cubeFacePixels,
} from "../../examples/mochiya-liltoon-viewer/src/lib/model/cube-preview.js";

it("displays half-float HDR faces upright, selects authored mips, and preserves source pixels", () => {
	const data = new Uint16Array(
		[1, 0, 0, 1, 1, 0, 0, 1, 0, 4, 0, 1, 0, 4, 0, 1].map(DataUtils.toHalfFloat),
	);
	const face = new DataTexture(data, 2, 2, RGBAFormat, HalfFloatType);
	const cube = new CubeTexture(Array(6).fill(face));
	cube.type = HalfFloatType;
	const small = new DataTexture(
		new Uint16Array([0.5, 0.5, 0.5, 1].map(DataUtils.toHalfFloat)),
		1,
		1,
		RGBAFormat,
		HalfFloatType,
	);
	cube.mipmaps = [{ image: Array(6).fill(small) }] as CubeTexture["mipmaps"];
	const before = data.slice();
	const preview = cubeFacePixels(cube, 0, 0, 0)!;
	expect([...preview.data.slice(0, 4)]).toEqual([0, 231, 0, 255]);
	expect([...preview.data.slice(8, 12)]).toEqual([188, 0, 0, 255]);
	expect(cubeFacePixels(cube, 0, 0, -2)!.data[1]).toBe(188);
	expect(cubeFace(cube, 1, 5)?.width).toBe(1);
	expect(cubeFacePixels(cube, 1, 5, 0)!.data[0]).toBe(156);
	expect(data).toEqual(before);
	expect(cubeFacePixels(cube, 3, 0, 0)).toBeUndefined();
});
it("bounds thumbnail allocations and handles unavailable face data", () => {
	const cube = new CubeTexture(
		Array(6).fill(
			new DataTexture(
				new Uint16Array(256 * 256 * 4),
				256,
				256,
				RGBAFormat,
				HalfFloatType,
			),
		),
	);
	cube.type = HalfFloatType;
	expect(cubeFacePixels(cube, 0, 0, 0)?.data.length).toBe(128 * 128 * 4);
	expect(cubeFacePixels(new CubeTexture(), 0, 0, 0)).toBeUndefined();
});
