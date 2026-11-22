import type {
	Color,
	ColorRepresentation,
	Texture,
	Vector2,
	Vector3,
	Vector4,
} from "three";

export type LilToonRenderMode =
	| "opaque"
	| "cutout"
	| "transparent"
	| "refraction"
	| "refraction-blur"
	| "fur"
	| "fur-cutout"
	| "fur-two-pass"
	| "gem";
export type LilToonTransparencyMode = "normal" | "one-pass" | "two-pass";
export type LilToonPass =
	| "forward"
	| "outline"
	| "fur"
	| "fur-pre"
	| "transparent-pre"
	| "refraction-blur-pre";
export type LilToonTextureColorSpace = "srgb" | "linear";
export type LilToonScalarOrVector =
	number | boolean | number[] | Color | Vector2 | Vector3 | Vector4;

export interface LilToonMaterialParameters {
	color?: ColorRepresentation;
	opacity?: number;
	map?: Texture | null;
	alphaTest?: number;
	name?: string;
	/** Explicit capture clock; null/default uses elapsed wall time. Not a serialized material property. */
	renderTimeSeconds?: number | null;
	/** Authoritative pass selection (Kurasuai fork). Defaults to opaque. */
	renderMode?: LilToonRenderMode;
	/** Original Unity shader name. A recognised name must agree with the modes (LilToonShaderVariantMismatchError); its Outline suffix enables the outline pass. */
	shaderVariant?: string;
	/** Effective Unity queue (0–5000). Requires materialRenderQueue sorting opt-in. */
	renderQueue?: number;
	/** Unity transparent pass configuration for renderMode "transparent"; additional-light passes remain deferred. */
	transparencyMode?: LilToonTransparencyMode;
	properties?: Record<string, LilToonScalarOrVector>;
	textures?: Record<string, Texture | null>;
	/** Effective transfer for each texture binding when supplied by a strict character format. */
	textureColorSpaces?: Readonly<Record<string, LilToonTextureColorSpace>>;
	/** Enables the generated skin/morph vertex ABI. Safe for static meshes too. */
	deformation?: boolean;
	/** @internal Used by automatic outline rendering. */
	pass?: LilToonPass;
}
