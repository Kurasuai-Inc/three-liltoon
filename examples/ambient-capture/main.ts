import {
	AmbientLight,
	Color,
	DirectionalLight,
	HemisphereLight,
	Mesh,
	NoToneMapping,
	OrthographicCamera,
	Scene,
	SRGBColorSpace,
	SphereGeometry,
	Vector3,
	Vector4,
	WebGLRenderer,
} from "three";
import { LilToonMaterial } from "../../src/material/LilToonMaterial.js";
import { enableLilToon } from "../../src/renderer/enableLilToon.js";
import { packUnitySH9 } from "./unity-sh9.js";

type Vec3 = [number, number, number];
type LinearRgb = [number, number, number];

type AmbientCaptureProfile = {
	name: string;
	subject: {
		kind: "sphere";
		radius: number;
		widthSegments: number;
		heightSegments: number;
		color: LinearRgb;
	};
	width: number;
	height: number;
	background: string;
	camera: {
		projection: "orthographic";
		position: Vec3;
		target: Vec3;
		orthographicSize: number;
		near: number;
		far: number;
	};
	lighting:
		| {
				kind: "unity-probe";
				sh9: { r: number[]; g: number[]; b: number[] };
		  }
		| {
				kind: "three-adapter";
				ambient: { color: LinearRgb; intensity: number };
				hemisphere: {
					skyColor: LinearRgb;
					groundColor: LinearRgb;
					intensity: number;
					direction: Vec3;
				};
		  };
	directional?: {
		color: string;
		intensity: number;
		position: Vec3;
		target: Vec3;
	};
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
	!profile.subject ||
	!profile.width ||
	!profile.height ||
	!profile.camera ||
	!profile.unity ||
	!profile.lighting
)
	throw new Error(
		"Capture profile requires name, subject, dimensions, and a lighting source",
	);
const subjectKind = (profile.subject as { kind: string }).kind;
if (subjectKind !== "sphere")
	throw new Error(`Unsupported capture subject kind: ${subjectKind}`);
if (
	!Number.isFinite(profile.subject.radius) ||
	profile.subject.radius <= 0 ||
	!Number.isInteger(profile.subject.widthSegments) ||
	profile.subject.widthSegments < 3 ||
	!Number.isInteger(profile.subject.heightSegments) ||
	profile.subject.heightSegments < 2 ||
	profile.subject.color.length !== 3 ||
	profile.subject.color.some((channel) => !Number.isFinite(channel))
)
	throw new Error("Sphere subject has invalid dimensions or linear RGB color");
const cameraProjection = (profile.camera as { projection: string }).projection;
if (cameraProjection !== "orthographic")
	throw new Error(`Unsupported capture camera projection: ${cameraProjection}`);
const lightingKind = (profile.lighting as { kind: string }).kind;
if (lightingKind !== "unity-probe" && lightingKind !== "three-adapter")
	throw new Error(`Unsupported capture lighting kind: ${lightingKind}`);
const packedSH9 =
	profile.lighting.kind === "unity-probe"
		? packUnitySH9(profile.lighting.sh9)
		: undefined;

const scene = new Scene();
scene.background = new Color(profile.background);
const camera = new OrthographicCamera(
	(-profile.camera.orthographicSize * profile.width) / profile.height,
	(profile.camera.orthographicSize * profile.width) / profile.height,
	profile.camera.orthographicSize,
	-profile.camera.orthographicSize,
	profile.camera.near,
	profile.camera.far,
);
camera.position.fromArray(profile.camera.position);
camera.lookAt(new Vector3(...profile.camera.target));

if (profile.lighting.kind === "three-adapter") {
	const ambient = new AmbientLight(
		new Color(...profile.lighting.ambient.color),
		profile.lighting.ambient.intensity,
	);
	const hemisphere = new HemisphereLight(
		new Color(...profile.lighting.hemisphere.skyColor),
		new Color(...profile.lighting.hemisphere.groundColor),
		profile.lighting.hemisphere.intensity,
	);
	hemisphere.position.fromArray(profile.lighting.hemisphere.direction);
	scene.add(ambient, hemisphere);
}

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

status.textContent = `Loading ${profile.name}`;
const patchedMaterials = new Set<LilToonMaterial>();
const material = new LilToonMaterial({
	color: new Color(...profile.subject.color),
	properties: {
		_UseShadow: 0,
		_UseShadow2nd: 0,
		_UseShadow3rd: 0,
		_UseMatCap: 0,
		_UseRim: 0,
		_UseEmission: 0,
		_UseBumpMap: 0,
		_UseOutline: 0,
		_UseMain2ndTex: 0,
		_LightMinLimit: 0,
		_LightMaxLimit: 1,
	},
});
const geometry = new SphereGeometry(
	profile.subject.radius,
	profile.subject.widthSegments,
	profile.subject.heightSegments,
);
scene.add(new Mesh(geometry, material));
patchedMaterials.add(material);
for (const material of patchedMaterials) {
	if (!packedSH9) continue;
	const previous = material.onBeforeRender;
	material.onBeforeRender = (...draw) => {
		previous.apply(material, draw);
		applyUnitySH9(material, packedSH9);
	};
}
renderer.render(scene, camera);

window.__CAPTURE_METADATA__ = {
	profile,
	subject: profile.subject,
	lighting: profile.lighting,
	sh9Uniforms: packedSH9,
	sh9Source:
		profile.lighting.kind === "unity-probe"
			? "Unity RenderSettings.ambientProbe SphericalHarmonicsL2, packed into lilToon unity_SH* uniforms"
			: "Three scene lights adapted to lilToon unity_SH* uniforms",
	renderer: {
		width: profile.width,
		height: profile.height,
		outputColorSpace: "SRGBColorSpace",
		toneMapping: "NoToneMapping",
	},
};
window.__CAPTURE_READY__ = true;
status.textContent = `Ready: ${profile.name}`;
