import { readFileSync } from "node:fs";
import {
	AmbientLight,
	Color,
	DirectionalLight,
	HemisphereLight,
	PerspectiveCamera,
	Scene,
	Vector3,
} from "three";
import { describe, expect, it } from "vitest";
import { LilToonLightAdapter } from "../../src/renderer/LilToonLightAdapter.js";

const source = readFileSync(
	new URL(
		"../../examples/mochiya-liltoon-viewer/src/components/viewer/viewer-lighting.tsx",
		import.meta.url,
	),
	"utf8",
);
const canvasSource = readFileSync(
	new URL(
		"../../examples/mochiya-liltoon-viewer/src/components/viewer/model-canvas.tsx",
		import.meta.url,
	),
	"utf8",
);
const lightElement = source.match(/<directionalLight\b[\s\S]*?\/>/)?.[0] ?? "";

describe("viewer fixed lighting", () => {
	it("matches the Avatar Composition viewer scene baseline", () => {
		expect(source).toContain(
			'<hemisphereLight args={["#e0faff", "#fff0db", 0.5]} />',
		);
		expect(lightElement).toContain("position={[-0.5, 3, 2]}");
		expect(lightElement).toContain("intensity={1.75}");
		expect(lightElement).toContain("castShadow");
		expect(lightElement).toContain("shadow-mapSize={[2048, 2048]}");
		expect(lightElement).toContain("shadow-bias={-0.0001}");
		expect(canvasSource).toContain('props.dark ? "#23251f" : "#f3f4ed"');
		expect(canvasSource).toContain('props.dark ? "#42463a" : "#d6dbcd"');
		expect(canvasSource).toContain('props.dark ? "#5b604f" : "#b8c1aa"');
		expect(canvasSource).toContain(
			"camera={{ position: [0, 1.4, 5.5], fov: 26",
		);
		expect(canvasSource).toContain("<OrbitControls");
		expect(canvasSource).not.toContain("CameraControls");
	});

	it("uses Unity SH projection without adding an ambient floor", () => {
		const scene = new Scene();
		const hemisphere = new HemisphereLight(0xffffff, 0x000000, 0.5);
		scene.add(hemisphere);
		scene.updateMatrixWorld(true);

		const lighting = new LilToonLightAdapter().read(scene);
		expect(lighting.unitySHAr.x).toBeCloseTo(0);
		expect(lighting.unitySHAr.y).toBeCloseTo((Math.sqrt(6) / 9) * 0.5);
		expect(lighting.unitySHAr.z).toBeCloseTo(0);
		expect(lighting.unitySHAr.w).toBeCloseTo(0.25);
		expect(lighting.ambient.r).toBeCloseTo(0.25);
		expect(lighting.unitySHAg.w).toBeCloseTo(lighting.ambient.g);
		expect(lighting.unitySHAb.w).toBeCloseTo(lighting.ambient.b);
	});

	it("maps Flat AmbientLight to its color with no synthetic baseline", () => {
		const scene = new Scene();
		scene.add(new AmbientLight(new Color(0.21404114, 0.21404114, 0.21404114)));
		scene.updateMatrixWorld(true);

		const lighting = new LilToonLightAdapter().read(scene);
		expect(lighting.ambient.r).toBeCloseTo(0.21404114);
		expect(lighting.unitySHAr.w).toBeCloseTo(0.21404114);
		expect(lighting.unitySHAr.y).toBe(0);
	});

	it("packs two adjacent HemisphereLights as one Unity Trilight profile", () => {
		const scene = new Scene();
		const first = new HemisphereLight(
			new Color(0.75, 0.75, 0.75),
			new Color(0.5, 0.5, 0.5),
			0.5,
		);
		const second = new HemisphereLight(
			new Color(0.5, 0.5, 0.5),
			new Color(0.25, 0.25, 0.25),
			0.5,
		);
		scene.add(first, second);
		scene.updateMatrixWorld(true);

		const lighting = new LilToonLightAdapter().read(scene);
		expect(lighting.unitySHAr.x).toBeCloseTo(0);
		expect(lighting.unitySHAr.y).toBeCloseTo(
			(Math.sqrt(6) / 9) * (0.75 - 0.25),
		);
		expect(lighting.unitySHAr.z).toBeCloseTo(0);
		// The pair defines sky=.75, equator=(.5+.5)/2, ground=.25;
		// c0=(S+4E+G)/6 and c1=sqrt(6)/9*(S-G), with c6=c8=0.
		expect(lighting.unitySHAr.w).toBeCloseTo(0.5);
		expect(lighting.unitySHBr.x).toBeCloseTo(0);
		expect(lighting.unitySHBr.z).toBeCloseTo(0);
		expect(lighting.unitySHC.x).toBeCloseTo(0);
		expect(lighting.unitySHC.w).toBe(1);
		expect(lighting.ambient.r).toBeCloseTo(0.5);
		expect(lighting.unitySHAg.w).toBeCloseTo(lighting.ambient.g);
		expect(lighting.unitySHAb.w).toBeCloseTo(lighting.ambient.b);
	});

	it("includes the Unity Trilight quadratic band when the equator is uneven", () => {
		const scene = new Scene();
		scene.add(
			new HemisphereLight(new Color(1, 1, 1), new Color(0.5, 0.5, 0.5), 0.5),
			new HemisphereLight(new Color(0.75, 0.75, 0.75), new Color(0, 0, 0), 0.5),
		);
		scene.updateMatrixWorld(true);

		const lighting = new LilToonLightAdapter().read(scene);
		const l2 = (5 / 192) * (2 * 0.625 - 1 - 0) * 1;
		expect(lighting.unitySHBr.z).toBeCloseTo(3 * l2);
		expect(lighting.unitySHC.x).toBeCloseTo(3 * l2);
	});

	it("rotates the HemisphereLight gradient with its world-space direction", () => {
		const scene = new Scene();
		const hemisphere = new HemisphereLight(0xffffff, 0x000000, 0.5);
		hemisphere.position.set(1, 0, 0);
		scene.add(hemisphere);
		scene.updateMatrixWorld(true);

		const { unitySHAr } = new LilToonLightAdapter().read(scene);
		expect(unitySHAr.x).toBeGreaterThan(0);
		expect(unitySHAr.y).toBeCloseTo(0);
		expect(unitySHAr.z).toBeCloseTo(0);
	});

	it("uses controls with the target vector required by automatic bounds", () => {
		expect(canvasSource).toContain("<Bounds fit clip observe");
		expect(canvasSource).toContain("<OrbitControls makeDefault");
	});

	it("declares a fixed position without camera hooks or a moving target", () => {
		const position = lightElement
			.match(/position=\{\[([^\]]+)\]\}/)?.[1]
			.split(",")
			.map(Number);
		expect(position).toHaveLength(3);
		expect(position?.every(Number.isFinite)).toBe(true);
		expect(lightElement).not.toMatch(/\b(?:ref|target)=/);
		expect(source).not.toMatch(/\b(?:useFrame|useThree|updateCameraLight)\b/);
	});

	it("keeps the lilToon light direction and shadow view fixed during camera movement", () => {
		const scene = new Scene();
		const light = new DirectionalLight();
		// Read the declared viewer position so this check exercises its actual setup.
		const position = lightElement
			.match(/position=\{\[([^\]]+)\]\}/)![1]
			.split(",")
			.map(Number);
		light.position.fromArray(position);
		const camera = new PerspectiveCamera();
		scene.add(light, camera);
		scene.updateMatrixWorld(true);
		light.shadow.updateMatrices(light);
		const shadowMatrix = light.shadow.matrix.clone();
		const adapter = new LilToonLightAdapter();
		const direction = adapter.read(scene).direction.clone();

		for (const cameraPosition of [
			[0, 2, 3],
			[3, 2, 0],
			[0, 2, -3],
			[-3, 2, 0],
			[12, 7, 25],
		]) {
			camera.position.fromArray(cameraPosition);
			camera.lookAt(2, 1, 0);
			camera.rotateZ(0.3);
			scene.updateMatrixWorld(true);
			light.shadow.updateMatrices(light);
			expect(light.getWorldPosition(new Vector3()).toArray()).toEqual(position);
			expect(light.target.getWorldPosition(new Vector3()).toArray()).toEqual([
				0, 0, 0,
			]);
			expect(adapter.read(scene).direction.distanceTo(direction)).toBeLessThan(
				1e-8,
			);
			expect(light.shadow.matrix.equals(shadowMatrix)).toBe(true);
		}
	});
});
