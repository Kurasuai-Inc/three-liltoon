import {
	Mesh,
	LinearSRGBColorSpace,
	NoToneMapping,
	OrthographicCamera,
	Scene,
	SRGBColorSpace,
	SphereGeometry,
	Vector4,
	WebGLRenderTarget,
	WebGLRenderer,
} from "three";
import { LilToonMaterial } from "../../dist/index.js";

export function compareCanvasAndSrgbRenderTarget() {
	// These are measured linear center values from the four Unity gray-probe cases.
	const unitySamples = [
		{
			id: "ambient",
			linear: [0.078187, 0.072272, 0.068478],
			srgb8: [79, 76, 74],
		},
		{
			id: "key",
			linear: [0.212231, 0.205079, 0.201556],
			srgb8: [127, 125, 124],
		},
		{
			id: "key-plus-ambient",
			linear: [0.234551, 0.226966, 0.223228],
			srgb8: [133, 131, 130],
		},
		{
			id: "no-light",
			linear: [0.021219, 0.020289, 0.019382],
			srgb8: [40, 39, 38],
		},
	] as const;
	const canvas = document.createElement("canvas");
	const renderer = new WebGLRenderer({
		canvas,
		antialias: false,
		alpha: false,
		preserveDrawingBuffer: true,
	});
	renderer.setSize(32, 32, false);
	renderer.outputColorSpace = SRGBColorSpace;
	renderer.toneMapping = NoToneMapping;
	renderer.setClearColor(0x000000, 1);
	document.body.appendChild(canvas);

	const target = new WebGLRenderTarget(32, 32, {
		depthBuffer: false,
		stencilBuffer: false,
		samples: 0,
	});
	target.texture.colorSpace = SRGBColorSpace;

	const scene = new Scene();
	const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
	camera.position.z = 2;
	const geometry = new SphereGeometry(1, 32, 24);
	const material = new LilToonMaterial({
		properties: { _AsUnlit: 1, _UseShadow: 0, _UseOutline: 0 },
	});
	const mesh = new Mesh(geometry, material);
	scene.add(mesh);
	const shaderOutputSrgb: number[] = [];
	const onBeforeRender = material.onBeforeRender;
	material.onBeforeRender = (...args) => {
		onBeforeRender(...args);
		shaderOutputSrgb.push(Number(material.uniforms.uLilToonOutputSrgb?.value));
	};

	const cases = unitySamples.map((sample) => {
		material.color.setRGB(
			sample.linear[0],
			sample.linear[1],
			sample.linear[2],
			LinearSRGBColorSpace,
		);
		renderer.setRenderTarget(null);
		renderer.render(scene, camera);
		const canvasPixel = new Uint8Array(4);
		renderer
			.getContext()
			.readPixels(
				16,
				16,
				1,
				1,
				renderer.getContext().RGBA,
				renderer.getContext().UNSIGNED_BYTE,
				canvasPixel,
			);

		renderer.setRenderTarget(target);
		renderer.render(scene, camera);
		const renderTargetPixel = new Uint8Array(4);
		renderer.readRenderTargetPixels(target, 16, 16, 1, 1, renderTargetPixel);
		return {
			id: sample.id,
			inputLinear: [...sample.linear],
			unitySrgb8: [...sample.srgb8, 255],
			canvasPixel: [...canvasPixel],
			renderTargetPixel: [...renderTargetPixel],
			colorUniform: (material.globalUniforms._Color as Vector4).toArray(),
		};
	});
	const glError = renderer.getContext().getError();
	const result = {
		cases,
		shaderOutputSrgb,
		materialColorLinear: material.color.toArray(),
		glError,
	};

	material.dispose();
	geometry.dispose();
	target.dispose();
	renderer.dispose();
	return result;
}
