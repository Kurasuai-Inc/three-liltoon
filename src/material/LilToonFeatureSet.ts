import {
	effectiveTransparency,
	shaderVariants,
	variantForModes,
} from "./shaderVariants.js";
import type {
	LilToonRenderMode,
	LilToonScalarOrVector,
	LilToonTransparencyMode,
} from "./LilToonMaterialParameters.js";

export interface LilToonFeatureSet {
	main2nd: boolean;
	main3rd: boolean;
	shadow: boolean;
	shadow3rd: boolean;
	normal1st: boolean;
	normal2nd: boolean;
	matcap: boolean;
	matcap2nd: boolean;
	rim: boolean;
	emission1st: boolean;
	emission2nd: boolean;
	reflection: boolean;
	anisotropy: boolean;
	backlight: boolean;
	outline: boolean;
	dissolve: boolean;
}

function enabled(
	properties: Record<string, LilToonScalarOrVector>,
	name: string,
): boolean {
	const value = properties[name];
	return typeof value === "boolean"
		? value
		: typeof value === "number" && value !== 0;
}

function colorVisible(value: LilToonScalarOrVector | undefined): boolean {
	if (Array.isArray(value)) return Number(value[3] ?? value[0] ?? 0) !== 0;
	return typeof value === "number" && value !== 0;
}

export function detectLilToonFeatures(
	properties: Record<string, LilToonScalarOrVector>,
	shaderVariant?: string,
	renderMode: LilToonRenderMode = "opaque",
	transparencyMode: LilToonTransparencyMode = "normal",
): LilToonFeatureSet {
	return {
		main2nd: enabled(properties, "_UseMain2ndTex"),
		main3rd: enabled(properties, "_UseMain3rdTex"),
		shadow: enabled(properties, "_UseShadow"),
		shadow3rd:
			enabled(properties, "_UseShadow") &&
			colorVisible(properties._Shadow3rdColor),
		normal1st: enabled(properties, "_UseBumpMap"),
		normal2nd: enabled(properties, "_UseBump2ndMap"),
		matcap: enabled(properties, "_UseMatCap"),
		matcap2nd: enabled(properties, "_UseMatCap2nd"),
		rim: enabled(properties, "_UseRim"),
		emission1st: enabled(properties, "_UseEmission"),
		emission2nd: enabled(properties, "_UseEmission2nd"),
		reflection: enabled(properties, "_UseReflection"),
		anisotropy: enabled(properties, "_UseAnisotropy"),
		backlight: enabled(properties, "_UseBacklight"),
		// Requested outline (shader name, or _UseOutline without one) is kept only where
		// upstream's table has an outline pass for the modes (none for fur/gem/refraction).
		outline:
			shaderVariants[
				variantForModes(
					renderMode,
					effectiveTransparency(renderMode, transparencyMode),
					isLilToonOutlineEnabled(properties, shaderVariant),
				)
			][2],
		dissolve:
			Array.isArray(properties._DissolveParams) &&
			Number(properties._DissolveParams[0]) !== 0,
	};
}

/**
 * Kurasuai fork: an enabled outline with zero width draws nothing, so its pass (and
 * program) is skipped. Every outline draw and its precompile use this one condition.
 */
export function isLilToonOutlineDrawn(
	featureSet: LilToonFeatureSet,
	properties: Record<string, LilToonScalarOrVector>,
): boolean {
	return featureSet.outline && Number(properties._OutlineWidth ?? 0) > 0;
}

/**
 * Unity lilToon enables outlines through the Outline shader variant. `_UseOutline`
 * is the selector only for Multi shaders; it is not the enable flag on Outline variants.
 * Materials created without source shader metadata retain property-driven behavior.
 */
export function isLilToonOutlineEnabled(
	properties: Record<string, LilToonScalarOrVector>,
	shaderVariant?: string,
): boolean {
	const useOutline = enabled(properties, "_UseOutline");
	if (shaderVariant === undefined) return useOutline;
	const name = shaderVariant.split("/").at(-1)?.toLowerCase() ?? "";
	if (name.includes("multi")) return useOutline;
	return name.endsWith("outline");
}
