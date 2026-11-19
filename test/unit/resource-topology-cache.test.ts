import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/shader/specialize.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../src/shader/specialize.js")>();
	return { ...actual, specializeResources: vi.fn(actual.specializeResources) };
});

import { getLilToonShaderProgram } from "../../src/shader/ShaderProgramLibrary.js";
import { specializeResources } from "../../src/shader/specialize.js";

describe("resource topology cache", () => {
	it("reuses resource rewriting across feature masks with identical bindings", () => {
		const rewrite = vi.mocked(specializeResources);
		rewrite.mockClear();
		const off = getLilToonShaderProgram("opaque", { _UseRim: 0 });
		const on = getLilToonShaderProgram("opaque", { _UseRim: 1 });

		expect(off.key).not.toBe(on.key);
		expect(rewrite).toHaveBeenCalledTimes(2);
		expect(off.resources).toEqual(on.resources);
		expect(off.samplerBindings).toEqual(on.samplerBindings);
		const withoutDefines = (source: string) =>
			source.replace(
				/^#define SPIRV_CROSS_CONSTANT_ID_\d+ (?:true|false)\n/gm,
				"",
			);
		expect(withoutDefines(off.vertexShader)).toBe(
			withoutDefines(on.vertexShader),
		);
		expect(withoutDefines(off.fragmentShader)).toBe(
			withoutDefines(on.fragmentShader),
		);
	});
});
