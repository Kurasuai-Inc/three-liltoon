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
}

const lightPosition = new Vector3();
const targetPosition = new Vector3();
const hemisphereDirection = new Vector3();
const hemisphereGradient = new Color();

export class LilToonLightAdapter {
	read(scene: Scene): LilToonSceneLighting {
		let main: DirectionalLight | undefined;
		// Preserve the existing lilToon ambient floor while changing only the
		// directional response of Three HemisphereLight objects.
		const ambient = new Color(0.05, 0.05, 0.05);
		const unitySHAr = new Vector4();
		const unitySHAg = new Vector4();
		const unitySHAb = new Vector4();
		scene.traverseVisible((object) => {
			if (!main && object instanceof DirectionalLight) main = object;
			if (object instanceof AmbientLight)
				ambient.add(object.color.clone().multiplyScalar(object.intensity));
			if (object instanceof HemisphereLight) {
				const halfIntensity = object.intensity * 0.5;
				ambient.add(
					object.color
						.clone()
						.add(object.groundColor)
						.multiplyScalar(halfIntensity),
				);
				// HemisphereLight is exactly L0 + L1·normal: its average is the SH
				// constant and half the sky-ground difference is the directional
				// coefficient. Keep that orientation so lilToon's SH9 evaluation
				// responds to the surface normal as it does in Unity.
				object.getWorldPosition(hemisphereDirection).normalize();
				hemisphereGradient
					.copy(object.color)
					.sub(object.groundColor)
					.multiplyScalar(halfIntensity);
				unitySHAr.x += hemisphereGradient.r * hemisphereDirection.x;
				unitySHAr.y += hemisphereGradient.r * hemisphereDirection.y;
				unitySHAr.z += hemisphereGradient.r * hemisphereDirection.z;
				unitySHAg.x += hemisphereGradient.g * hemisphereDirection.x;
				unitySHAg.y += hemisphereGradient.g * hemisphereDirection.y;
				unitySHAg.z += hemisphereGradient.g * hemisphereDirection.z;
				unitySHAb.x += hemisphereGradient.b * hemisphereDirection.x;
				unitySHAb.y += hemisphereGradient.b * hemisphereDirection.y;
				unitySHAb.z += hemisphereGradient.b * hemisphereDirection.z;
			}
		});
		// lil_common_functions.hlsl:852-860 evaluates unity_SHAr..unity_SHAb
		// against float4(normalWS, 1), so w stores the constant ambient and xyz
		// stores the directional term. Higher SH bands remain zero because Three's
		// HemisphereLight contains only a first-order gradient.
		unitySHAr.w = ambient.r;
		unitySHAg.w = ambient.g;
		unitySHAb.w = ambient.b;
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
		};
	}
}
