import { describe, expect, it, vi } from "vitest";
import type { GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";

vi.mock("../../src/shader/ShaderProgramLibrary.js", () => ({
	getLilToonShaderProgram: (mode: string) => ({
		key: `forward:${mode}`,
		vertexShader: "in vec4 position;\nvoid main() { gl_Position = position; }",
		fragmentShader: "struct type_Globals\n{\n};\nvoid main() {}",
		samplerBindings: new Map(),
		resources: [],
	}),
	getOutlineShaderProgram: (
		_properties: unknown,
		_textures: unknown,
		mode: string,
	) => ({
		key: `outline:${mode}`,
		vertexShader: "in vec4 position;\nvoid main() { gl_Position = position; }",
		fragmentShader: "struct type_Globals\n{\n};\nvoid main() {}",
		samplerBindings: new Map(),
		resources: [],
	}),
}));

import { GLTFLilToonExtension } from "../../src/loaders/GLTFLilToonExtension.js";
import {
	LILTOON_GLTF_EXTENSION,
	LILTOON_GLTF_SPEC_VERSION,
} from "../../src/loaders/types.js";

function makeParser(materialCount: number) {
	return {
		json: {
			materials: Array.from({ length: materialCount }, (_, i) => ({
				name: `M${i}`,
				extensions: {
					[LILTOON_GLTF_EXTENSION]: {
						specVersion: LILTOON_GLTF_SPEC_VERSION,
						renderMode: "opaque",
						properties: {},
					},
				},
			})),
		},
		associations: new Map(),
		getDependency: () => Promise.reject(new Error("No textures expected")),
	} as unknown as GLTFParser;
}

describe("GLTFLilToonExtension pacing", () => {
	it("yields through yieldControl before each material construction", async () => {
		const yields: number[] = [];
		const extension = new GLTFLilToonExtension(makeParser(3), {
			pacing: {
				budgetMs: 0,
				yieldControl: () => {
					yields.push(performance.now());
					return Promise.resolve();
				},
			},
		});
		await Promise.all([0, 1, 2].map((i) => extension.loadMaterial(i)));
		expect(yields.length).toBeGreaterThanOrEqual(3);
	});

	it("still constructs every material without a pacing option", async () => {
		const extension = new GLTFLilToonExtension(makeParser(2));
		const materials = await Promise.all(
			[0, 1].map((i) => extension.loadMaterial(i)),
		);
		expect(materials.every((m) => m !== null)).toBe(true);
	});
});
