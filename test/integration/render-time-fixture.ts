import {
	AmbientLight,
	BoxGeometry,
	DirectionalLight,
	Mesh,
	PerspectiveCamera,
	Scene,
	WebGLRenderer,
	WebGLRenderTarget,
	type Material,
} from "three";
import { LilToonMaterial, enableLilToon } from "../../src/index.js";
import { uniformSnapshot } from "../helpers/uniform-snapshot.js";

/** Real WebGL draws of an explicit synthetic box, including its automatic outline. */
export async function verifyRenderTime() {
	const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
	renderer.setSize(256, 256);
	document.body.append(renderer.domElement);
	const release = enableLilToon(renderer);
	const scene = new Scene(),
		camera = new PerspectiveCamera(35, 1, 0.1, 20);
	camera.position.z = 4;
	const light = new DirectionalLight(0xffffff, 1);
	light.position.set(2, 3, 4);
	scene.add(light, new AmbientLight(0xffffff, 0.3));
	const material = new LilToonMaterial({
		renderTimeSeconds: 0.65,
		properties: {
			_UseOutline: 1,
			_OutlineWidth: 0.03,
			_UseEmission: 1,
			_EmissionBlink: [0.2, 1, 0.3, 0],
		},
	});
	const mesh = new Mesh(new BoxGeometry(), material);
	scene.add(mesh);
	const target = new WebGLRenderTarget(256, 256, { samples: 4 });
	renderer.setRenderTarget(target);
	let draws: unknown[] = [];
	mesh.onBeforeRender = () => {
		scene.traverse((object) => {
			if (!(object instanceof Mesh)) return;
			object.onAfterRender = (
				_renderer,
				_scene,
				_camera,
				_geometry,
				drawn: Material,
			) => {
				if (drawn instanceof LilToonMaterial)
					draws.push({
						material: drawn.uuid,
						pass: drawn.pass,
						uniforms: uniformSnapshot(drawn.uniforms),
					});
			};
		});
	};
	const render = () => {
		draws = [];
		renderer.render(scene, camera);
		return structuredClone(draws);
	};
	render(); // Finish initial shader/texture setup before comparing two actual draws.
	const first = render();
	await new Promise((resolve) => setTimeout(resolve, 30));
	const second = render();
	const uniformEqual = JSON.stringify(first) === JSON.stringify(second);
	const gl = renderer.getContext();
	const glError = gl.getError();
	const globals = material.uniforms._Globals.value as Record<string, unknown>;
	const result = {
		uniformEqual,
		comparedDraws: first.length,
		globalsKeys: Object.keys(globals).length,
		nestedGlobalsIncluded: JSON.stringify(first).includes("_Globals"),
		captureTime: material.renderTimeSeconds,
		uTime: (globals.uTime as { toArray(): number[] }).toArray(),
		glError,
		glNoError: gl.NO_ERROR,
		first,
		second,
	};
	if (
		!uniformEqual ||
		first.length < 2 ||
		!result.nestedGlobalsIncluded ||
		glError !== gl.NO_ERROR
	)
		throw new Error(
			`capture uniform equality failed: ${JSON.stringify(result)}`,
		);
	// Display the same synthetic scene for visual inspection of the GPU probe.
	renderer.setRenderTarget(null);
	renderer.render(scene, camera);
	const status = document.createElement("p");
	status.textContent = `Uniform equality: ${uniformEqual}; draws: ${first.length}; nested _Globals fields: ${result.globalsKeys}; capture: ${result.captureTime}s`;
	document.body.append(status);
	release();
	target.dispose();
	mesh.geometry.dispose();
	material.dispose();
	renderer.dispose();
	return result;
}
