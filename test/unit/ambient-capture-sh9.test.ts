import { describe, expect, it } from "vitest";
import { packUnitySH9 } from "../../examples/ambient-capture/unity-sh9.js";

describe("Unity ambient-probe SH9 capture packing", () => {
	it("preserves the 27 coefficients in lilToon's Unity-compatible SH uniforms", () => {
		const packed = packUnitySH9({
			r: [10, 11, 12, 13, 14, 15, 16, 17, 18],
			g: [20, 21, 22, 23, 24, 25, 26, 27, 28],
			b: [30, 31, 32, 33, 34, 35, 36, 37, 38],
		});

		expect(packed.unity_SHAr).toEqual([13, 11, 12, -6]);
		expect(packed.unity_SHAg).toEqual([23, 21, 22, -6]);
		expect(packed.unity_SHAb).toEqual([33, 31, 32, -6]);
		expect(packed.unity_SHBr).toEqual([14, 15, 48, 17]);
		expect(packed.unity_SHBg).toEqual([24, 25, 78, 27]);
		expect(packed.unity_SHBb).toEqual([34, 35, 108, 37]);
		expect(packed.unity_SHC).toEqual([18, 28, 38, 1]);
	});

	it("rejects malformed coefficient input instead of inventing values", () => {
		expect(() =>
			packUnitySH9({
				r: [0],
				g: Array.from({ length: 9 }, () => 0),
				b: Array.from({ length: 9 }, () => 0),
			}),
		).toThrow("Each sh9 channel must contain nine finite coefficients");
	});
});
