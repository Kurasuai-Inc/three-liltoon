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

function packUnitySH9(sh9: AmbientCaptureProfile["sh9"]) {
	for (const channel of [sh9.r, sh9.g, sh9.b]) {
		if (
			channel.length !== 9 ||
			channel.some((coefficient) => !Number.isFinite(coefficient))
		)
			throw new Error("Each sh9 channel must contain nine finite coefficients");
	}
	const [r, g, b] = [sh9.r, sh9.g, sh9.b];
	// Unity's SH coefficient order is packed as the six unity_SH* shader
	// vectors; this is the same polynomial basis used by lil_common_functions.hlsl.
	return {
		unity_SHAr: [r[3], r[1], r[2], r[0] - r[6]],
		unity_SHAg: [g[3], g[1], g[2], g[0] - g[6]],
		unity_SHAb: [b[3], b[1], b[2], b[0] - b[6]],
		unity_SHBr: [r[4], r[5], 3 * r[6], r[7]],
		unity_SHBg: [g[4], g[5], 3 * g[6], g[7]],
		unity_SHBb: [b[4], b[5], 3 * b[6], b[7]],
		unity_SHC: [r[8], g[8], b[8], 1],
	};
}

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
