import { describe, expect, it, vi } from "vitest";
import {
	BoxGeometry,
	Float32BufferAttribute,
	Group,
	Mesh,
	PerspectiveCamera,
	Scene,
	Vector2,
	Vector4,
	type WebGLRenderer,
} from "three";

vi.mock("../../src/shader/ShaderProgramLibrary.js", () => {
	const makeProgram = (key: string) => ({
		key,
		vertexShader: "in vec4 position;\nvoid main() { gl_Position = position; }",
		fragmentShader: "void main() {}",
		samplerBindings: new Map(),
		resources: [],
	});
	return {
		getLilToonShaderProgram: (
			mode: string,
			_properties: unknown,
			_textures: unknown,
			pass: unknown,
		) => makeProgram(`${String(pass || "forward")}:${mode}`),
		getOutlineShaderProgram: (
			_properties: unknown,
			_textures: unknown,
			mode: string,
		) => makeProgram(`outline:${mode}`),
	};
});

import {
	compileLilToonAsync,
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
		const compileAsync = vi.fn(async (target: Scene) => {
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
		});
		(
			renderer as unknown as { compileAsync: typeof compileAsync }
		).compileAsync = compileAsync;
		const release = enableLilToon(renderer);
		await compileLilToonAsync(renderer, scene, camera);
		expect(compileAsync).toHaveBeenCalledOnce();
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
		const compileAsync = vi.fn(async (target: Scene) => {
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
		});
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
			compileAsync = vi.fn().mockRejectedValue(new Error("shader failure"));
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
		expect(compileAsync).toHaveBeenCalledOnce();
		release();
		material.dispose();
		mesh.geometry.dispose();
	});
});
