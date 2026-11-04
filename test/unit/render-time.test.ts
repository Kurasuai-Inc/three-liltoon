import { afterEach, expect, it, vi } from "vitest";
import {
	BufferGeometry,
	Group,
	Mesh,
	PerspectiveCamera,
	Scene,
	SRGBColorSpace,
	Vector2,
	Vector4,
	type WebGLRenderer,
} from "three";
import { LilToonMaterial } from "../../src/material/LilToonMaterial.js";
import { syncPassMaterial } from "../../src/renderer/AuxiliaryPassDraw.js";
import { uniformSnapshot } from "../helpers/uniform-snapshot.js";

afterEach(() => vi.restoreAllMocks());
function draw(material: LilToonMaterial) {
	// Explicit synthetic renderer inputs; actual uniform binding uses the normal material callback.
	const renderer = {
		info: { render: { frame: 0 } },
		shadowMap: { enabled: false },
		outputColorSpace: SRGBColorSpace,
		getContext: () => ({ getParameter: () => 32 }),
		getRenderTarget: () => null,
		getDrawingBufferSize: (size: Vector2) => size.set(1800, 2400),
	} as unknown as WebGLRenderer;
	const scene = new Scene(),
		camera = new PerspectiveCamera(18, 0.75, 0.01, 100);
	camera.position.z = 4;
	const mesh = new Mesh(new BufferGeometry(), material);
	return () => {
		material.onBeforeRender(
			renderer,
			scene,
			camera,
			mesh.geometry,
			mesh,
			new Group(),
		);
		renderer.info.render.frame++;
	};
}

it("holds every uniform including nested _Globals across draws at the explicit capture time", () => {
	const now = vi.spyOn(performance, "now").mockReturnValue(1000);
	const material = new LilToonMaterial({ renderTimeSeconds: 0.65 });
	const render = draw(material);
	now.mockReturnValue(5000);
	render();
	const first = uniformSnapshot(material.uniforms);
	now.mockReturnValue(15000);
	render();
	const second = uniformSnapshot(material.uniforms);
	expect(second).toEqual(first);
	expect((material.globalUniforms.uTime as Vector4).toArray()).toEqual([
		0.65 / 20,
		0.65,
		1.3,
		0.65 * 3,
	]);
});

it("keeps the original elapsed clock when no override is set or it is cleared", () => {
	const now = vi.spyOn(performance, "now").mockReturnValue(1000);
	const material = new LilToonMaterial();
	const render = draw(material);
	now.mockReturnValue(5000);
	render();
	expect((material.globalUniforms.uTime as Vector4).y).toBe(4);
	material.renderTimeSeconds = 0;
	now.mockReturnValue(9000);
	render();
	expect((material.globalUniforms.uTime as Vector4).y).toBe(0);
	material.renderTimeSeconds = null;
	render();
	expect((material.globalUniforms.uTime as Vector4).y).toBe(8);
});

it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.001])(
	"rejects invalid override %s",
	(value) => {
		const material = new LilToonMaterial();
		expect(() => {
			material.renderTimeSeconds = value;
		}).toThrow(RangeError);
		expect(material.renderTimeSeconds).toBeNull();
	},
);

it("copies capture time and synchronizes every auxiliary pass independently of property revisions", () => {
	const source = new LilToonMaterial({ renderTimeSeconds: 0.65 });
	const target = source.clone();
	expect(target.renderTimeSeconds).toBe(0.65);
	source.renderTimeSeconds = 2;
	syncPassMaterial(source, target);
	expect(target.renderTimeSeconds).toBe(2);
	source.renderTimeSeconds = null;
	syncPassMaterial(source, target);
	expect(target.renderTimeSeconds).toBeNull();
	expect(source.toLilToonJSON(() => "texture")).not.toHaveProperty(
		"renderTimeSeconds",
	);
});
