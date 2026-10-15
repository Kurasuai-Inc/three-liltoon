import type { Texture } from "three";
import { LilToonMaterial } from "./LilToonMaterial.js";
import type { SerializedLilToonMaterial } from "./LilToonMaterialState.js";

export class LilToonMaterialFactory {
	create(
		source: SerializedLilToonMaterial,
		textures: Record<string, Texture | null> = {},
	): LilToonMaterial {
		return new LilToonMaterial({
			renderMode: source.renderMode,
			shaderVariant: source.shaderVariant,
			transparencyMode: source.transparencyMode,
			properties: source.properties,
			textures,
		});
	}
}
