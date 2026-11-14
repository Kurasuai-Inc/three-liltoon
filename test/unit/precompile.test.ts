import { describe, expect, it, vi } from "vitest";
import {
	AmbientLight,
	BoxGeometry,
	Float32BufferAttribute,
	Group,
	Mesh,
	Object3D,
	PerspectiveCamera,
	Scene,
	Texture,
	Vector2,
	Vector4,
	type WebGLRenderer,
} from "three";

vi.mock("../../src/shader/ShaderProgramLibrary.js", () => {
	const makeProgram = (key: string, textures?: Record<string, unknown>) => ({
		key,
		vertexShader: "in vec4 position;\nvoid main() { gl_Position = position; }",
		fragmentShader: "void main() {}",
		samplerBindings: textures?._MainTex
			? new Map([["u_MainTex", "_MainTex"]])
			: new Map(),
		resources: textures?._MainTex
			? [
					{
						property: "_MainTex",
						uniform: "u_MainTex",
						sampler: "lil_sampler_linear",
					},
				]
			: [],
	});
	return {
		getLilToonShaderProgram: (
			mode: string,
			_properties: unknown,
			textures: Record<string, unknown> | undefined,
			pass: unknown,
		) => makeProgram(`${String(pass || "forward")}:${mode}`, textures),
		getOutlineShaderProgram: (
			_properties: unknown,
			textures: Record<string, unknown> | undefined,
			mode: string,
		) => makeProgram(`outline:${mode}`, textures),
	};
});

import {
	compileLilToonAsync,
	createLilToonProgramCompileSession,
	enableLilToon,
	LilToonMaterial,
} from "../../src/index.js";

function makeRenderer(draw: (scene: Scene, camera: PerspectiveCamera) => void) {
	return {
		capabilities: { maxTextureSize: 4096 },
		info: { render: { frame: 0 }, autoReset: true },
		shadowMap: { enabled: false, autoUpdate: true, needsUpdate: false },
		autoClear: true,
		getContext: () => ({ getParameter: () => 32 }),
		getRenderTarget: () => null,
		getDrawingBufferSize: (value: Vector2) => value.set(32, 32),
		getViewport: (value: Vector4) => value.set(0, 0, 32, 32),
		getScissor: (value: Vector4) => value.set(0, 0, 32, 32),
		getScissorTest: () => false,
		setViewport: vi.fn(),
		setScissor: vi.fn(),
		setScissorTest: vi.fn(),
		render(this: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
			scene.updateMatrixWorld();
			scene.onBeforeRender(
				this as unknown as WebGLRenderer,
				scene,
				camera,
				undefined!,
				undefined!,
				undefined!,
			);
			draw(scene, camera);
			this.info.render.frame++;
		},
		dispose: vi.fn(),
	} as unknown as WebGLRenderer;
}

function programSignature(material: LilToonMaterial): string {
	// Three's full cache key also includes renderer capabilities; these are the
	// material-controlled inputs that must match between compile and first draw.
	return JSON.stringify({
		pass: material.pass,
		shaderKey: material.shaderKey,
		customProgramCacheKey: material.customProgramCacheKey(),
		defines: material.defines,
	});
}

describe("compileLilToonAsync", () => {
	it("prepares the same texture view that the first and later draws bind", async () => {
		const scene = new Scene();
		const camera = new PerspectiveCamera();
		const source = new Texture();
		const material = new LilToonMaterial({ textures: { _MainTex: source } });
		const mesh = new Mesh(new BoxGeometry(), material);
		scene.add(mesh);
		let renderer: WebGLRenderer;
		renderer = makeRenderer((current, activeCamera) => {
			material.onBeforeRender(
				renderer,
				current,
				activeCamera,
				mesh.geometry,
				mesh,
				new Group(),
			);
		});
		const cached = { __version: source.source.version };
		const initTexture = vi.fn((view: Texture) => {
			cached.__version = view.source.version;
		});
		Object.assign(renderer, {
			compileAsync: vi.fn(async () => scene),
			properties: { get: () => cached },
			initTexture,
		});
		const release = enableLilToon(renderer);

		await compileLilToonAsync(renderer, scene, camera);
		const prepared = material.uniforms.u_MainTex!.value as Texture;
		expect(initTexture).toHaveBeenCalledWith(prepared);
		expect(prepared.source).toBe(source.source);
		expect(cached.__version).toBe(source.source.version);
		const version = source.source.version;
		renderer.render(scene, camera);
		renderer.render(scene, camera);
		expect(material.uniforms.u_MainTex!.value).toBe(prepared);
		expect(source.source.version).toBe(version);
		expect(initTexture).toHaveBeenCalledOnce();

		release();
		material.dispose();
		mesh.geometry.dispose();
		source.dispose();
	});

	it("precompiles the cached transparent pre and outline programs used by the first draw", async () => {
		const scene = new Scene(),
			camera = new PerspectiveCamera(),
			material = new LilToonMaterial({
				renderMode: "transparent",
				properties: { _UseOutline: 1, _OutlineWidth: 0.1 },
			}),
			mesh = new Mesh(new BoxGeometry(), material);
		material.transparencyMode = "two-pass";
		scene.add(new AmbientLight());
		scene.add(mesh);
		const compiledKeys: string[] = [],
			drawnKeys: string[] = [];
		let renderer: WebGLRenderer;
		renderer = makeRenderer((current, activeCamera) => {
			current.traverse((object) => {
				const drawable = object as Mesh;
				if (!drawable.isMesh) return;
				const currentMaterial = drawable.material as LilToonMaterial;
				if (!(currentMaterial instanceof LilToonMaterial)) return;
				const group = new Group();
				drawable.onBeforeRender(
					renderer,
					current,
					activeCamera,
					drawable.geometry,
					currentMaterial,
					group,
				);
				currentMaterial.onBeforeRender(
					renderer,
					current,
					activeCamera,
					drawable.geometry,
					drawable,
					group,
				);
				drawnKeys.push(programSignature(currentMaterial));
				drawable.onAfterRender(
					renderer,
					current,
					activeCamera,
					drawable.geometry,
					currentMaterial,
					group,
				);
			});
		});
		const compileAsync = vi.fn(
			async (
				target: Scene,
				_camera: PerspectiveCamera,
				_targetScene?: Scene,
			) => {
				target.traverse((object) => {
					const drawable = object as Mesh;
					if (drawable.isMesh && drawable.material instanceof LilToonMaterial)
						compiledKeys.push(programSignature(drawable.material));
				});
				return target;
			},
		);
		(
			renderer as unknown as { compileAsync: typeof compileAsync }
		).compileAsync = compileAsync;
		const release = enableLilToon(renderer);

		await compileLilToonAsync(renderer, scene, camera);
		expect(compileAsync).toHaveBeenCalledTimes(3);
		expect(compileAsync.mock.calls[0]![2]).toBe(scene);
		for (const call of compileAsync.mock.calls.slice(1))
			expect(
				(call[2] as Scene).children.some(
					(child) => (child as AmbientLight).isLight,
				),
			).toBe(false);
		expect(mesh.children).toHaveLength(0);
		expect(new Set(compiledKeys).size).toBe(3);
		renderer.render(scene, camera);
		expect(new Set(drawnKeys)).toEqual(new Set(compiledKeys));

		release();
		material.dispose();
		mesh.geometry.dispose();
	});

	it("compiles the same selected forward and outline keys used by the first draw", async () => {
		const scene = new Scene(),
			camera = new PerspectiveCamera(),
			material = new LilToonMaterial({
				properties: { _UseOutline: 1, _OutlineWidth: 0.1 },
			}),
			mesh = new Mesh(new BoxGeometry(), material);
		scene.add(mesh);
		const compiledKeys: string[] = [],
			drawnKeys: string[] = [];
		let renderer: WebGLRenderer;
		renderer = makeRenderer((current, activeCamera) => {
			current.traverse((object) => {
				const drawable = object as Mesh;
				if (!drawable.isMesh) return;
				const materials = Array.isArray(drawable.material)
					? drawable.material
					: [drawable.material];
				for (const currentMaterial of materials) {
					if (!(currentMaterial instanceof LilToonMaterial)) continue;
					currentMaterial.onBeforeRender(
						renderer,
						current,
						activeCamera,
						drawable.geometry,
						drawable,
						new Group(),
					);
					drawnKeys.push(currentMaterial.shaderKey);
				}
			});
		});
		const compileAsync = vi.fn(
			async (
				target: Scene,
				_camera: PerspectiveCamera,
				_targetScene?: Scene,
			) => {
				target.traverse((object) => {
					const drawable = object as Mesh;
					if (!drawable.isMesh) return;
					const materials = Array.isArray(drawable.material)
						? drawable.material
						: [drawable.material];
					for (const currentMaterial of materials)
						if (currentMaterial instanceof LilToonMaterial)
							compiledKeys.push(currentMaterial.shaderKey);
				});
				return target;
			},
		);
		(
			renderer as unknown as { compileAsync: typeof compileAsync }
		).compileAsync = compileAsync;
		const release = enableLilToon(renderer);
		await compileLilToonAsync(renderer, scene, camera);
		// One compileAsync call per renderable unit: the forward mesh and the
		// outline helper.
		expect(compileAsync).toHaveBeenCalledTimes(2);
		expect(compiledKeys).toHaveLength(2);
		expect(new Set(compiledKeys)).toEqual(
			new Set(["forward:opaque", "outline:opaque"]),
		);
		expect(mesh.children).toHaveLength(0);

		renderer.render(scene, camera);
		expect(new Set(drawnKeys)).toEqual(new Set(compiledKeys));
		expect(new Set(drawnKeys).size).toBe(new Set(compiledKeys).size);
		release();
		material.dispose();
		mesh.geometry.dispose();
	});

	it("precompiles each geometry's morph defines without an extra first-draw program", async () => {
		const scene = new Scene(),
			camera = new PerspectiveCamera(),
			material = new LilToonMaterial(),
			geometryWithOneMorph = new BoxGeometry(),
			geometryWithTwoMorphs = new BoxGeometry();
		for (const [geometry, count] of [
			[geometryWithOneMorph, 1],
			[geometryWithTwoMorphs, 2],
		] as const) {
			const position = geometry.getAttribute("position");
			geometry.morphAttributes.position = Array.from(
				{ length: count },
				() => new Float32BufferAttribute(position.array.slice(), 3),
			);
		}
		const firstMesh = new Mesh(geometryWithOneMorph, material),
			secondMesh = new Mesh(geometryWithTwoMorphs, material);
		scene.add(firstMesh, secondMesh);
		const compiledKeys: string[] = [],
			drawnKeys: string[] = [];
		let renderer: WebGLRenderer;
		renderer = makeRenderer((current, activeCamera) => {
			current.traverse((object) => {
				const mesh = object as Mesh;
				if (!mesh.isMesh) return;
				const materials = Array.isArray(mesh.material)
					? mesh.material
					: [mesh.material];
				for (const currentMaterial of materials) {
					if (!(currentMaterial instanceof LilToonMaterial)) continue;
					currentMaterial.onBeforeRender(
						renderer,
						current,
						activeCamera,
						mesh.geometry,
						mesh,
						new Group(),
					);
					drawnKeys.push(programSignature(currentMaterial));
				}
			});
		});
		const compileAsync = vi.fn(
			async (
				target: Scene,
				_camera: PerspectiveCamera,
				_targetScene?: Scene,
			) => {
				target.traverse((object) => {
					const mesh = object as Mesh;
					if (!mesh.isMesh) return;
					const materials = Array.isArray(mesh.material)
						? mesh.material
						: [mesh.material];
					for (const currentMaterial of materials)
						if (currentMaterial instanceof LilToonMaterial)
							compiledKeys.push(programSignature(currentMaterial));
				});
				return target;
			},
		);
		(
			renderer as unknown as { compileAsync: typeof compileAsync }
		).compileAsync = compileAsync;
		const release = enableLilToon(renderer);

		await compileLilToonAsync(renderer, scene, camera);
		renderer.render(scene, camera);

		expect(new Set(compiledKeys)).toEqual(new Set(drawnKeys));
		expect(new Set(compiledKeys).size).toBe(2);
		expect(new Set(drawnKeys).size).toBe(2);
		release();
		material.dispose();
		geometryWithOneMorph.dispose();
		geometryWithTwoMorphs.dispose();
	});

	it("paces pass preparation through the injected yieldControl", async () => {
		const scene = new Scene(),
			camera = new PerspectiveCamera(),
			material = new LilToonMaterial(),
			first = new Mesh(new BoxGeometry(), material),
			second = new Mesh(new BoxGeometry(), material);
		scene.add(first, second);
		const renderer = makeRenderer(() => {});
		(
			renderer as unknown as { compileAsync: (target: Scene) => Promise<Scene> }
		).compileAsync = vi.fn(async (target: Scene) => target);
		const release = enableLilToon(renderer);
		const yieldControl = vi.fn(() => Promise.resolve());

		await compileLilToonAsync(renderer, scene, camera, {
			budgetMs: 0,
			yieldControl,
		});
		// Two forward meshes in prepareAsync; neither produces auxiliary scenes.
		expect(yieldControl).toHaveBeenCalledTimes(4);

		release();
		material.dispose();
		first.geometry.dispose();
		second.geometry.dispose();
	});

	it("submits one program per submitNext call through the compile session", async () => {
		const scene = new Scene(),
			camera = new PerspectiveCamera(),
			first = new Mesh(new BoxGeometry(), new LilToonMaterial()),
			second = new Mesh(new BoxGeometry(), new LilToonMaterial());
		scene.add(first, second);
		const renderer = makeRenderer(() => {});
		const compileAsync = vi.fn(
			async (
				target: Scene,
				_camera: PerspectiveCamera,
				_targetScene?: Scene,
			) => {
				const compiled: Object3D[] = [];
				target.traverse((object) => compiled.push(object));
				expect(compiled).toHaveLength(1);
				return target;
			},
		);
		(
			renderer as unknown as { compileAsync: typeof compileAsync }
		).compileAsync = compileAsync;
		const release = enableLilToon(renderer);

		const session = await createLilToonProgramCompileSession(
			renderer,
			scene,
			camera,
		);
		try {
			expect(session.pending).toBe(2);
			expect(session.submitted).toBe(false);
			expect(session.submitNext()).toBe(true);
			expect(compileAsync).toHaveBeenCalledOnce();
			expect(compileAsync.mock.calls[0]![2]).toBe(scene);
			expect(session.pending).toBe(1);
			expect(session.submitNext()).toBe(true);
			expect(session.submitNext()).toBe(false);
			expect(session.submitted).toBe(true);
			expect(compileAsync).toHaveBeenCalledTimes(2);
			session.prepareTextures();
			await session.settle();
		} finally {
			session.release();
		}

		release();
		first.geometry.dispose();
		second.geometry.dispose();
		(first.material as LilToonMaterial).dispose();
		(second.material as LilToonMaterial).dispose();
	});

	it("rejects session calls after release", async () => {
		const scene = new Scene(),
			camera = new PerspectiveCamera(),
			mesh = new Mesh(new BoxGeometry(), new LilToonMaterial());
		scene.add(mesh);
		const renderer = makeRenderer(() => {});
		(
			renderer as unknown as {
				compileAsync: (target: Scene) => Promise<Scene>;
			}
		).compileAsync = vi.fn(async (target: Scene) => target);
		const release = enableLilToon(renderer);

		const session = await createLilToonProgramCompileSession(
			renderer,
			scene,
			camera,
		);
		session.release();
		expect(() => session.submitNext()).toThrow(
			"LilToonProgramCompileSession was already released.",
		);

		release();
		mesh.geometry.dispose();
		(mesh.material as LilToonMaterial).dispose();
	});

	it("requires the renderer pass installation", () => {
		const renderer = makeRenderer(() => {}),
			scene = new Scene(),
			camera = new PerspectiveCamera();
		expect(() => compileLilToonAsync(renderer, scene, camera)).toThrow(
			"Call enableLilToon(renderer) before compiling lilToon materials.",
		);
	});

	it("restores temporary pass attachments when compilation rejects", async () => {
		const scene = new Scene(),
			camera = new PerspectiveCamera(),
			material = new LilToonMaterial({
				properties: { _UseOutline: 1, _OutlineWidth: 0.1 },
			}),
			mesh = new Mesh(new BoxGeometry(), material),
			hostHook = vi.fn();
		scene.add(mesh);
		scene.onBeforeRender = hostHook;
		const renderer = makeRenderer(() => {}),
			compileAsync = vi
				.fn<
					(
						target: Scene,
						camera: PerspectiveCamera,
						targetScene?: Scene,
					) => Promise<Scene>
				>()
				.mockRejectedValue(new Error("shader failure"));
		(
			renderer as unknown as { compileAsync: typeof compileAsync }
		).compileAsync = compileAsync;
		const release = enableLilToon(renderer);

		await expect(compileLilToonAsync(renderer, scene, camera)).rejects.toThrow(
			"shader failure",
		);
		expect(mesh.children).toHaveLength(0);
		expect(mesh.customDepthMaterial).toBeUndefined();
		expect(mesh.customDistanceMaterial).toBeUndefined();
		expect(scene.onBeforeRender).toBe(hostHook);
		expect(compileAsync).toHaveBeenCalledTimes(2);
		release();
		material.dispose();
		mesh.geometry.dispose();
	});
});
