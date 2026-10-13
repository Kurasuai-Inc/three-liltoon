import {
	AmbientLight,
	Color,
	DirectionalLight,
	HemisphereLight,
	NoToneMapping,
	PerspectiveCamera,
	Scene,
	SRGBColorSpace,
	WebGLRenderer,
	Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFLilToonExtension } from "../../src/loaders/GLTFLilToonExtension.js";
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
	ambient:
		| { kind: "flat"; color: string; intensity: number }
		| {
				kind: "trilight";
				skyColor: string;
				equatorColor: string;
				groundColor: string;
				intensity: number;
				position: Vec3;
		  };
	unity: Record<string, unknown>;
};

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
if (!profile.name || !profile.modelUrl || !profile.width || !profile.height)
	throw new Error("Capture profile requires name, modelUrl, width, and height");

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

if (profile.ambient.kind === "flat") {
	scene.add(
		new AmbientLight(
			new Color(profile.ambient.color),
			profile.ambient.intensity,
		),
	);
} else {
	const light = new HemisphereLight(
		new Color(profile.ambient.skyColor),
		new Color(profile.ambient.groundColor),
		profile.ambient.intensity,
	);
	light.position.fromArray(profile.ambient.position);
	scene.add(light);
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
scene.add(gltf.scene);
renderer.render(scene, camera);

window.__CAPTURE_METADATA__ = {
	profile,
	modelUrl: profile.modelUrl,
	threeLilToonAmbientMapping:
		profile.ambient.kind === "trilight"
			? "HemisphereLight sky/ground first-order approximation; equatorColor is retained in metadata but not represented by Three HemisphereLight"
			: "AmbientLight constant",
	renderer: {
		width: profile.width,
		height: profile.height,
		outputColorSpace: "SRGBColorSpace",
		toneMapping: "NoToneMapping",
	},
};
window.__CAPTURE_READY__ = true;
status.textContent = `Ready: ${profile.name}`;
