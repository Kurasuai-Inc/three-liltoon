import {
	BackSide,
	Mesh,
	MeshBasicMaterial,
	MeshDepthMaterial,
	MeshDistanceMaterial,
	RGBADepthPacking,
	SkinnedMesh,
	type Camera,
	type Material,
	type Scene,
	type WebGLRenderer,
	type Object3D,
	type Texture,
} from "three";
import {
	LilToonMaterial,
	prepareLilToonMaterialProgram,
} from "../material/LilToonMaterial.js";
import { isLilToonOutlineEnabled } from "../material/LilToonFeatureSet.js";
import { setGlobalProperty } from "./LilToonUniformBinder.js";
import { SceneColorPasses } from "./SceneColorPasses.js";
import { FurPasses } from "./FurPasses.js";
import { TransparencyPasses } from "./TransparencyPasses.js";
import { applyLilToonPassState } from "../utils/renderState.js";
import { createTaskPace, type LilToonTaskPacing } from "../utils/taskPacing.js";

type Recipe = {
	source: LilToonMaterial;
	outline: LilToonMaterial;
	depth: MeshDepthMaterial;
	distance: MeshDistanceMaterial;
	shadowAlphaMask: {
		map: { value: Texture | null };
		mode: { value: number };
		scale: { value: number };
		value: { value: number };
	};
	input: Texture | null;
	map: Texture | null;
	propertyRevision: number;
	textureRevision: number;
	renderMode: LilToonMaterial["renderMode"];
	release(): void;
};
const helpers = new WeakSet<Object3D>();
const originalHooks = new WeakMap<
	Object3D["onBeforeRender"],
	Object3D["onBeforeRender"]
>();

// The upstream shadowcaster includes lil_common_frag_alpha.hlsl, so its alpha test
// runs after lil_common_frag.hlsl applies AlphaMask (lines 460–474). Three's
// MeshDepthMaterial only samples the main texture; mirror those four alpha modes
// before its alpha-test chunk so masked hair casts the same silhouette.
function enableShadowAlphaMask(
	material: MeshDepthMaterial | MeshDistanceMaterial,
	bindings: Recipe["shadowAlphaMask"],
): void {
	material.onBeforeCompile = (shader) => {
		shader.uniforms.lilToonAlphaMaskTexture = bindings.map;
		shader.uniforms.lilToonAlphaMaskMode = bindings.mode;
		shader.uniforms.lilToonAlphaMaskScale = bindings.scale;
		shader.uniforms.lilToonAlphaMaskValue = bindings.value;
		if (!shader.fragmentShader.includes("#include <common>"))
			throw new Error("Three shadow shader is missing common.");
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <common>",
			`#include <common>
#if defined(USE_MAP)
uniform sampler2D lilToonAlphaMaskTexture;
#endif
uniform int lilToonAlphaMaskMode;
uniform float lilToonAlphaMaskScale;
uniform float lilToonAlphaMaskValue;`,
		);
		if (!shader.fragmentShader.includes("#include <alphatest_fragment>"))
			throw new Error("Three shadow shader is missing alphatest_fragment.");
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <alphatest_fragment>",
			`if (lilToonAlphaMaskMode >= 1 && lilToonAlphaMaskMode <= 4) {
float lilToonAlpha = 1.0;
#if defined(USE_MAP)
lilToonAlpha = texture(lilToonAlphaMaskTexture, vMapUv).r;
#endif
lilToonAlpha = clamp(lilToonAlpha * lilToonAlphaMaskScale + lilToonAlphaMaskValue, 0.0, 1.0);
if (lilToonAlphaMaskMode == 1) diffuseColor.a = lilToonAlpha;
if (lilToonAlphaMaskMode == 2) diffuseColor.a *= lilToonAlpha;
if (lilToonAlphaMaskMode == 3) diffuseColor.a = clamp(diffuseColor.a + lilToonAlpha, 0.0, 1.0);
if (lilToonAlphaMaskMode == 4) diffuseColor.a = clamp(diffuseColor.a - lilToonAlpha, 0.0, 1.0);
}
#include <alphatest_fragment>`,
		);
	};
	material.customProgramCacheKey = () => "liltoon-shadow-alpha-mask-v1";
}

/** Renderer-owned recipes; helpers exist in the scene only during rendering. */
class AutomaticPasses {
	private readonly recipes = new Map<LilToonMaterial, Recipe>();
	private readonly proxies = new WeakMap<Mesh, Mesh>();
	private readonly hidden = new MeshBasicMaterial({ visible: false });
	private recipe(source: LilToonMaterial): Recipe {
		let recipe = this.recipes.get(source);
		if (!recipe) {
			const outline = new LilToonMaterial({
				pass: "outline",
				renderMode: source.renderMode,
				properties: source.lilToonProperties,
				textures: source.lilToonTextures,
			});
			const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
			const distance = new MeshDistanceMaterial();
			const shadowAlphaMask = {
				map: { value: null as Texture | null },
				mode: { value: 0 },
				scale: { value: 1 },
				value: { value: 0 },
			};
			enableShadowAlphaMask(depth, shadowAlphaMask);
			enableShadowAlphaMask(distance, shadowAlphaMask);
			recipe = {
				source,
				outline,
				depth,
				distance,
				shadowAlphaMask,
				input: null,
				map: null,
				propertyRevision: -1,
				textureRevision: -1,
				renderMode: source.renderMode,
				release: () => {
					source.removeEventListener("dispose", recipe!.release);
					outline.dispose();
					depth.dispose();
					distance.dispose();
					recipe!.map?.dispose();
					this.recipes.delete(source);
				},
			};
			this.recipes.set(source, recipe);
			// A source can be absent from one render while the app temporarily swaps
			// materials (for example selective bloom). Only source disposal or this
			// renderer's explicit teardown ends the helper lifetime.
			source.addEventListener("dispose", recipe.release);
		}
		// Keep automatic outlines on the same explicit capture clock on every draw.
		recipe.outline.renderTimeSeconds = source.renderTimeSeconds;
		// Read mutable standard Color edits as well as original property setters.
		source.getProperty("_Color");
		const propertiesChanged =
			recipe.propertyRevision !== source.propertyRevision ||
			recipe.renderMode !== source.renderMode;
		const texturesChanged = recipe.textureRevision !== source.textureRevision;
		// Per-draw object/camera uniforms still refresh in onBeforeRender; only copied outline inputs are gated here.
		if (propertiesChanged) {
			for (const [name, value] of Object.entries(source.lilToonProperties)) {
				recipe.outline.lilToonProperties[name] = value;
				setGlobalProperty(recipe.outline.globalUniforms, name, value);
			}
			recipe.outline.setProperty("_Color", source.getProperty("_Color")!);
			recipe.outline.renderMode = source.renderMode;
			applyLilToonPassState(
				recipe.outline,
				source.renderMode,
				source.lilToonProperties,
				"outline",
				recipe.outline.propertyRevision,
			);
			recipe.propertyRevision = source.propertyRevision;
			recipe.renderMode = source.renderMode;
		}
		if (texturesChanged) {
			for (const [name, texture] of Object.entries(source.lilToonTextures)) {
				if (recipe.outline.lilToonTextures[name] !== texture)
					recipe.outline.setTexture(name, texture);
			}
			recipe.textureRevision = source.textureRevision;
		}
		recipe.outline.visible = source.visible;
		const inputChanged = recipe.input !== source.map;
		if (inputChanged) {
			recipe.map?.dispose();
			recipe.input = source.map;
			recipe.map = source.map?.clone() ?? null;
			if (recipe.map) recipe.map.matrixAutoUpdate = false;
		}
		if (recipe.map && (propertiesChanged || inputChanged)) {
			const st = source.getProperty("_MainTex_ST");
			const v = Array.isArray(st)
				? st
				: st && typeof st === "object" && "toArray" in st
					? st.toArray()
					: [1, 1, 0, 0];
			recipe.map.matrix.setUvTransform(
				v[2] ?? 0,
				v[3] ?? 0,
				v[0] ?? 1,
				v[1] ?? 1,
				0,
				0,
				0,
			);
		}
		return recipe;
	}
	private prepareMesh(mesh: Mesh, undo: (() => void)[]): void {
		const materials = Array.isArray(mesh.material)
			? mesh.material
			: [mesh.material];
		const recipes = materials.map((material) =>
			material instanceof LilToonMaterial && material.pass === "forward"
				? this.recipe(material)
				: undefined,
		);
		const first = recipes.find((recipe) => recipe !== undefined);
		if (!first) return;
		const outlines = recipes.map((recipe) =>
			recipe &&
			recipe.source.renderMode !== "transparent" &&
			isLilToonOutlineEnabled(
				recipe.source.lilToonProperties,
				recipe.source.shaderVariant,
			) &&
			Number(recipe.source.lilToonProperties._OutlineWidth ?? 0) > 0
				? recipe.outline
				: this.hidden,
		);
		// Legacy manually attached outlines are honored without generating a duplicate.
		const manualOutline = mesh.children.some(
			(child) =>
				!helpers.has(child) &&
				(child as Mesh).isMesh &&
				((child as Mesh).material as LilToonMaterial)?.pass === "outline",
		);
		if (
			!manualOutline &&
			outlines.some((material) => material !== this.hidden)
		) {
			let proxy = this.proxies.get(mesh);
			if (!proxy) {
				proxy = (mesh as SkinnedMesh).isSkinnedMesh
					? new SkinnedMesh(mesh.geometry, first.outline)
					: new Mesh(mesh.geometry, first.outline);
				proxy.name = `${mesh.name}:lilToon-outline`;
				proxy.matrixAutoUpdate = false;
				proxy.raycast = () => {};
				helpers.add(proxy);
				this.proxies.set(mesh, proxy);
			}
			proxy.geometry = mesh.geometry;
			proxy.material = Array.isArray(mesh.material) ? outlines : outlines[0]!;
			proxy.visible = mesh.visible;
			proxy.layers.mask = mesh.layers.mask;
			proxy.frustumCulled = mesh.frustumCulled;
			proxy.renderOrder = mesh.renderOrder - 1;
			proxy.morphTargetDictionary = mesh.morphTargetDictionary;
			proxy.morphTargetInfluences = mesh.morphTargetInfluences;
			if ((proxy as SkinnedMesh).isSkinnedMesh) {
				const skin = proxy as SkinnedMesh,
					source = mesh as SkinnedMesh;
				skin.skeleton = source.skeleton;
				skin.bindMode = source.bindMode;
				skin.bindMatrix.copy(source.bindMatrix);
				skin.bindMatrixInverse.copy(source.bindMatrixInverse);
				skin.boundingBox = source.boundingBox;
				skin.boundingSphere = source.boundingSphere;
			}
			const priorParent = proxy.parent;
			mesh.add(proxy);
			undo.push(() => {
				proxy!.removeFromParent();
				priorParent?.add(proxy!);
			});
		}
		const depth = mesh.customDepthMaterial,
			distance = mesh.customDistanceMaterial;
		// Authored custom casters are authoritative. Defaults are installed temporarily.
		if (!depth) mesh.customDepthMaterial = first.depth;
		if (!distance) mesh.customDistanceMaterial = first.distance;
		const before = mesh.onBeforeShadow;
		const hook: Mesh["onBeforeShadow"] = (...args) => {
			const material = args[5] as MeshDepthMaterial | MeshDistanceMaterial;
			const recipe =
				recipes[
					(args[6] as { materialIndex?: number } | null)?.materialIndex ?? 0
				];
			if (recipe && (material === first.depth || material === first.distance)) {
				if (!!material.map !== !!recipe.map) material.needsUpdate = true;
				material.map = recipe.map;
				material.alphaMap = null;
				material.alphaTest = recipe.source.alphaTest;
				material.opacity = recipe.source.opacity;
				const alphaMaskMode = Number(
					recipe.source.getProperty("_AlphaMaskMode") ?? 0,
				);
				const alphaMask = recipe.source.lilToonTextures._AlphaMask ?? null;
				if (alphaMaskMode !== 0 && !alphaMask)
					throw new Error(
						"An enabled lilToon shadow alpha mask requires _AlphaMask texture data.",
					);
				if (alphaMaskMode !== 0 && !recipe.map)
					throw new Error(
						"lilToon shadow alpha masks require the source main texture UV transform.",
					);
				// Bind a valid texture even while the mode is disabled: the shadow shader
				// keeps its sampler declaration whenever Three enables USE_MAP.
				recipe.shadowAlphaMask.map.value =
					alphaMaskMode === 0 ? recipe.map : alphaMask;
				recipe.shadowAlphaMask.mode.value = alphaMaskMode;
				recipe.shadowAlphaMask.scale.value = Number(
					recipe.source.getProperty("_AlphaMaskScale") ?? 1,
				);
				recipe.shadowAlphaMask.value.value = Number(
					recipe.source.getProperty("_AlphaMaskValue") ?? 0,
				);
			} else if (
				!recipe &&
				(material === first.depth || material === first.distance)
			) {
				material.opacity =
					materials[
						(args[6] as { materialIndex?: number } | null)?.materialIndex ?? 0
					]?.opacity ?? 1;
			}
			before.apply(mesh, args);
		};
		mesh.onBeforeShadow = hook;
		undo.push(() => {
			if (mesh.customDepthMaterial === first.depth)
				mesh.customDepthMaterial = depth;
			if (mesh.customDistanceMaterial === first.distance)
				mesh.customDistanceMaterial = distance;
			if (mesh.onBeforeShadow === hook) mesh.onBeforeShadow = before;
		});
	}
	prepare(scene: Object3D): () => void {
		const undo: (() => void)[] = [];
		const meshes: Mesh[] = [];
		scene.traverse((node) => {
			if ((node as Mesh).isMesh && !helpers.has(node))
				meshes.push(node as Mesh);
		});
		try {
			for (const mesh of meshes) this.prepareMesh(mesh, undo);
			// Scene callbacks may have moved or inserted objects after Three's initial matrix update.
			scene.updateMatrixWorld();
		} catch (error) {
			undo.reverse().forEach((restore) => restore());
			throw error;
		}
		return () => undo.reverse().forEach((restore) => restore());
	}
	/** Same pass installation as prepare(), paced across tasks between meshes. */
	async prepareAsync(
		scene: Object3D,
		pace: () => Promise<void>,
	): Promise<() => void> {
		const undo: (() => void)[] = [];
		const meshes: Mesh[] = [];
		scene.traverse((node) => {
			if ((node as Mesh).isMesh && !helpers.has(node))
				meshes.push(node as Mesh);
		});
		try {
			for (const mesh of meshes) {
				this.prepareMesh(mesh, undo);
				await pace();
			}
			scene.updateMatrixWorld();
		} catch (error) {
			undo.reverse().forEach((restore) => restore());
			throw error;
		}
		return () => undo.reverse().forEach((restore) => restore());
	}
	dispose() {
		for (const recipe of this.recipes.values()) recipe.release();
		this.hidden.dispose();
	}
}

/**
 * A paced lilToon program compile in progress. Create one with
 * {@link createLilToonProgramCompileSession}, then drive one GL program
 * submission per {@link submitNext} call so callers can give each program its
 * own task instead of compiling an entire scene in one synchronous sweep.
 */
export interface LilToonProgramCompileSession {
	/** Renderable units whose programs have not been submitted yet. */
	readonly pending: number;
	/** True once every unit has been submitted to the GL. */
	readonly submitted: boolean;
	/**
	 * Submit the next unit's program. Returns false once nothing is left, so
	 * `while (session.submitNext())` drains the session. Each call issues at
	 * most one material's compile/link for a single renderable.
	 */
	submitNext(): boolean;
	/**
	 * Submit the texture uploads for the session's scenes. Call this while
	 * async program compilation is still in flight. Idempotent.
	 */
	prepareTextures(): void;
	/**
	 * Resolve once every submitted program reports ready through
	 * KHR_parallel_shader_compile (or immediately when the extension is
	 * unavailable, matching WebGLRenderer.compileAsync()).
	 */
	settle(): Promise<void>;
	/** Undo the pass hooks installed while compiling. Idempotent. */
	release(): void;
}

type Installation = {
	release(): void;
	acquire(): () => void;
	createSession(
		scene: Object3D,
		camera: Camera,
		pacing?: LilToonTaskPacing,
	): Promise<LilToonProgramCompileSession>;
};
const installations = new WeakMap<WebGLRenderer, Installation>();

type RenderableObject = Object3D & {
	isMesh?: boolean;
	isPoints?: boolean;
	isLine?: boolean;
	isSprite?: boolean;
	material?: Material | Material[];
};

type CompileUnit = {
	// Programs depend on the target scene's light state, so every unit keeps
	// the scene it was enumerated from as its compile target.
	readonly targetScene: Object3D;
	readonly object: RenderableObject;
	readonly material: Material;
};

// The compile sweep previously visited only visible renderables (the wrapped
// traverse delegated to traverseVisible); enumerate the same set so the paced
// driver submits every program the unbroken sweep would have submitted — and
// no more.
function collectCompileUnits(roots: readonly Object3D[]): CompileUnit[] {
	const units: CompileUnit[] = [];
	for (const targetScene of roots)
		targetScene.traverseVisible((object) => {
			const renderable = object as RenderableObject;
			if (
				!(
					renderable.isMesh ||
					renderable.isPoints ||
					renderable.isLine ||
					renderable.isSprite
				) ||
				renderable.material === undefined ||
				renderable.material === null
			)
				return;
			const materials = Array.isArray(renderable.material)
				? renderable.material
				: [renderable.material];
			for (const material of materials)
				units.push({ targetScene, object: renderable, material });
		});
	return units;
}

function submitCompileUnit(
	renderer: WebGLRenderer,
	camera: Camera,
	unit: CompileUnit,
): Promise<Object3D> {
	// WebGLRenderer.compile() does not invoke material.onBeforeRender(). Morph
	// target defines normally arrive there, so set them for each geometry
	// before Three derives that mesh's WebGL program cache key.
	if (unit.object.isMesh && unit.material instanceof LilToonMaterial)
		prepareLilToonMaterialProgram(
			unit.material,
			(unit.object as Mesh).geometry,
		);
	// compile() submits a program for every material of each traversed object.
	// Present a view carrying only this unit's material so one submitNext()
	// issues exactly one program's GL compile/link, even on multi-material
	// meshes. Property reads fall through to the real object.
	let view: RenderableObject = unit.object;
	if (Array.isArray(unit.object.material)) {
		view = Object.create(unit.object) as RenderableObject;
		view.material = unit.material;
	}
	// compile() traverses the "new" scene for renderables and the target scene
	// for lights. A traverse shim yields this unit alone; light gathering on
	// the shim is a no-op because its only object is not a light. compileAsync
	// additionally returns this unit's KHR_parallel_shader_compile wait, which
	// the session collects for settle().
	const scope = {
		traverse(callback: (object: Object3D) => void) {
			callback(view);
		},
		traverseVisible() {},
	};
	return renderer.compileAsync(
		scope as unknown as Object3D,
		camera,
		unit.targetScene as Scene,
	);
}

function waitForSubmittedCompiles(
	isExhausted: () => boolean,
	compiles: readonly Promise<void>[],
): Promise<void> {
	// Settle may be invoked while units are still being submitted, so drain the
	// live list until every submitted compileAsync wait has resolved.
	return new Promise((resolve, reject) => {
		let awaited = 0;
		const check = async () => {
			try {
				while (awaited < compiles.length) await compiles[awaited++];
				if (isExhausted() && awaited === compiles.length) {
					resolve();
					return;
				}
				setTimeout(check, 10);
			} catch (error) {
				reject(error);
			}
		};
		check();
	});
}

function prepareLilToonTextureViews(
	renderer: WebGLRenderer,
	roots: readonly Object3D[],
): void {
	const views = new Set<Texture>();
	for (const root of roots)
		root.traverseVisible((object) => {
			const mesh = object as Mesh;
			if (!mesh.isMesh) return;
			const materials = Array.isArray(mesh.material)
				? mesh.material
				: [mesh.material];
			for (const material of materials)
				if (material instanceof LilToonMaterial)
					material.prepareTextureViews(views);
		});
	if (views.size === 0) return;
	const properties = (
		renderer as unknown as {
			properties?: { get(value: object): { __version?: number } };
		}
	).properties;
	if (!properties)
		throw new Error("WebGLRenderer texture cache is unavailable.");
	// A clone can advance a shared Source after the caller uploaded it. Only
	// refresh a Source when Three's actual GPU cache is behind that version.
	const staleSources = new Set(
		[...views]
			.filter((view) => {
				const cachedVersion = properties.get(view.source).__version;
				return (
					cachedVersion !== undefined && cachedVersion !== view.source.version
				);
			})
			.map((view) => view.source),
	);
	const stale = [...views].filter((view) => staleSources.has(view.source));
	// One mark per shared Source is enough to advance its image version. Marking
	// every material view causes repeated transfers of the same GPU image.
	const marked = new Set<Texture["source"]>();
	for (const view of stale)
		if (!marked.has(view.source)) {
			view.needsUpdate = true;
			marked.add(view.source);
		}
	// Distinct sampler/color-space cache keys still need their own GL handle.
	for (const view of stale) renderer.initTexture(view);
}

/** Compile the lilToon variants currently selected for a scene before its first draw. */
export function compileLilToonAsync(
	renderer: WebGLRenderer,
	scene: Object3D,
	camera: Camera,
	pacing?: LilToonTaskPacing,
): Promise<void> {
	const installation = installations.get(renderer);
	if (!installation)
		throw new Error(
			"Call enableLilToon(renderer) before compiling lilToon materials.",
		);
	return installation
		.createSession(scene, camera, pacing)
		.then(async (session) => {
			try {
				while (session.submitNext()) {
					// One GL program submission per iteration.
				}
				session.prepareTextures();
				await session.settle();
			} finally {
				session.release();
			}
		});
}

/**
 * Start a lilToon program compile that submits one program per
 * {@link LilToonProgramCompileSession.submitNext} call, so a caller can spread
 * the GL submissions across tasks instead of running the full scene's
 * compile/link sweep inside one synchronous block.
 */
export function createLilToonProgramCompileSession(
	renderer: WebGLRenderer,
	scene: Object3D,
	camera: Camera,
	pacing?: LilToonTaskPacing,
): Promise<LilToonProgramCompileSession> {
	const installation = installations.get(renderer);
	if (!installation)
		throw new Error(
			"Call enableLilToon(renderer) before compiling lilToon materials.",
		);
	return installation.createSession(scene, camera, pacing);
}

/** Install automatic passes on an existing renderer. Release the returned lease on teardown. */
export function enableLilToon(renderer: WebGLRenderer): () => void {
	const existing = installations.get(renderer);
	if (existing) return existing.acquire();
	const passes = new AutomaticPasses();
	const sceneColors = new SceneColorPasses();
	const fur = new FurPasses();
	const transparency = new TransparencyPasses();
	const render = renderer.render,
		dispose = renderer.dispose;
	let users = 0,
		disposed = false;
	const prepare = (scene: Object3D): (() => void) => {
		const restore: (() => void)[] = [];
		try {
			restore.push(passes.prepare(scene));
			restore.push(sceneColors.prepare(renderer, scene, render));
			restore.push(fur.prepare(renderer, scene, render));
			restore.push(transparency.prepare(renderer, scene, render));
		} catch (error) {
			restore.reverse().forEach((undo) => undo());
			throw error;
		}
		return () => restore.reverse().forEach((undo) => undo());
	};
	const wrapped: WebGLRenderer["render"] = function (scene, camera) {
		const previous = scene.onBeforeRender;
		const original = originalHooks.get(previous) ?? previous;
		let restore: (() => void) | undefined;
		const hook: Object3D["onBeforeRender"] = function (
			this: Object3D,
			...args
		) {
			original.apply(this, args);
			restore ??= prepare(scene);
		};
		originalHooks.set(hook, original);
		scene.onBeforeRender = hook;
		try {
			// Three invokes the scene hook before collecting render lists and shadows.
			if (!(scene as { isScene?: boolean }).isScene) restore = prepare(scene);
			render.call(renderer, scene, camera);
		} finally {
			restore?.();
			if (scene.onBeforeRender === hook) scene.onBeforeRender = previous;
		}
	};
	const wrappedDispose = () => {
		installation.release();
		dispose.call(renderer);
	};
	const installation: Installation = {
		createSession: async (scene, camera, pacing) => {
			// Recipe construction is the synchronous unit; pace() yields between
			// meshes so precompilation does not stall the main thread in one task.
			const pace = createTaskPace(pacing);
			const restores: (() => void)[] = [];
			let released = false;
			const release = () => {
				if (released) return;
				released = true;
				restores.reverse().forEach((undo) => undo());
			};
			try {
				restores.push(await passes.prepareAsync(scene, pace));
				restores.push(sceneColors.prepare(renderer, scene, render));
				restores.push(fur.prepare(renderer, scene, render));
				restores.push(transparency.prepare(renderer, scene, render));
			} catch (error) {
				release();
				throw error;
			}
			// The auxiliary draw renders in separate unlit scenes. Compiling its proxy
			// in the main scene creates a different light-dependent program key.
			try {
				const auxiliaryScenes = await transparency.prepareForCompile(
					scene,
					pace,
				);
				const roots = [scene, ...auxiliaryScenes];
				const units = collectCompileUnits(roots);
				const compiles: Promise<void>[] = [];
				let next = 0;
				let texturesPrepared = false;
				return {
					get pending() {
						return units.length - next;
					},
					get submitted() {
						return next >= units.length;
					},
					submitNext() {
						if (released)
							throw new Error(
								"LilToonProgramCompileSession was already released.",
							);
						const unit = units[next];
						if (unit === undefined) return false;
						next++;
						const compile = submitCompileUnit(renderer, camera, unit).then(
							() => {},
						);
						// Rejections surface through settle(); suppress the unhandled-
						// rejection warning for callers that never wait on it.
						compile.catch(() => {});
						compiles.push(compile);
						return true;
					},
					prepareTextures() {
						if (released)
							throw new Error(
								"LilToonProgramCompileSession was already released.",
							);
						if (texturesPrepared) return;
						texturesPrepared = true;
						prepareLilToonTextureViews(renderer, roots);
					},
					settle() {
						if (released)
							throw new Error(
								"LilToonProgramCompileSession was already released.",
							);
						return waitForSubmittedCompiles(
							() => next >= units.length,
							compiles,
						);
					},
					release,
				};
			} catch (error) {
				release();
				throw error;
			}
		},
		release: () => {
			if (disposed) return;
			disposed = true;
			if (renderer.render === wrapped) renderer.render = render;
			if (renderer.dispose === wrappedDispose) renderer.dispose = dispose;
			passes.dispose();
			sceneColors.dispose();
			fur.dispose();
			transparency.dispose();
			installations.delete(renderer);
		},
		acquire: () => {
			users++;
			let released = false;
			return () => {
				if (released || disposed) return;
				released = true;
				if (--users === 0) installation.release();
			};
		},
	};
	installations.set(renderer, installation);
	renderer.render = wrapped;
	renderer.dispose = wrappedDispose;
	return installation.acquire();
}
