import { Scene } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import type { GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";
import { LilToonMaterial } from "../../src/material/LilToonMaterial.js";
import { LilToonMaterialFactory } from "../../src/material/LilToonMaterialFactory.js";
import {
	LilToonShaderVariantMismatchError,
	shaderVariants,
	type LilToonShaderVariant,
} from "../../src/material/shaderVariants.js";
import { GLTFLilToonExtension } from "../../src/loaders/GLTFLilToonExtension.js";

// Kurasuai fork: renderMode/transparencyMode are authoritative; shaderVariant is optional
// metadata that must agree with them. Upstream 0.1.9's table still selects the passes.
function parserFor(definition: object): GLTFParser {
	return {
		json: {
			materials: [{ extensions: { MOCHIYA_materials_liltoon: definition } }],
		},
		associations: new Map(),
	} as unknown as GLTFParser;
}

describe("Unity shader selection (modes authoritative)", () => {
	it.each(Object.keys(shaderVariants) as LilToonShaderVariant[])(
		"preserves %s with its modes through loading, cloning and serialization",
		async (shaderVariant) => {
			const [renderMode, transparencyMode, outline] =
				shaderVariants[shaderVariant];
			for (const useOutline of [0, 1]) {
				const properties = { _UseOutline: useOutline, _OutlineWidth: 0 };
				const definition = {
					renderMode,
					transparencyMode,
					shaderVariant,
					properties,
				};
				const loaded = (await new GLTFLilToonExtension(
					parserFor(definition),
				).loadMaterial(0)) as LilToonMaterial;
				// Older writers omit the modes; the loader infers them from the name.
				const legacy = (await new GLTFLilToonExtension(
					parserFor({ shaderVariant, properties }),
				).loadMaterial(0)) as LilToonMaterial;
				const direct = new LilToonMaterial(definition);
				const clone = loaded.clone();
				const json = loaded.toLilToonJSON();
				expect(json.renderMode).toBe(renderMode);
				expect(json.transparencyMode).toBe(transparencyMode);
				expect(json.shaderVariant).toBe(shaderVariant);
				expect(json).not.toHaveProperty("renderQueue");
				const restored = new LilToonMaterialFactory().create(json);
				for (const material of [loaded, legacy, direct, clone, restored]) {
					expect(material.shaderVariant).toBe(shaderVariant);
					expect(material.renderMode).toBe(renderMode);
					expect(material.transparencyMode).toBe(transparencyMode);
					expect(material.featureSet.outline).toBe(outline);
					expect(material.passVariant).toBe(shaderVariant);
					material.setProperty("_UseOutline", 1 - useOutline);
					expect(material.featureSet.outline).toBe(outline);
					expect(material.getProperty("_UseOutline")).toBe(1 - useOutline);
					material.dispose();
				}
			}
		},
	);
	it("keeps a recognised name consistent when mode and alpha-test conveniences change", () => {
		const material = new LilToonMaterial({
			shaderVariant: "Hidden/lilToonOutline",
		});
		material.alphaTest = 0.4;
		expect(material.renderMode).toBe("cutout");
		expect(material.shaderVariant).toBe("Hidden/lilToonCutoutOutline");
		material.renderMode = "transparent";
		material.transparencyMode = "two-pass";
		expect(material.shaderVariant).toBe(
			"Hidden/lilToonTwoPassTransparentOutline",
		);
		material.renderMode = "gem";
		expect(material.shaderVariant).toBe("Hidden/lilToonGem");
		expect(material.featureSet.outline).toBe(false);
		material.renderMode = "opaque";
		expect(material.shaderVariant).toBe("lilToon");
		material.dispose();
	});
	it("selects the outline from _UseOutline when no shader name is held", () => {
		const material = new LilToonMaterial({
			properties: { _UseOutline: 1, _OutlineWidth: 10 },
		});
		expect(material.shaderVariant).toBeUndefined();
		expect(material.featureSet.outline).toBe(true);
		expect(material.passVariant).toBe("Hidden/lilToonOutline");
		const json = material.toLilToonJSON();
		expect(json).not.toHaveProperty("shaderVariant");
		expect(json.renderMode).toBe("opaque");
		material.dispose();
		const fur = new LilToonMaterial({
			renderMode: "fur",
			properties: { _UseOutline: 1, _OutlineWidth: 10 },
		});
		// The table has no outline pass for fur, gem or refraction.
		expect(fur.featureSet.outline).toBe(false);
		fur.dispose();
	});
	it("rejects a recognised name that contradicts the modes in every input path", async () => {
		const input = {
			shaderVariant: "lilToon",
			renderMode: "transparent" as const,
			transparencyMode: "two-pass" as const,
			properties: {},
			textures: {},
		};
		expect(() => new LilToonMaterial(input)).toThrow(
			LilToonShaderVariantMismatchError,
		);
		expect(() => new LilToonMaterialFactory().create(input)).toThrow(
			LilToonShaderVariantMismatchError,
		);
		await expect(
			new GLTFLilToonExtension(parserFor(input)).loadMaterial(0),
		).rejects.toThrow(LilToonShaderVariantMismatchError);
		const material = new LilToonMaterial({ renderMode: "cutout" });
		expect(() => {
			material.shaderVariant = "Hidden/lilToonTransparent";
		}).toThrow(LilToonShaderVariantMismatchError);
		expect(material.shaderVariant).toBeUndefined();
		expect(() =>
			material.setPassSelection("cutout", "normal", "lilToon"),
		).toThrow(LilToonShaderVariantMismatchError);
		material.setPassSelection("cutout", "normal", "Hidden/lilToonCutout");
		expect(material.shaderVariant).toBe("Hidden/lilToonCutout");
		material.dispose();
	});
	it.each(Object.keys(shaderVariants) as LilToonShaderVariant[])(
		"selects passes from modes alone for %s",
		(name) => {
			const [renderMode, transparencyMode] = shaderVariants[name];
			const material = new LilToonMaterial({ renderMode, transparencyMode });
			expect(material.renderMode).toBe(renderMode);
			expect(material.transparencyMode).toBe(transparencyMode);
			expect(material.shaderVariant).toBeUndefined();
			expect(material.featureSet.outline).toBe(false);
			material.dispose();
		},
	);
	it("keeps unknown shader names as metadata and warns when loaded", async () => {
		const material = new LilToonMaterial({
			shaderVariant: "lilToonMulti",
			properties: { _UseOutline: 1 },
		});
		expect(material.shaderVariant).toBe("lilToonMulti");
		expect(material.featureSet.outline).toBe(true);
		material.dispose();
		const warnings: string[] = [];
		const loader = new GLTFLilToonExtension(
			parserFor({ renderMode: "cutout", shaderVariant: "_lil/lilToonMulti" }),
			{ onWarning: (w) => warnings.push(w.code) },
		);
		const loaded = (await loader.loadMaterial(0)) as LilToonMaterial;
		expect(loaded.renderMode).toBe("cutout");
		await loader.afterRoot({
			scene: new Scene(),
			userData: {},
		} as unknown as GLTF);
		expect(warnings).toContain("unsupported-shader-variant");
		loaded.dispose();
	});
});
