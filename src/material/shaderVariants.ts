import type {
	LilToonRenderMode,
	LilToonTransparencyMode,
} from "./LilToonMaterialParameters.js";

/** Supported Unity shader names and their pass configurations. */
export const shaderVariants = {
	lilToon: ["opaque", "normal", false],
	"Hidden/lilToonOutline": ["opaque", "normal", true],
	"Hidden/lilToonCutout": ["cutout", "normal", false],
	"Hidden/lilToonCutoutOutline": ["cutout", "normal", true],
	"Hidden/lilToonTransparent": ["transparent", "normal", false],
	"Hidden/lilToonTransparentOutline": ["transparent", "normal", true],
	"Hidden/lilToonOnePassTransparent": ["transparent", "one-pass", false],
	"Hidden/lilToonOnePassTransparentOutline": ["transparent", "one-pass", true],
	"Hidden/lilToonTwoPassTransparent": ["transparent", "two-pass", false],
	"Hidden/lilToonTwoPassTransparentOutline": ["transparent", "two-pass", true],
	"Hidden/lilToonRefraction": ["refraction", "normal", false],
	"Hidden/lilToonRefractionBlur": ["refraction-blur", "normal", false],
	"Hidden/lilToonFur": ["fur", "normal", false],
	"Hidden/lilToonFurCutout": ["fur-cutout", "normal", false],
	"Hidden/lilToonFurTwoPass": ["fur-two-pass", "normal", false],
	"Hidden/lilToonGem": ["gem", "normal", false],
} as const;
export type LilToonShaderVariant = keyof typeof shaderVariants;
export function isShaderVariant(
	value: string | undefined,
): value is LilToonShaderVariant {
	return value !== undefined && Object.hasOwn(shaderVariants, value);
}
export function variantForModes(
	mode: LilToonRenderMode,
	transparency: LilToonTransparencyMode = "normal",
	outline = false,
): LilToonShaderVariant {
	const entries = Object.entries(shaderVariants);
	const candidates = entries.filter(
		([, v]) => v[0] === mode && v[1] === transparency,
	);
	const match = candidates.find(([, v]) => v[2] === outline) ?? candidates[0];
	if (!match)
		throw new Error(
			`Unsupported lilToon pass configuration: ${mode}/${transparency}`,
		);
	return match[0] as LilToonShaderVariant;
}
/**
 * Kurasuai fork: transparencyMode only selects among the transparent variants; every
 * other render mode has a single "normal" transparency entry in the table.
 */
export function effectiveTransparency(
	mode: LilToonRenderMode,
	transparency: LilToonTransparencyMode = "normal",
): LilToonTransparencyMode {
	return mode === "transparent" ? transparency : "normal";
}

/**
 * A recognised Unity shader name that selects different passes than the authoritative
 * renderMode/transparencyMode. The fork keeps the modes as the single source and the
 * name as metadata, so a disagreement is an input error rather than a silent override.
 */
export class LilToonShaderVariantMismatchError extends Error {
	readonly code = "LILTOON_SHADER_VARIANT_MISMATCH";
	constructor(
		readonly shaderVariant: LilToonShaderVariant,
		readonly renderMode: LilToonRenderMode,
		readonly transparencyMode: LilToonTransparencyMode,
	) {
		const [mode, transparency] = shaderVariants[shaderVariant];
		super(
			`lilToon shaderVariant ${shaderVariant} selects ${mode}/${transparency}, but the material modes are ${renderMode}/${effectiveTransparency(renderMode, transparencyMode)}.`,
		);
		this.name = "LilToonShaderVariantMismatchError";
	}
}

/** Unknown names are opaque source metadata (for example lilToonMulti) and are not checked. */
export function assertShaderVariantMatchesModes(
	shaderVariant: string | undefined,
	renderMode: LilToonRenderMode,
	transparencyMode: LilToonTransparencyMode = "normal",
): void {
	if (!isShaderVariant(shaderVariant)) return;
	const [mode, transparency] = shaderVariants[shaderVariant];
	if (
		mode !== renderMode ||
		transparency !== effectiveTransparency(renderMode, transparencyMode)
	)
		throw new LilToonShaderVariantMismatchError(
			shaderVariant,
			renderMode,
			transparencyMode,
		);
}
