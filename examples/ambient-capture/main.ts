import {
	Color,
	DirectionalLight,
	NoToneMapping,
	PerspectiveCamera,
	Scene,
	SRGBColorSpace,
	Vector3,
	Vector4,
	WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFLilToonExtension } from "../../src/loaders/GLTFLilToonExtension.js";
import { LilToonMaterial } from "../../src/material/LilToonMaterial.js";
import { enableLilToon } from "../../src/renderer/enableLilToon.js";
import { packUnitySH9 } from "./unity-sh9.js";

type Vec3 = [number, number, number];

type AmbientCaptureProfile = {
	name: string;
	modelUrl: string;
	width: number;
	height: number;
	background: string;
	camera: {
		position: Vec3;
		target: Vec3;
		fov: number;
		near: number;
		far: number;
	};
	directional?: {
		color: string;
		intensity: number;
		position: Vec3;
		target: Vec3;
	};
	sh9: { r: number[]; g: number[]; b: number[] };
	unity: Record<string, unknown>;
};

function applyUnitySH9(
	material: LilToonMaterial,
	packed: ReturnType<typeof packUnitySH9>,
) {
	for (const [name, values] of Object.entries(packed)) {
		const uniform = material.globalUniforms[name];
		if (!(uniform instanceof Vector4))
			throw new Error(`Expected vector uniform ${name} on ${material.name}`);
		uniform.set(values[0], values[1], values[2], values[3]);
	}
}

declare global {
	interface Window {
		__CAPTURE_READY__?: boolean;
		__CAPTURE_METADATA__?: Record<string, unknown>;
	}
}

const status = document.querySelector<HTMLDivElement>("#status");
const canvas = document.querySelector<HTMLCanvasElement>("#scene");
if (!status || !canvas) throw new Error("Ambient capture elements are missing");

const profileUrl = new URLSearchParams(location.search).get("profile");
if (!profileUrl) throw new Error("Pass ?profile=<profile.json URL>");

const profileResponse = await fetch(profileUrl);
if (!profileResponse.ok)
	throw new Error(`Cannot load capture profile: ${profileResponse.status}`);
const profile = (await profileResponse.json()) as AmbientCaptureProfile;
if (
	!profile.name ||
	!profile.modelUrl ||
	!profile.width ||
	!profile.height ||
	!profile.sh9
)
	throw new Error(
		"Capture profile requires name, modelUrl, dimensions, and the Unity sh9 coefficients",
	);
const packedSH9 = packUnitySH9(profile.sh9);

const scene = new Scene();
scene.background = new Color(profile.background);
const camera = new PerspectiveCamera(
	profile.camera.fov,
	profile.width / profile.height,
	profile.camera.near,
	profile.camera.far,
);
camera.position.fromArray(profile.camera.position);
camera.lookAt(new Vector3(...profile.camera.target));

if (profile.directional) {
	const light = new DirectionalLight(
		new Color(profile.directional.color),
		profile.directional.intensity,
	);
	light.position.fromArray(profile.directional.position);
	light.target.position.fromArray(profile.directional.target);
	scene.add(light, light.target);
}

const renderer = new WebGLRenderer({
	canvas,
	antialias: true,
	alpha: false,
	preserveDrawingBuffer: true,
});
renderer.setSize(profile.width, profile.height, false);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NoToneMapping;
enableLilToon(renderer);

const loader = new GLTFLoader();
loader.register((parser) => new GLTFLilToonExtension(parser));
status.textContent = `Loading ${profile.name}`;
const gltf = await loader.loadAsync(profile.modelUrl);
const patchedMaterials = new Set<LilToonMaterial>();
gltf.scene.traverse((object) => {
	if (!("material" in object) || !object.material) return;
	const materials = Array.isArray(object.material)
		? object.material
		: [object.material];
	for (const material of materials) {
		if (!(material instanceof LilToonMaterial)) continue;
		if (patchedMaterials.has(material)) continue;
		patchedMaterials.add(material);
		const previous = material.onBeforeRender;
		material.onBeforeRender = (...draw) => {
			previous.apply(material, draw);
			applyUnitySH9(material, packedSH9);
		};
	}
});
if (patchedMaterials.size === 0)
	throw new Error(`No lilToon materials were loaded from ${profile.modelUrl}`);
scene.add(gltf.scene);
renderer.render(scene, camera);

window.__CAPTURE_METADATA__ = {
	profile,
	modelUrl: profile.modelUrl,
	sh9: profile.sh9,
	sh9Uniforms: packedSH9,
	sh9Source:
		"Unity RenderSettings.ambientProbe SphericalHarmonicsL2, packed into lilToon unity_SH* uniforms",
	renderer: {
		width: profile.width,
		height: profile.height,
		outputColorSpace: "SRGBColorSpace",
		toneMapping: "NoToneMapping",
	},
};
window.__CAPTURE_READY__ = true;
status.textContent = `Ready: ${profile.name}`;
