import {
	outputUniforms,
	withOutputTransform,
	updateOutputTransform,
} from "../renderer/outputTransform.js";
import { TextureViews } from "../utils/TextureViews.js";
import {
	checkTextureLimits,
	checkCubeTextureSizes,
} from "../renderer/textureLimits.js";
import {
	BackSide,
	Color,
	GLSL3,
	Matrix4,
	RawShaderMaterial,
	Vector2,
	Vector3,
	Vector4,
	type BufferGeometry,
	type Camera,
	type Group,
	type IUniform,
	type Mesh,
	type Object3D,
	type Scene,
	type Texture,
	type WebGLRenderer,
} from "three";
import {
	LILTOON_DEFAULTS,
	LILTOON_MODE_DEFAULTS,
} from "../generated/defaults.js";
import { LILTOON_UPSTREAM_DESCRIPTION } from "../generated/compatibility.js";
import {
	createGlobalUniforms,
	setGlobalProperty,
	updateObjectCameraUniforms,
	type LilToonGlobalUniforms,
} from "../renderer/LilToonUniformBinder.js";
import { rendererContext } from "../renderer/rendererContext.js";
import {
	MorphWeights,
	updateThreeMorphDefines,
	withThreeMorphTargets,
} from "../renderer/threeMorphTargets.js";
import {
	getLilToonShaderProgram,
	getOutlineShaderProgram,
	type LilToonShaderProgram,
} from "../shader/ShaderProgramLibrary.js";
import { analyzeShaderSource } from "../shader/shaderAnalysis.js";
import {
	collectMaterialWarnings,
	shaderPropertyReferences,
	type LilToonWarning,
} from "../utils/materialWarnings.js";
import { applyLilToonPassState } from "../utils/renderState.js";
import { getNeutralTexture } from "../utils/texture.js";
import {
	detectLilToonFeatures,
	type LilToonFeatureSet,
} from "./LilToonFeatureSet.js";
import type {
	LilToonMaterialParameters,
	LilToonRenderMode,
	LilToonTransparencyMode,
	LilToonPass,
	LilToonScalarOrVector,
} from "./LilToonMaterialParameters.js";
import type { SerializedLilToonMaterial } from "./LilToonMaterialState.js";
import { LILTOON_GLTF_SPEC_VERSION } from "../loaders/types.js";

import {
	assertShaderVariantMatchesModes,
	effectiveTransparency,
	shaderVariants,
	variantForModes,
	isShaderVariant,
	type LilToonShaderVariant,
} from "./shaderVariants.js";
import {
	withVertexInputs,
	updateVertexInputs,
} from "../renderer/vertexInputs.js";

function copyValue(value: LilToonScalarOrVector): LilToonScalarOrVector {
	if (Array.isArray(value)) return [...value];
	if (
		value instanceof Color ||
		value instanceof Vector2 ||
		value instanceof Vector3 ||
		value instanceof Vector4
	) {
		return value.clone();
	}
	return value;
}

function propertyDefaults(
	mode = "opaque",
): Record<string, LilToonScalarOrVector> {
	const defaults: Record<string, LilToonScalarOrVector> = {};
	for (const [name, value] of Object.entries({
		...LILTOON_DEFAULTS,
		...LILTOON_MODE_DEFAULTS[mode],
	})) {
		if (typeof value === "number" || Array.isArray(value))
			defaults[name] = Array.isArray(value) ? [...value] : value;
	}
	return defaults;
}

function textureDefault(property: string): string {
	const value = (LILTOON_DEFAULTS as Record<string, unknown>)[property];
	if (typeof value === "object" && value && "texture" in value)
		return String((value as { texture: string }).texture);
	return "white";
}

export class LilToonMaterial extends RawShaderMaterial {
	color = new Color(1, 1, 1);
	readonly isLilToonMaterial = true;
	readonly lilToonProperties: Record<string, LilToonScalarOrVector>;
	readonly lilToonTextures: Record<string, Texture | null>;
	globalUniforms: LilToonGlobalUniforms;
	#renderQueue: number | undefined;
	/** Effective Unity queue (0-5000); ordering only, never blend or depth state. */
	get renderQueue(): number | undefined {
		return this.#renderQueue;
	}
	set renderQueue(value: number | undefined) {
		if (
			value !== undefined &&
			(!Number.isInteger(value) || value < 0 || value > 5000)
		)
			throw new RangeError(
				"renderQueue must be an integer from 0 to 5000, or undefined",
			);
		this.#renderQueue = value;
	}
	#copying = false;
	// Kurasuai fork: renderMode/transparencyMode are the authoritative selection and
	// shaderVariant is optional source metadata (upstream 0.1.9 made shaderVariant
	// authoritative). Content without a Unity shader (Blender, PBR conversions) has no
	// name to write, and a name must never be invented. Passes are still chosen through
	// upstream's table via variantForModes(renderMode, transparency, outline).
	#renderMode: LilToonRenderMode = "opaque";
	#transparencyMode: LilToonTransparencyMode = "normal";
	#shaderVariant: string | undefined;
	get renderMode(): LilToonRenderMode {
		return this.#renderMode;
	}
	set renderMode(value: LilToonRenderMode) {
		if (value === this.#renderMode) return;
		this.#renderMode = value;
		this.#modesChanged();
	}
	/** Unity transparent pass configuration; meaningful only for renderMode "transparent". */
	get transparencyMode(): LilToonTransparencyMode {
		return this.#transparencyMode;
	}
	set transparencyMode(value: LilToonTransparencyMode) {
		if (value === this.#transparencyMode) return;
		this.#transparencyMode = value;
		this.#modesChanged();
	}
	/** Original Unity shader name, when the source had one. A recognised name must agree with the modes. */
	get shaderVariant(): string | undefined {
		return this.#shaderVariant;
	}
	set shaderVariant(value: string | undefined) {
		assertShaderVariantMatchesModes(
			value,
			this.#renderMode,
			this.#transparencyMode,
		);
		this.#shaderVariant = value;
		if (this.lilToonProperties) this.#refreshFeatureSet();
	}
	/** The upstream table entry that selects this material's surface, transparency and outline passes. */
	get passVariant(): LilToonShaderVariant {
		return variantForModes(
			this.#renderMode,
			effectiveTransparency(this.#renderMode, this.#transparencyMode),
			this.featureSet?.outline ?? false,
		);
	}
	/**
	 * Replace the whole selection at once and rebuild program and render state. Used by
	 * pass proxies following their source, and by callers switching to a named shader.
	 */
	setPassSelection(
		renderMode: LilToonRenderMode,
		transparencyMode: LilToonTransparencyMode = "normal",
		shaderVariant?: string,
	): this {
		assertShaderVariantMatchesModes(
			shaderVariant,
			renderMode,
			transparencyMode,
		);
		this.#renderMode = renderMode;
		this.#transparencyMode = transparencyMode;
		this.#shaderVariant = shaderVariant;
		this.#refreshFeatureSet();
		this.refreshProgram();
		applyLilToonPassState(
			this,
			this.#renderMode,
			this.lilToonProperties,
			this.pass,
			this.propertyRevision,
		);
		return this;
	}
	#modesChanged(): void {
		// Keep a recognised Unity name truthful after a mode convenience edit (alphaTest,
		// renderMode): rename it to the table entry for the new modes with its outline flag.
		// Unknown names are opaque metadata and stay as they are.
		if (isShaderVariant(this.#shaderVariant))
			this.#shaderVariant = variantForModes(
				this.#renderMode,
				effectiveTransparency(this.#renderMode, this.#transparencyMode),
				shaderVariants[this.#shaderVariant][2],
			);
		if (this.lilToonProperties) this.#refreshFeatureSet();
	}
	#refreshFeatureSet(): void {
		this.featureSet = detectLilToonFeatures(
			this.lilToonProperties,
			this.#shaderVariant,
			this.#renderMode,
			this.#transparencyMode,
		);
	}
	pass: LilToonPass;
	featureSet: LilToonFeatureSet;
	readonly #samplerBindings: Map<string, string>;
	readonly #systemTextures = new Map<string, Texture | null>();
	#preparingDraw = false;
	readonly #cubeSamplers: Set<string>;
	#shaderKey: string;
	#program: LilToonShaderProgram;
	readonly #textureViews = new TextureViews();
	readonly #morphWeights = new MorphWeights();
	#usedProperties: ReadonlySet<string>;
	#propertyRevision = 0;
	#textureRevision = 0;
	readonly #textureColorSpaces: Readonly<Record<string, "srgb" | "linear">>;
	#trackedPropertyValues = new WeakMap<object, object>();
	readonly #startedAt = performance.now();
	#renderTimeSeconds: number | null = null;

	/** Explicit shader clock for capture. Null resumes the existing wall clock. */
	get renderTimeSeconds(): number | null {
		return this.#renderTimeSeconds;
	}

	set renderTimeSeconds(value: number | null) {
		if (value !== null && (!Number.isFinite(value) || value < 0)) {
			throw new RangeError(
				"renderTimeSeconds must be null or finite nonnegative seconds",
			);
		}
		this.#renderTimeSeconds = value;
	}

	get propertyRevision(): number {
		return this.#propertyRevision;
	}

	get textureRevision(): number {
		return this.#textureRevision;
	}

	#trackPropertyValue(value: LilToonScalarOrVector): LilToonScalarOrVector {
		if (typeof value !== "object" || value === null) return value;
		const existing = this.#trackedPropertyValues.get(value);
		if (existing) return existing as LilToonScalarOrVector;
		const tracked = new Proxy(value, {
			set: (target, key, next) => {
				const previous = Reflect.get(target, key, target);
				const changed = Reflect.set(target, key, next, target);
				if (changed && !Object.is(previous, next)) this.#propertyRevision++;
				return changed;
			},
			deleteProperty: (target, key) => {
				const existed = Reflect.has(target, key);
				const changed = Reflect.deleteProperty(target, key);
				if (changed && existed) this.#propertyRevision++;
				return changed;
			},
		});
		this.#trackedPropertyValues.set(value, tracked);
		this.#trackedPropertyValues.set(tracked, tracked);
		return tracked as LilToonScalarOrVector;
	}

	// Keep direct public bag edits and nested vector/array writes observable without scanning the bag each draw.
	#createPropertyBag(
		initial: Record<string, LilToonScalarOrVector>,
	): Record<string, LilToonScalarOrVector> {
		const properties = {} as Record<string, LilToonScalarOrVector>;
		for (const [name, value] of Object.entries(initial))
			properties[name] = this.#trackPropertyValue(value);
		const bag: Record<string, LilToonScalarOrVector> = new Proxy(properties, {
			set: (target, key, value, receiver) => {
				// Upstream 0.1.9 reads pass state through `Object.create(bag)` views whose
				// overrides must land on the view itself. Without this, an ordinary write
				// to such a view reaches this trap and would overwrite the source bag
				// (for example `_Cull` from `_PreCull` while preparing a TwoPass prepass).
				if (receiver !== bag)
					return Reflect.defineProperty(receiver as object, key, {
						value,
						writable: true,
						enumerable: true,
						configurable: true,
					});
				const tracked = this.#trackPropertyValue(
					value as LilToonScalarOrVector,
				);
				const previous = Reflect.get(target, key, target);
				const changed = Reflect.set(target, key, tracked, target);
				if (changed && !Object.is(previous, tracked)) this.#propertyRevision++;
				return changed;
			},
			deleteProperty: (target, key) => {
				const existed = Reflect.has(target, key);
				const changed = Reflect.deleteProperty(target, key);
				if (changed && existed) this.#propertyRevision++;
				return changed;
			},
		});
		return bag;
	}

	#createTextureBag(): Record<string, Texture | null> {
		return new Proxy({} as Record<string, Texture | null>, {
			set: (target, key, texture) => {
				const previous = Reflect.get(target, key, target);
				const changed = Reflect.set(target, key, texture, target);
				if (changed && !Object.is(previous, texture)) this.#textureRevision++;
				return changed;
			},
			deleteProperty: (target, key) => {
				const existed = Reflect.has(target, key);
				const changed = Reflect.deleteProperty(target, key);
				if (changed && existed) this.#textureRevision++;
				return changed;
			},
		});
	}

	constructor(parameters: LilToonMaterialParameters = {}) {
		const renderMode = parameters.renderMode ?? "opaque";
		const transparencyMode = parameters.transparencyMode ?? "normal";
		assertShaderVariantMatchesModes(
			parameters.shaderVariant,
			renderMode,
			transparencyMode,
		);
		const pass = parameters.pass ?? "forward";
		const program =
			pass === "outline"
				? getOutlineShaderProgram(
						{ ...propertyDefaults(renderMode), ...parameters.properties },
						parameters.textures,
						renderMode,
					)
				: getLilToonShaderProgram(
						renderMode,
						{ ...propertyDefaults(renderMode), ...parameters.properties },
						parameters.textures,
						pass === "forward" ? false : pass,
					);
		const globalUniforms = createGlobalUniforms(
			program.vertexShader,
			program.fragmentShader,
		);
		const uniforms: Record<string, IUniform> = {
			_Globals: { value: globalUniforms },
			...outputUniforms(),
		};
		const cubeSamplers = new Set([
			...analyzeShaderSource(program.vertexShader).cubeSamplers,
			...analyzeShaderSource(program.fragmentShader).cubeSamplers,
		]);
		for (const [uniformName, property] of program.samplerBindings) {
			uniforms[uniformName] = {
				value:
					property === "__shadow"
						? getNeutralTexture("white")
						: property.startsWith("__") || cubeSamplers.has(uniformName)
							? null
							: getNeutralTexture(textureDefault(property)),
			};
		}
		super({
			name: parameters.name ?? `lilToon ${pass} ${renderMode}`,
			// Three owns the final #version placement because it prepends material
			// defines even for RawShaderMaterial. Generated artifacts retain their
			// standalone directive for offline validation.
			vertexShader: withVertexInputs(
				pass === "fur" || pass === "fur-pre"
					? program.vertexShader
					: withThreeMorphTargets(program.vertexShader),
			).replace(/^#version 300 es\s*/, ""),
			fragmentShader: withOutputTransform(
				program.fragmentShader,
				renderMode === "cutout",
			).replace(/^#version 300 es\s*/, ""),
			glslVersion: GLSL3,
			uniforms,
			lights: false,
			fog: false,
		});
		// Private fields: the accessors would rename or revalidate a half-built material.
		this.#renderMode = renderMode;
		this.#transparencyMode = transparencyMode;
		this.#shaderVariant = parameters.shaderVariant;
		this.renderQueue = parameters.renderQueue;
		this.pass = pass;
		this.forceSinglePass = true;
		this.globalUniforms = globalUniforms;
		this.renderTimeSeconds = parameters.renderTimeSeconds ?? null;
		this.uniforms.mochiyaMorphWeights = this.#morphWeights.uniform;
		this.#samplerBindings = program.samplerBindings;
		this.#textureColorSpaces = parameters.textureColorSpaces ?? {};
		this.#cubeSamplers = cubeSamplers;
		this.#shaderKey = program.key;
		this.#program = program;
		this.#usedProperties = shaderPropertyReferences(
			program.vertexShader,
			program.fragmentShader,
		);
		this.lilToonProperties = this.#createPropertyBag(
			propertyDefaults(renderMode),
		);
		this.lilToonTextures = this.#createTextureBag();
		Object.defineProperty(this, "opacity", {
			configurable: true,
			enumerable: true,
			get: () => {
				const c = this.lilToonProperties._Color;
				return Array.isArray(c) ? (c[3] ?? 1) : c instanceof Vector4 ? c.w : 1;
			},
			set: (alpha: number) => {
				if (this.#copying) return;
				this.syncColor();
				const c = this.lilToonProperties._Color as number[];
				this.setProperty("_Color", [c[0]!, c[1]!, c[2]!, alpha]);
			},
		});
		Object.defineProperty(this, "alphaTest", {
			configurable: true,
			enumerable: true,
			get: () =>
				this.renderMode === "cutout" || this.renderMode === "fur-cutout"
					? Number(this.lilToonProperties._Cutoff ?? 0.5)
					: 0,
			set: (cutoff: number) => {
				if (this.#copying) return;
				if (!["opaque", "cutout", "transparent"].includes(this.renderMode)) {
					this.setProperty("_Cutoff", cutoff);
					return;
				}
				this.renderMode =
					cutoff > 0
						? "cutout"
						: this.renderMode === "transparent" || this.transparent
							? "transparent"
							: "opaque";
				this.transparent = this.renderMode === "transparent";
				this.setProperty("_Cutoff", cutoff);
				this.refreshProgram();
			},
		});

		for (const [name, value] of Object.entries({
			...this.lilToonProperties,
			...parameters.properties,
		})) {
			this.lilToonProperties[name] = copyValue(value);
			setGlobalProperty(this.globalUniforms, name, value);
		}
		for (const [name, value] of Object.entries(parameters.textures ?? {}))
			this.setTexture(name, value);
		this.readColor();
		if (parameters.color !== undefined) {
			this.color.set(parameters.color);
			this.syncColor();
		}
		if (parameters.opacity !== undefined) this.opacity = parameters.opacity;
		if (parameters.map !== undefined) this.map = parameters.map;
		if (parameters.alphaTest !== undefined)
			this.alphaTest = parameters.alphaTest;
		this.featureSet = detectLilToonFeatures(
			this.lilToonProperties,
			this.#shaderVariant,
			this.#renderMode,
			this.#transparencyMode,
		);
		applyLilToonPassState(
			this,
			this.renderMode,
			this.lilToonProperties,
			this.pass,
			this.propertyRevision,
		);
		this.defaultAttributeValues = {
			...this.defaultAttributeValues,
			uv1: [0, 0],
			uv2: [0, 0],
			uv3: [0, 0],
			tangent: [1, 0, 0, 1],
			skinIndex: [0, 0, 0, 0],
			skinWeight: [1, 0, 0, 0],
		} as typeof this.defaultAttributeValues;
		this.onBeforeRender = (
			renderer: WebGLRenderer,
			scene: Scene,
			camera: Camera,
			_geometry: BufferGeometry,
			object: Object3D,
			_group: Group,
		) => {
			this.refreshProgram();
			const preparing = this.#preparingDraw;
			this.#preparingDraw = true;
			try {
				updateVertexInputs(this, _geometry);
				this.bindTextureViews();
				const elapsed =
					this.#renderTimeSeconds ??
					(performance.now() - this.#startedAt) / 1000;
				updateObjectCameraUniforms(
					this.globalUniforms,
					renderer,
					camera,
					object,
					elapsed,
				);
				this.syncColor();
				rendererContext(renderer).prepareMaterial(this, scene);
				this.updateDeformationUniforms(object, renderer);
				checkCubeTextureSizes(renderer, this.uniforms);
				checkTextureLimits(
					renderer,
					this.name,
					this.#program.resources,
					Boolean(
						this.defines.USE_MORPHTARGETS && this.defines.MORPHTARGETS_COUNT,
					),
				);
				updateOutputTransform(
					this,
					renderer,
					this.renderMode === "transparent" &&
						!(
							this.pass === "transparent-pre" &&
							Number(this.lilToonProperties._PreOutType ?? 0) !== 0
						),
				);

				// The glTF loader intentionally shares one material instance between meshes.
				// These globals include per-object model, skinning, and morph data, so Three
				// must upload them for every draw even when the material/program did not
				// change. This is especially important for transparent meshes because their
				// draw order changes as the camera moves.
				this.uniformsNeedUpdate = true;
			} finally {
				this.#preparingDraw = preparing;
			}
		};
	}

	/** The actual compiled program, reselected when texture requirements change. */
	get shaderKey(): string {
		return this.#shaderKey;
	}

	/** Recheck active forward features and textures without logging or changing the material. */
	getWarnings(): LilToonWarning[] {
		if (this.pass !== "forward") return [];
		const fur = this.renderMode.startsWith("fur")
			? getLilToonShaderProgram(
					this.renderMode,
					this.lilToonProperties,
					this.lilToonTextures,
					"fur",
				)
			: undefined;
		const warnings = collectMaterialWarnings({
			materialName: this.name,
			shaderKey: this.shaderKey,
			renderMode: this.renderMode,
			representedTextures: new Set(
				[...this.#program.resources, ...(fur?.resources ?? [])].map(
					(r) => r.property,
				),
			),
			properties: this.lilToonProperties,
			textures: this.lilToonTextures,
			usedProperties: this.#usedProperties,
			samplerBindings: this.#samplerBindings,
			cubeSamplers: this.#cubeSamplers,
		});
		return warnings;
	}

	setProperty(name: string, value: LilToonScalarOrVector): this {
		this.lilToonProperties[name] = copyValue(value);
		setGlobalProperty(this.globalUniforms, name, value);
		if (name === "_Color") this.readColor();
		this.#refreshFeatureSet();
		if (
			/_(?:Outline|Pre|Fur)?(?:Cull|ZWrite|ZTest|SrcBlend|DstBlend|Blend|Stencil|Offset|ColorMask|AlphaToMask)/.test(
				name,
			)
		) {
			applyLilToonPassState(
				this,
				this.renderMode,
				this.lilToonProperties,
				this.pass,
				this.propertyRevision,
			);
		}
		this.refreshProgram();
		return this;
	}

	getProperty<T extends LilToonScalarOrVector = LilToonScalarOrVector>(
		name: string,
	): T | undefined {
		if (name === "_Color") this.syncColor();
		return this.lilToonProperties[name] as T | undefined;
	}

	toLilToonJSON(
		resolveTexture: (
			texture: Texture,
			property: string,
		) => string | number | null = () => null,
	): SerializedLilToonMaterial {
		this.syncColor();
		const properties = Object.fromEntries(
			Object.entries(this.lilToonProperties).map(([name, value]) => [
				name,
				copyValue(value),
			]),
		);
		const textures = Object.fromEntries(
			Object.entries(this.lilToonTextures).map(([name, texture]) => [
				name,
				texture ? resolveTexture(texture, name) : null,
			]),
		);
		return {
			specVersion: LILTOON_GLTF_SPEC_VERSION,
			lilToonVersion: LILTOON_UPSTREAM_DESCRIPTION,
			// Fork form: the modes are always written; the optional fields only when held.
			renderMode: this.renderMode,
			transparencyMode: this.transparencyMode,
			...(this.shaderVariant === undefined
				? {}
				: { shaderVariant: this.shaderVariant }),
			...(this.renderQueue === undefined
				? {}
				: { renderQueue: this.renderQueue }),
			properties,
			textures,
		};
	}

	setTexture(name: string, texture: Texture | null): this {
		this.lilToonTextures[name] = texture;
		this.refreshProgram();
		this.bindTextureViews();
		return this;
	}

	private bindTextureViews(collect?: Set<Texture>): void {
		this.#textureViews.retain(this.#program.resources);
		for (const resource of this.#program.resources) {
			if (resource.property.startsWith("__")) continue;
			const texture = this.#textureViews.get(
				resource,
				this.lilToonTextures,
				this.#textureColorSpaces,
			);
			const isCube = Boolean(
				(texture as (Texture & { isCubeTexture?: boolean }) | null)
					?.isCubeTexture,
			);
			const selected =
				this.#cubeSamplers.has(resource.uniform) === isCube ? texture : null;
			this.uniforms[resource.uniform]!.value = selected;
			if (selected) collect?.add(selected);
		}
	}

	/** @internal Collect the exact views bound by the current draw pass. */
	prepareTextureViews(views: Set<Texture>): void {
		this.bindTextureViews(views);
	}

	override dispose(): void {
		this.#systemTextures.clear();
		this.#morphWeights.dispose();
		this.#textureViews.dispose();
		super.dispose();
	}

	override copy(source: LilToonMaterial): this {
		this.#systemTextures.clear();
		source.syncColor();
		const uniforms = this.uniforms;
		// Base copy writes aliases before our shader selection/properties are copied.
		// Their setters must not reapply destination defaults over source render state.
		this.#copying = true;
		try {
			super.copy(source);
		} finally {
			this.#copying = false;
		}
		const copiedUniforms = this.uniforms;
		for (const key of Object.keys(uniforms)) delete uniforms[key];
		Object.assign(uniforms, copiedUniforms);
		this.uniforms = uniforms;
		this.#morphWeights.dispose();
		this.uniforms.mochiyaMorphWeights = this.#morphWeights.uniform;
		this.renderTimeSeconds = source.renderTimeSeconds;
		// Private fields: the source is already consistent; the accessors would rename
		// or revalidate against a half-copied selection.
		this.#renderMode = source.renderMode;
		this.#transparencyMode = source.transparencyMode;
		this.#shaderVariant = source.shaderVariant;
		this.renderQueue = source.renderQueue;
		this.pass = source.pass;
		this.#shaderKey = source.#shaderKey;
		this.#program = source.#program;
		this.#textureViews.dispose();
		this.#usedProperties = source.#usedProperties;

		// The globals struct is identical before the morph/sRGB source rewrite;
		// the program's source also reuses the shared shader-source parse.
		this.globalUniforms = createGlobalUniforms(
			source.#program.vertexShader,
			source.#program.fragmentShader,
		);
		this.uniforms._Globals = { value: this.globalUniforms };

		for (const name of Object.keys(this.lilToonProperties))
			delete this.lilToonProperties[name];
		for (const [name, value] of Object.entries(source.lilToonProperties)) {
			this.lilToonProperties[name] = copyValue(value);
			setGlobalProperty(this.globalUniforms, name, value);
		}

		for (const name of Object.keys(this.lilToonTextures))
			delete this.lilToonTextures[name];
		Object.assign(this.lilToonTextures, source.lilToonTextures);

		this.#samplerBindings.clear();
		for (const [uniformName, property] of source.#samplerBindings) {
			this.#samplerBindings.set(uniformName, property);
		}
		this.#cubeSamplers.clear();
		for (const uniformName of source.#cubeSamplers)
			this.#cubeSamplers.add(uniformName);

		this.bindTextureViews();
		this.featureSet = { ...source.featureSet };
		this.readColor();
		this.needsUpdate = true;
		return this;
	}

	get map(): Texture | null {
		return this.lilToonTextures._MainTex ?? null;
	}
	set map(texture: Texture | null) {
		this.setTexture("_MainTex", texture);
	}

	private readColor(): void {
		const value = this.lilToonProperties._Color;
		if (Array.isArray(value))
			this.color.setRGB(value[0]!, value[1]!, value[2]!);
		else if (value instanceof Color) this.color.copy(value);
		else if (value instanceof Vector4)
			this.color.setRGB(value.x, value.y, value.z);
	}
	private syncColor(): void {
		const current = this.lilToonProperties._Color;
		const alpha = Array.isArray(current)
			? (current[3] ?? 1)
			: current instanceof Vector4
				? current.w
				: 1;
		const value = [this.color.r, this.color.g, this.color.b, alpha];
		const unchanged =
			(Array.isArray(current) &&
				current[0] === value[0] &&
				current[1] === value[1] &&
				current[2] === value[2] &&
				(current[3] ?? 1) === alpha) ||
			(current instanceof Color &&
				current.r === value[0] &&
				current.g === value[1] &&
				current.b === value[2]) ||
			(current instanceof Vector4 &&
				current.x === value[0] &&
				current.y === value[1] &&
				current.z === value[2] &&
				current.w === alpha);
		if (!unchanged) this.lilToonProperties._Color = value;
		// Keep the per-draw uniform refresh even when the property bag is already current.
		setGlobalProperty(this.globalUniforms, "_Color", value);
	}
	private refreshProgram(): void {
		const program =
			this.pass === "outline"
				? getOutlineShaderProgram(
						this.lilToonProperties,
						this.lilToonTextures,
						this.renderMode,
					)
				: getLilToonShaderProgram(
						this.renderMode,
						this.lilToonProperties,
						this.lilToonTextures,
						this.pass === "forward" ? false : this.pass,
					);
		if (program.key === this.#shaderKey) return;
		this.#program = program;
		this.#shaderKey = program.key;
		this.#usedProperties = shaderPropertyReferences(
			program.vertexShader,
			program.fragmentShader,
		);
		this.vertexShader = withVertexInputs(
			this.pass === "fur" || this.pass === "fur-pre"
				? program.vertexShader
				: withThreeMorphTargets(program.vertexShader),
		).replace(/^#version 300 es\s*/, "");
		this.fragmentShader = withOutputTransform(
			program.fragmentShader,
			this.renderMode === "cutout",
		).replace(/^#version 300 es\s*/, "");
		this.globalUniforms = createGlobalUniforms(
			program.vertexShader,
			program.fragmentShader,
		);
		// Three caches this dictionary on a material's first program compilation.
		// Preserve its identity when revisiting a previously compiled variant.
		for (const name of Object.keys(this.uniforms)) delete this.uniforms[name];
		this.uniforms._Globals = { value: this.globalUniforms };
		Object.assign(this.uniforms, outputUniforms());
		this.uniforms.mochiyaMorphWeights = this.#morphWeights.uniform;
		this.#samplerBindings.clear();
		this.#cubeSamplers.clear();
		for (const shader of [program.vertexShader, program.fragmentShader])
			for (const uniform of analyzeShaderSource(shader).cubeSamplers)
				this.#cubeSamplers.add(uniform);
		for (const [uniform, property] of program.samplerBindings) {
			this.#samplerBindings.set(uniform, property);
			this.uniforms[uniform] = {
				value: this.#systemTextures.has(property)
					? this.#systemTextures.get(property)
					: property === "__shadow"
						? getNeutralTexture("white")
						: property.startsWith("__") || this.#cubeSamplers.has(uniform)
							? null
							: getNeutralTexture(textureDefault(property)),
			};
		}
		for (const [key, value] of Object.entries(this.lilToonProperties))
			setGlobalProperty(this.globalUniforms, key, value);
		this.bindTextureViews();
		this.needsUpdate = true;
	}

	/** @internal Renderer ABI texture binding. */
	setSystemTexture(
		binding:
			| "__environment"
			| "__shadow"
			| "__bones"
			| "__background"
			| "__grab"
			| "__furVertices",
		texture: Texture | null,
	): void {
		// Draw preparation already selected the program before binding lighting and
		// deformation. Pre/post-draw captures still refresh before setting globals.
		if (!this.#preparingDraw) this.refreshProgram();
		// An empty packed-depth sampler must mean far depth, not Three's zero-depth
		// null fallback. Leave other system samplers' fallback semantics unchanged.
		const value =
			binding === "__shadow" && !texture ? getNeutralTexture("white") : texture;
		// Selection is refreshed by material edits and draw preparation. Captures
		// can arrive before that preparation; retain them across program changes.
		this.#systemTextures.set(binding, value);
		for (const [uniformName, property] of this.#samplerBindings) {
			if (property === binding) this.uniforms[uniformName]!.value = value;
		}
	}

	updateDeformationUniforms(object: Object3D, renderer: WebGLRenderer): void {
		const skinned = object as Object3D & {
			isSkinnedMesh?: boolean;
			bindMatrix?: Matrix4;
			bindMatrixInverse?: Matrix4;
			skeleton?: { boneTexture: Texture | null; computeBoneTexture(): unknown };
		};
		this.globalUniforms.uSkinningEnabled = Number(
			Boolean(skinned.isSkinnedMesh && skinned.skeleton),
		);
		if (skinned.isSkinnedMesh && skinned.skeleton) {
			if (!skinned.skeleton.boneTexture) skinned.skeleton.computeBoneTexture();
			this.setSystemTexture("__bones", skinned.skeleton.boneTexture);
			const boneSize = this.globalUniforms.uBoneTextureSize;
			const image = skinned.skeleton.boneTexture?.image as
				{ width?: number; height?: number } | undefined;
			if (boneSize instanceof Vector4) {
				const width = image?.width ?? 1;
				const height = image?.height ?? 1;
				boneSize.set(width, height, 1 / width, 1 / height);
			}
		} else {
			this.setSystemTexture("__bones", null);
		}
		const bindMatrix = this.globalUniforms.uBindMatrix;
		if (bindMatrix instanceof Matrix4 && skinned.bindMatrix)
			bindMatrix.copy(skinned.bindMatrix).transpose();
		const bindMatrixInverse = this.globalUniforms.uBindMatrixInverse;
		if (bindMatrixInverse instanceof Matrix4 && skinned.bindMatrixInverse)
			bindMatrixInverse.copy(skinned.bindMatrixInverse).transpose();
		if ((object as { isMesh?: boolean }).isMesh) {
			updateThreeMorphDefines(this, (object as Mesh).geometry);
			if (
				this.pass !== "fur" &&
				this.pass !== "fur-pre" &&
				Number(this.defines.MORPHTARGETS_COUNT) > 0
			) {
				this.#morphWeights.update(
					object as Mesh,
					renderer.capabilities.maxTextureSize,
				);
				this.uniforms.mochiyaMorphWeights = this.#morphWeights.uniform;
			}
		}
	}
}

/** @internal Prepare the current selector and geometry defines used by onBeforeRender. */
export function prepareLilToonMaterialProgram(
	material: LilToonMaterial,
	geometry: BufferGeometry,
): void {
	(material as unknown as { refreshProgram(): void }).refreshProgram();
	// Three's compile() does not call material.onBeforeRender(). Morph target
	// defines normally arrive there, so precompilation must set them for each
	// mesh before Three derives that mesh's WebGL program cache key.
	updateThreeMorphDefines(material, geometry);
	// Upstream 0.1.9 selects LIL_HAS_<attribute> defines per geometry in onBeforeRender;
	// they are part of the program key too, so set them here as well.
	updateVertexInputs(material, geometry);
}
