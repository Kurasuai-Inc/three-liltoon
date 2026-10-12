import {
	AmbientLight,
	CubeTexture,
	DataTexture,
	DataUtils,
	GLSL3,
	HalfFloatType,
	LinearFilter,
	LinearSRGBColorSpace,
	Mesh,
	OrthographicCamera,
	PlaneGeometry,
	RawShaderMaterial,
	RGBAFormat,
	Scene,
	Vector3,
	WebGLRenderer,
	WebGLRenderTarget,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFLilToonExtension } from "../../dist/gltf.js";
import { LilToonMaterial, enableLilToon } from "../../dist/index.js";

export async function verifyCubeTransport(input?: number[]) {
	const checks: Record<string, boolean> = {};
	const details: unknown[] = [];
	const loader = new GLTFLoader().register(
		(parser) => new GLTFLilToonExtension(parser),
	);
	// Test the ordinary public loader, with real binary data and shared descriptors.
	let document: string | ArrayBuffer;
	if (input) document = new Uint8Array(input).buffer;
	else {
		const size = 4;
		const levels: Uint16Array[] = [4, 2, 1].map((width, mip) => {
			const pixels = new Uint16Array(width * width * 6 * 4);
			for (let face = 0; face < 6; face++)
				for (let i = 0; i < width * width; i++) {
					const start = (face * width * width + i) * 4;
					[face + 1, mip + 0.25, i / (width * width), 1].forEach(
						(value, c) => (pixels[start + c] = DataUtils.toHalfFloat(value)),
					);
				}
			return pixels;
		});
		const bytes = new Uint8Array(levels.reduce((n, x) => n + x.byteLength, 0));
		let offset = 0;
		const bufferViews = levels.map((level) => {
			const view = {
				buffer: 0,
				byteOffset: offset,
				byteLength: level.byteLength,
			};
			bytes.set(new Uint8Array(level.buffer), offset);
			offset += level.byteLength;
			return view;
		});
		const definition = {
			specVersion: "1.3",
			properties: {
				_UseReflection: 1,
				_ApplyReflection: 1,
				_ReflectionCubeOverride: 1,
				_ReflectionCubeColor: [1, 1, 1, 1],
				_ReflectionCubeEnableLighting: 0,
				_Metallic: 1,
				_Smoothness: 1,
				_ApplySpecular: 0,
				_Color: [0.1, 0.1, 0.1, 1],
			},
			cubeTextures: {
				_ReflectionCubeTex: {
					encoding: "rgba16f-linear",
					size,
					mipmaps: [0, 1, 2],
				},
			},
		};
		document = JSON.stringify({
			asset: { version: "2.0" },
			extensionsUsed: ["MOCHIYA_materials_liltoon"],
			buffers: [
				{
					byteLength: bytes.length,
					uri:
						"data:application/octet-stream;base64," +
						btoa(String.fromCharCode(...bytes)),
				},
			],
			bufferViews,
			materials: [
				{ extensions: { MOCHIYA_materials_liltoon: definition } },
				{ extensions: { MOCHIYA_materials_liltoon: definition } },
			],
			scenes: [{ nodes: [] }],
			scene: 0,
		});
	}
	const gltf = await loader.parseAsync(document, "");
	const loaded = (await gltf.parser.getDependencies(
		"material",
	)) as LilToonMaterial[];
	const materials = loaded.filter((m) => m.lilToonTextures?._ReflectionCubeTex);
	const cube = materials[0].lilToonTextures._ReflectionCubeTex as CubeTexture;
	checks.loadedCube = cube?.isCubeTexture && cube.type === HalfFloatType;
	checks.sharedSource =
		materials.length === 2 &&
		materials[1].lilToonTextures._ReflectionCubeTex === cube;
	checks.preservedLevels = cube.mipmaps.length === 2 && !cube.generateMipmaps;
	checks.ownedInventory = gltf.parser.associations.has(cube);
	const renderer = new WebGLRenderer({ antialias: false });
	renderer.setSize(32, 32);
	const release = enableLilToon(renderer);
	const target = new WebGLRenderTarget(32, 32);
	renderer.setRenderTarget(target);
	const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
	camera.position.z = 2;
	const scene = new Scene();
	scene.add(new AmbientLight(0xffffff, 1));
	const geometry = new PlaneGeometry(2, 2);
	const mesh = new Mesh(geometry);
	scene.add(mesh);
	const probe = new RawShaderMaterial({
		glslVersion: GLSL3,
		uniforms: {
			cube: { value: cube },
			direction: { value: new Vector3() },
			level: { value: 0 },
		},
		vertexShader: `in vec3 position; void main(){gl_Position=vec4(position,1.0);}`,
		fragmentShader: `precision highp float; uniform samplerCube cube; uniform vec3 direction; uniform float level; out vec4 color; void main(){color=vec4(textureLod(cube,direction,level).rgb/64.0,1.0);}`,
	});
	const pixel = () => {
		renderer.render(scene, camera);
		const p = new Uint8Array(4);
		renderer.readRenderTargetPixels(target, 16, 16, 1, 1, p);
		return [...p];
	};
	const faces = [
		new Vector3(1, 0, 0),
		new Vector3(-1, 0, 0),
		new Vector3(0, 1, 0),
		new Vector3(0, -1, 0),
		new Vector3(0, 0, 1),
		new Vector3(0, 0, -1),
	];
	mesh.material = probe;
	for (let mip = 0; mip < 3; mip++)
		for (let face = 0; face < 6; face++) {
			probe.uniforms.direction.value.copy(faces[face]);
			probe.uniforms.level.value = mip;
			const p = pixel();
			const source = (
				mip === 0
					? cube.images
					: (cube.mipmaps[mip - 1] as unknown as { image: DataTexture[] }).image
			)[face] as DataTexture;
			const expected =
				(DataUtils.fromHalfFloat(source.image.data![0]) * 255) / 64;
			checks[`face${face}/mip${mip}`] = Math.abs(p[0] - expected) < 2;
			details.push({ face, mip, p, expected });
		}
	mesh.material = materials[0];
	// Hold lighting and base color constant so bright Unity defaults cannot clip
	// the reflection comparison in the 8-bit readback target.
	for (const [name, value] of Object.entries({
		_UseReflection: 1,
		_ApplyReflection: 1,
		_ReflectionCubeOverride: 1,
		_ReflectionCubeEnableLighting: 0,
		_Metallic: 1,
		_Smoothness: 1,
		_ApplySpecular: 0,
		_Color: [0.1, 0.1, 0.1, 1],
		_ReflectionCubeColor: [0.1, 0.1, 0.1, 1],
	}))
		materials[0].setProperty(name, value);

	// Ensure the authored HDR interpretation survives material-owned texture views.
	const sharp = pixel();
	materials[0].setProperty("_Smoothness", 0);
	const rough = pixel();
	checks.roughnessChangesPixels = sharp.some(
		(value, i) => Math.abs(value - rough[i]) > 1,
	);
	materials[0].setProperty("_Smoothness", 1);
	materials[0].setProperty("_ReflectionCubeColor", [0, 0, 0, 1]);
	const off = pixel();
	materials[0].setProperty("_ReflectionCubeColor", [0.1, 0.1, 0.1, 1]);
	const on = pixel();
	checks.reflectionVisible = on.some(
		(value, i) => Math.abs(value - off[i]) > 1,
	);
	checks.linearCubeViews = Object.values(materials[0].uniforms)
		.filter((u) => (u.value as CubeTexture)?.isCubeTexture)
		.every((u) => (u.value as CubeTexture).colorSpace === LinearSRGBColorSpace);
	const clone = materials[0].clone();
	mesh.material = clone;
	const cloned = pixel();
	checks.clonePreservesReflection = cloned.every((value, i) => value === on[i]);
	const lost = new Promise<void>((resolve) =>
		renderer.domElement.addEventListener("webglcontextlost", () => resolve(), {
			once: true,
		}),
	);
	renderer.forceContextLoss();
	await lost;
	// Restoration must be requested after the loss event finishes dispatching.
	await new Promise((resolve) => setTimeout(resolve, 100));
	const restored = new Promise<void>((resolve) =>
		renderer.domElement.addEventListener(
			"webglcontextrestored",
			() => resolve(),
			{ once: true },
		),
	);
	renderer.forceContextRestore();
	await restored;
	renderer.setRenderTarget(target);
	checks.contextRestoresPixels = pixel().every((value, i) => value === on[i]);
	const glError = renderer.getContext().getError();
	const ownedCubes = [
		cube,
		...[materials[0], clone].flatMap((m) =>
			Object.values(m.uniforms)
				.map((u) => u.value)
				.filter((v) => v?.isCubeTexture && v.image === cube.image),
		),
	];
	clone.dispose();
	for (const m of loaded) m.dispose();
	cube.dispose();
	probe.dispose();
	geometry.dispose();
	target.dispose();
	release();
	// Shared neutral textures belong to the renderer, not this model.
	checks.textureCleanup = ownedCubes.every(
		(t) =>
			!(renderer.properties.get(t) as { __webglTexture?: unknown })
				.__webglTexture,
	);
	renderer.dispose();
	return { checks, details, sharp, rough, off, on, glError };
}
