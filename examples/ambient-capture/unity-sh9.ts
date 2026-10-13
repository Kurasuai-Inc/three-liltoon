export type UnitySH9 = { r: number[]; g: number[]; b: number[] };

export type LilToonSHUniforms = Record<
	| "unity_SHAr"
	| "unity_SHAg"
	| "unity_SHAb"
	| "unity_SHBr"
	| "unity_SHBg"
	| "unity_SHBb"
	| "unity_SHC",
	[number, number, number, number]
>;

export function packUnitySH9(sh9: UnitySH9): LilToonSHUniforms {
	for (const channel of [sh9.r, sh9.g, sh9.b]) {
		if (
			channel.length !== 9 ||
			channel.some((coefficient) => !Number.isFinite(coefficient))
		)
			throw new Error("Each sh9 channel must contain nine finite coefficients");
	}
	const [r, g, b] = [sh9.r, sh9.g, sh9.b];
	// Unity FPSSample PackCoefficients uses this layout; lilToon's lilShadeSH9
	// evaluates the same polynomial terms. Retain every coefficient unchanged.
	return {
		unity_SHAr: [r[3], r[1], r[2], r[0] - r[6]],
		unity_SHAg: [g[3], g[1], g[2], g[0] - g[6]],
		unity_SHAb: [b[3], b[1], b[2], b[0] - b[6]],
		unity_SHBr: [r[4], r[5], 3 * r[6], r[7]],
		unity_SHBg: [g[4], g[5], 3 * g[6], g[7]],
		unity_SHBb: [b[4], b[5], 3 * b[6], b[7]],
		unity_SHC: [r[8], g[8], b[8], 1],
	};
}
