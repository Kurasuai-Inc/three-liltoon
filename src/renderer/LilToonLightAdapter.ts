import {
	AmbientLight,
	Color,
	DirectionalLight,
	HemisphereLight,
	Vector3,
	Vector4,
	type Scene,
} from "three";

export interface LilToonSceneLighting {
	main?: DirectionalLight;
	direction: Vector3;
	color: Color;
	ambient: Color;
	unitySHAr: Vector4;
	unitySHAg: Vector4;
	unitySHAb: Vector4;
	unitySHBr: Vector4;
	unitySHBg: Vector4;
	unitySHBb: Vector4;
	unitySHC: Vector4;
}

const lightPosition = new Vector3();
const targetPosition = new Vector3();
const hemisphereDirection = new Vector3();
const secondHemisphereDirection = new Vector3();
const TRILIGHT_L1_SCALE = Math.sqrt(6) / 9;

function addTrilightProbe(
	coefficients: [number[], number[], number[]],
	sky: Color,
	equator: Color,
	ground: Color,
	intensity: number,
	direction: Vector3,
): void {
	// Unity 2022.3.22f1 RenderSettings.ambientProbe captures match these
	// Trilight equations. Unity's native projection is not in public
	// UnityCsReference; see docs/PORTING_EXCEPTIONS.md for measured cases.
	for (const [channel, s, e, g] of [
		[0, sky.r, equator.r, ground.r],
		[1, sky.g, equator.g, ground.g],
		[2, sky.b, equator.b, ground.b],
	] as const) {
		coefficients[channel][0] += ((s + 4 * e + g) / 6) * intensity;
		const l1 = TRILIGHT_L1_SCALE * (s - g) * intensity;
		coefficients[channel][1] += l1 * direction.y;
		coefficients[channel][2] += l1 * direction.z;
		coefficients[channel][3] += l1 * direction.x;
		const l2 = (5 / 192) * (2 * e - s - g) * intensity;
		if (
			Math.abs(l2) > 1e-8 &&
			Math.abs(direction.x) + Math.abs(direction.z) > 1e-8
		)
			throw new Error(
				"Uneven Trilight HemisphereLight groups must point along world Y",
			);
		coefficients[channel][6] += l2;
		coefficients[channel][8] += 3 * l2;
	}
}

export class LilToonLightAdapter {
	read(scene: Scene): LilToonSceneLighting {
		let main: DirectionalLight | undefined;
		const ambient = new Color(0, 0, 0);
		const sh9: [number[], number[], number[]] = [
			Array(9).fill(0),
			Array(9).fill(0),
			Array(9).fill(0),
		];
		const unitySHAr = new Vector4();
		const unitySHAg = new Vector4();
		const unitySHAb = new Vector4();
		const unitySHBr = new Vector4();
		const unitySHBg = new Vector4();
		const unitySHBb = new Vector4();
		const unitySHC = new Vector4(0, 0, 0, 1);
		const hemispheres: HemisphereLight[] = [];
		scene.traverseVisible((object) => {
			if (!main && object instanceof DirectionalLight) main = object;
			if (object instanceof AmbientLight) {
				const contribution = object.color
					.clone()
					.multiplyScalar(object.intensity);
				ambient.add(contribution);
				sh9[0][0] += contribution.r;
				sh9[1][0] += contribution.g;
				sh9[2][0] += contribution.b;
			}
			if (object instanceof HemisphereLight) hemispheres.push(object);
		});
		for (let index = 0; index < hemispheres.length; index += 1) {
			const first = hemispheres[index];
			const second = hemispheres[index + 1];
			first.getWorldPosition(hemisphereDirection).normalize();
			second?.getWorldPosition(secondHemisphereDirection).normalize();
			if (
				second &&
				hemisphereDirection.distanceTo(secondHemisphereDirection) < 1e-8
			) {
				// Adjacent half-intensity Hemispheres form one Unity Trilight profile:
				// first.sky, the shared midpoint between first.ground/second.sky, and
				// second.ground. Sum intensity preserves the group's total contribution.
				const intensity = first.intensity + second.intensity;
				const equator = first.groundColor
					.clone()
					.add(second.color)
					.multiplyScalar(0.5);
				addTrilightProbe(
					sh9,
					first.color,
					equator,
					second.groundColor,
					intensity,
					hemisphereDirection,
				);
				index += 1;
			} else {
				const equator = first.color
					.clone()
					.add(first.groundColor)
					.multiplyScalar(0.5);
				addTrilightProbe(
					sh9,
					first.color,
					equator,
					first.groundColor,
					first.intensity,
					hemisphereDirection,
				);
			}
		}
		// lil_common_functions.hlsl:lilShadeSH9 (lines 849-868 in the pinned
		// Unity lilToon source) evaluates these coefficients. PackCoefficients
		// follows Unity FPSSample SphericalHarmonics.cs lines 40-55.
		for (const [values, targetA, targetB] of [
			[sh9[0], unitySHAr, unitySHBr],
			[sh9[1], unitySHAg, unitySHBg],
			[sh9[2], unitySHAb, unitySHBb],
		] as const) {
			targetA.set(values[3], values[1], values[2], values[0] - values[6]);
			targetB.set(values[4], values[5], 3 * values[6], values[7]);
		}
		unitySHC.set(sh9[0][8], sh9[1][8], sh9[2][8], 1);
		ambient.set(sh9[0][0], sh9[1][0], sh9[2][0]);
		// A missing Three.js DirectionalLight is the equivalent of Unity having no
		// main light. Keep both uniforms at zero so OpenLit can derive its fallback
		// direction from SH and the material's _LightDirectionOverride. Supplying
		// an artificial white, upward-facing light here drives lilToon's direct
		// specular and toon terms even in an otherwise unlit Three.js scene.
		const direction = new Vector3();
		const color = new Color(0, 0, 0);
		if (main) {
			main.getWorldPosition(lightPosition);
			main.target.getWorldPosition(targetPosition);
			direction.subVectors(lightPosition, targetPosition).normalize();
			color.copy(main.color).multiplyScalar(main.intensity);
		}
		return {
			main,
			direction,
			color,
			ambient,
			unitySHAr,
			unitySHAg,
			unitySHAb,
			unitySHBr,
			unitySHBg,
			unitySHBb,
			unitySHC,
		};
	}
}
