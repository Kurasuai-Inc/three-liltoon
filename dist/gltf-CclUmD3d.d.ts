import { b as LilToonWarning } from './GLTFLilToonExtension-CSCk4cIj.js';
import { Color, Vector2, Vector3, Vector4, ColorRepresentation, Texture, Matrix4, RawShaderMaterial, Object3D, WebGLRenderer, Loader, LoadingManager } from 'three';

type LilToonRenderMode = "opaque" | "cutout" | "transparent" | "refraction" | "refraction-blur" | "fur" | "fur-cutout" | "fur-two-pass" | "gem";
type LilToonTransparencyMode = "normal" | "one-pass" | "two-pass";
type LilToonPass = "forward" | "outline" | "fur" | "fur-pre" | "transparent-pre" | "refraction-blur-pre";
type LilToonTextureColorSpace = "srgb" | "linear";
type LilToonScalarOrVector = number | boolean | number[] | Color | Vector2 | Vector3 | Vector4;
interface LilToonMaterialParameters {
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

type UniformPrimitive = number | Matrix4 | Vector2 | Vector3 | Vector4 | UniformPrimitive[];
type LilToonGlobalUniforms = Record<string, UniformPrimitive>;

interface LilToonFeatureSet {
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
declare function detectLilToonFeatures(properties: Record<string, LilToonScalarOrVector>, shaderVariant?: string, renderMode?: LilToonRenderMode, transparencyMode?: LilToonTransparencyMode): LilToonFeatureSet;

interface SerializedLilToonMaterial {
    specVersion?: string;
    lilToonVersion?: string | number;
    renderMode: LilToonRenderMode;
    shaderVariant?: string;
    /** Effective Unity material queue. Does not change blending or depth state.
     * @asType integer
     * @minimum 0
     * @maximum 5000
     */
    renderQueue?: number;
    transparencyMode?: LilToonTransparencyMode;
    properties: Record<string, LilToonScalarOrVector>;
    textures: Record<string, string | number | null>;
}

/** Supported Unity shader names and their pass configurations. */
declare const shaderVariants: {
    readonly lilToon: readonly ["opaque", "normal", false];
    readonly "Hidden/lilToonOutline": readonly ["opaque", "normal", true];
    readonly "Hidden/lilToonCutout": readonly ["cutout", "normal", false];
    readonly "Hidden/lilToonCutoutOutline": readonly ["cutout", "normal", true];
    readonly "Hidden/lilToonTransparent": readonly ["transparent", "normal", false];
    readonly "Hidden/lilToonTransparentOutline": readonly ["transparent", "normal", true];
    readonly "Hidden/lilToonOnePassTransparent": readonly ["transparent", "one-pass", false];
    readonly "Hidden/lilToonOnePassTransparentOutline": readonly ["transparent", "one-pass", true];
    readonly "Hidden/lilToonTwoPassTransparent": readonly ["transparent", "two-pass", false];
    readonly "Hidden/lilToonTwoPassTransparentOutline": readonly ["transparent", "two-pass", true];
    readonly "Hidden/lilToonRefraction": readonly ["refraction", "normal", false];
    readonly "Hidden/lilToonRefractionBlur": readonly ["refraction-blur", "normal", false];
    readonly "Hidden/lilToonFur": readonly ["fur", "normal", false];
    readonly "Hidden/lilToonFurCutout": readonly ["fur-cutout", "normal", false];
    readonly "Hidden/lilToonFurTwoPass": readonly ["fur-two-pass", "normal", false];
    readonly "Hidden/lilToonGem": readonly ["gem", "normal", false];
};
type LilToonShaderVariant = keyof typeof shaderVariants;
/**
 * A recognised Unity shader name that selects different passes than the authoritative
 * renderMode/transparencyMode. The fork keeps the modes as the single source and the
 * name as metadata, so a disagreement is an input error rather than a silent override.
 */
declare class LilToonShaderVariantMismatchError extends Error {
    readonly shaderVariant: LilToonShaderVariant;
    readonly renderMode: LilToonRenderMode;
    readonly transparencyMode: LilToonTransparencyMode;
    readonly code = "LILTOON_SHADER_VARIANT_MISMATCH";
    constructor(shaderVariant: LilToonShaderVariant, renderMode: LilToonRenderMode, transparencyMode: LilToonTransparencyMode);
}

declare class LilToonMaterial extends RawShaderMaterial {
    #private;
    color: Color;
    readonly isLilToonMaterial = true;
    readonly lilToonProperties: Record<string, LilToonScalarOrVector>;
    readonly lilToonTextures: Record<string, Texture | null>;
    globalUniforms: LilToonGlobalUniforms;
    /** Effective Unity queue (0-5000); ordering only, never blend or depth state. */
    get renderQueue(): number | undefined;
    set renderQueue(value: number | undefined);
    get renderMode(): LilToonRenderMode;
    set renderMode(value: LilToonRenderMode);
    /** Unity transparent pass configuration; meaningful only for renderMode "transparent". */
    get transparencyMode(): LilToonTransparencyMode;
    set transparencyMode(value: LilToonTransparencyMode);
    /** Original Unity shader name, when the source had one. A recognised name must agree with the modes. */
    get shaderVariant(): string | undefined;
    set shaderVariant(value: string | undefined);
    /** The upstream table entry that selects this material's surface, transparency and outline passes. */
    get passVariant(): LilToonShaderVariant;
    /**
     * Replace the whole selection at once and rebuild program and render state. Used by
     * pass proxies following their source, and by callers switching to a named shader.
     */
    setPassSelection(renderMode: LilToonRenderMode, transparencyMode?: LilToonTransparencyMode, shaderVariant?: string): this;
    pass: LilToonPass;
    featureSet: LilToonFeatureSet;
    /** Explicit shader clock for capture. Null resumes the existing wall clock. */
    get renderTimeSeconds(): number | null;
    set renderTimeSeconds(value: number | null);
    get propertyRevision(): number;
    get textureRevision(): number;
    constructor(parameters?: LilToonMaterialParameters);
    /** The actual compiled program, reselected when texture requirements change. */
    get shaderKey(): string;
    /** Recheck active forward features and textures without logging or changing the material. */
    getWarnings(): LilToonWarning[];
    setProperty(name: string, value: LilToonScalarOrVector): this;
    getProperty<T extends LilToonScalarOrVector = LilToonScalarOrVector>(name: string): T | undefined;
    toLilToonJSON(resolveTexture?: (texture: Texture, property: string) => string | number | null): SerializedLilToonMaterial;
    setTexture(name: string, texture: Texture | null): this;
    private bindTextureViews;
    /** @internal Collect the exact views bound by the current draw pass. */
    prepareTextureViews(views: Set<Texture>): void;
    dispose(): void;
    copy(source: LilToonMaterial): this;
    get map(): Texture | null;
    set map(texture: Texture | null);
    private readColor;
    private syncColor;
    private refreshProgram;
    /** @internal Renderer ABI texture binding. */
    setSystemTexture(binding: "__environment" | "__shadow" | "__bones" | "__background" | "__grab" | "__furVertices", texture: Texture | null): void;
    updateDeformationUniforms(object: Object3D, renderer: WebGLRenderer): void;
}

declare class LilToonMaterialLoader extends Loader<LilToonMaterial> {
    /** Non-fatal compatibility warnings. Omit to log them to the console. */
    onWarning?: (warning: LilToonWarning) => void;
    constructor(manager?: LoadingManager);
    parse(json: string | SerializedLilToonMaterial): LilToonMaterial;
    load(url: string, onLoad: (material: ReturnType<LilToonMaterialLoader["parse"]>) => void, onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): void;
}

declare const LILTOON_GLTF_EXTENSION = "MOCHIYA_materials_liltoon";
declare const LILTOON_GLTF_SPEC_VERSION = "1.3";
/**
 * A zero-based glTF index.
 * @asType integer
 * @minimum 0
 */
type GLTFIndex = number;
/** JSON property values. Colors and vectors use numeric arrays, not Three.js objects. */
type GLTFLilToonPropertyValue = number | boolean | number[];
/** A reference to a texture in the enclosing glTF document. */
interface GLTFLilToonTextureInfo {
    /** Index into the glTF textures array. */
    index: GLTFIndex;
    /**
     * Texture coordinate set. The current renderer uses TEXCOORD_0 only.
     * @default 0
     */
    texCoord?: GLTFIndex;
}
/** Linear, little-endian RGBA binary16 cubemap in glTF world coordinates. */
interface GLTFLilToonCubeTextureInfo {
    encoding: "rgba16f-linear";
    /** Square base face size; power of two. @asType integer @minimum 1 */
    size: number;
    /** Base level followed by every authored level down to 1x1, or base only.
     * Each bufferView contains six tightly packed faces: +X,-X,+Y,-Y,+Z,-Z.
     * @minItems 1
     */
    mipmaps: GLTFIndex[];
}
/** Material extension payload at materials[i].extensions.MOCHIYA_materials_liltoon. */
interface GLTFLilToonMaterialDefinition {
    /** Extension version. When omitted, the current version is assumed. */
    specVersion?: "1.0" | "1.1" | "1.2" | typeof LILTOON_GLTF_SPEC_VERSION;
    /** Source lilToon version, retained as metadata. */
    lilToonVersion?: string | number;
    /** Original Unity shader name; retained for render-mode inference when renderMode is absent and for Outline/Multi semantics. A recognised name must agree with renderMode/transparencyMode. */
    shaderVariant?: string;
    /** Effective Unity material queue. Does not change blending or depth state.
     * @asType integer
     * @minimum 0
     * @maximum 5000
     */
    renderQueue?: number;
    /** Authoritative pass selection; the fork writer always writes it. When omitted (older writers), inferred from the original supported shader family. */
    renderMode?: LilToonRenderMode;
    /** Transparent family pass configuration. Defaults to normal or is inferred from shaderVariant. */
    transparencyMode?: LilToonTransparencyMode;
    /** Original property names and linear values, including per-texture <name>_ST transforms. */
    properties?: Record<string, GLTFLilToonPropertyValue>;
    /** Original texture property names mapped to glTF texture indices or texture-info objects. */
    textures?: Record<string, GLTFLilToonTextureInfo | GLTFIndex>;
    /** Direction-sampled resources, separate from ordinary glTF 2D textures. */
    cubeTextures?: Record<string, GLTFLilToonCubeTextureInfo>;
}

export { type GLTFLilToonCubeTextureInfo as G, LilToonMaterial as L, type SerializedLilToonMaterial as S, type LilToonGlobalUniforms as a, type LilToonMaterialParameters as b, LILTOON_GLTF_EXTENSION as c, LILTOON_GLTF_SPEC_VERSION as d, type LilToonFeatureSet as e, LilToonMaterialLoader as f, type LilToonRenderMode as g, type LilToonScalarOrVector as h, type LilToonShaderVariant as i, LilToonShaderVariantMismatchError as j, type LilToonTransparencyMode as k, detectLilToonFeatures as l, type GLTFLilToonMaterialDefinition as m, type GLTFLilToonPropertyValue as n, type GLTFLilToonTextureInfo as o };
