import {
	BackSide,
	Mesh,
	MeshBasicMaterial,
	MeshDepthMaterial,
	MeshDistanceMaterial,
	RGBADepthPacking,
	SkinnedMesh,
	type Camera,
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
import { ownsPassSource } from "./passOwnership.js";

type Recipe = {
	owners: Map<Mesh, Object3D>;
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
	private depth = 0;

	begin() {
		this.depth++;
	}
	end() {
		if (--this.depth !== 0) return;
		for (const [source, recipe] of this.recipes) {
			for (const [mesh, root] of recipe.owners)
				if (!ownsPassSource(root, mesh, source)) recipe.owners.delete(mesh);
			if (!recipe.owners.size) recipe.release();
		}
	}
	private recipe(source: LilToonMaterial, mesh: Mesh, scene: Object3D): Recipe {
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
				owners: new Map(),
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
			source.addEventListener("dispose", recipe.release);
		}
		recipe.owners.set(mesh, scene);
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
	prepare(scene: Object3D): () => void {
		const undo: (() => void)[] = [];
		const meshes: Mesh[] = [];
		scene.traverse((node) => {
			if ((node as Mesh).isMesh && !helpers.has(node))
				meshes.push(node as Mesh);
		});
		try {
			for (const mesh of meshes) {
				const materials = Array.isArray(mesh.material)
					? mesh.material
					: [mesh.material];
				const recipes = materials.map((material) =>
					material instanceof LilToonMaterial && material.pass === "forward"
						? this.recipe(material, mesh, scene)
						: undefined,
				);
				const first = recipes.find((recipe) => recipe !== undefined);
				if (!first) continue;
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
					proxy.material = Array.isArray(mesh.material)
						? outlines
						: outlines[0]!;
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
					if (
						recipe &&
						(material === first.depth || material === first.distance)
					) {
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
								(args[6] as { materialIndex?: number } | null)?.materialIndex ??
									0
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
			// Scene callbacks may have moved or inserted objects after Three's initial matrix update.
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

type Installation = {
	release(): void;
	acquire(): () => void;
	compile(scene: Object3D, camera: Camera): Promise<void>;
};
const installations = new WeakMap<WebGLRenderer, Installation>();

function compileLilToonPrograms(
	renderer: WebGLRenderer,
	scene: Object3D,
	camera: Camera,
): Promise<void> {
	const traverse = scene.traverse;
	const traverseVisible = scene.traverseVisible;
	// WebGLRenderer.compile() derives a program for each renderable while
	// traversing, but does not invoke material.onBeforeRender(). Intercept that
	// traversal briefly so each geometry contributes the same morph defines as
	// its first draw, including when one material is shared by several meshes.
	scene.traverse = function (callback) {
		return traverseVisible.call(this, (object) => {
			const mesh = object as Mesh;
			if (mesh.isMesh) {
				const materials = Array.isArray(mesh.material)
					? mesh.material
					: [mesh.material];
				for (const material of materials)
					if (material instanceof LilToonMaterial)
						prepareLilToonMaterialProgram(material, mesh.geometry);
			}
			callback(object);
		});
	};
	try {
		// compileAsync() calls compile() synchronously before returning its promise.
		return renderer.compileAsync(scene, camera).then(() => {});
	} finally {
		scene.traverse = traverse;
	}
}

/** Compile the lilToon variants currently selected for a scene before its first draw. */
export function compileLilToonAsync(
	renderer: WebGLRenderer,
	scene: Object3D,
	camera: Camera,
): Promise<void> {
	const installation = installations.get(renderer);
	if (!installation)
		throw new Error(
			"Call enableLilToon(renderer) before compiling lilToon materials.",
		);
	return installation.compile(scene, camera);
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
		passes.begin();
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
			passes.end();
		}
	};
	const wrappedDispose = () => {
		installation.release();
		dispose.call(renderer);
	};
	const installation: Installation = {
		compile: async (scene, camera) => {
			passes.begin();
			let restore: (() => void) | undefined;
			try {
				restore = prepare(scene);
				// The auxiliary draw renders in separate unlit scenes. Compiling its proxy
				// in the main scene creates a different light-dependent program key.
				const auxiliaryScenes = transparency.prepareForCompile(scene);
				await Promise.all([
					compileLilToonPrograms(renderer, scene, camera),
					...auxiliaryScenes.map((auxiliary) =>
						compileLilToonPrograms(renderer, auxiliary, camera),
					),
				]);
			} finally {
				restore?.();
				passes.end();
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
