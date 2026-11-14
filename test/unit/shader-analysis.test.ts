import { describe, expect, it } from "vitest";
import { analyzeShaderSource } from "../../src/shader/shaderAnalysis.js";
import { createGlobalUniforms } from "../../src/renderer/LilToonUniformBinder.js";
import { shaderPropertyReferences } from "../../src/utils/materialWarnings.js";

const VERTEX = `
uniform highp vec4 uCamera;
struct type_Globals
{
	highp mat4 uModelMatrix;
	highp vec4 _Color;
	float _Cutoff;
	highp vec4 _MainTex_ST;
};
uniform samplerCube uReflectionProbe;
void main()
{
	vec4 c = _Globals._Color;
	float f = _Globals._Cutoff;
}
`;

const FRAGMENT = `
struct type_Globals
{
	highp mat4 uModelMatrix;
	highp vec4 _Color;
	float _Cutoff;
	mediump vec4 _EmissionColor[2];
};
uniform mediump samplerCube uMatCapCube;
void main()
{
	vec4 e = _Globals._EmissionColor[0];
}
`;

describe("analyzeShaderSource", () => {
	it("parses the globals struct, member references, and cube samplers", () => {
		const vertex = analyzeShaderSource(VERTEX);
		expect(vertex.globalTypes.get("uModelMatrix")).toBe("mat4");
		expect(vertex.globalTypes.get("_MainTex_ST")).toBe("vec4");
		expect(vertex.globalTypes.get("_Cutoff")).toBe("float");
		expect(vertex.usedProperties.has("_Color")).toBe(true);
		expect(vertex.usedProperties.has("_Cutoff")).toBe(true);
		expect(vertex.cubeSamplers.has("uReflectionProbe")).toBe(true);

		const fragment = analyzeShaderSource(FRAGMENT);
		expect(fragment.globalTypes.get("_EmissionColor")).toBe("vec4[2]");
		expect(fragment.cubeSamplers.has("uMatCapCube")).toBe(true);
	});

	it("returns the same parsed result for an identical source string", () => {
		// Material constructors used to re-run the same three full-source
		// regexes per material; the cached analysis must be reference-stable.
		const copy = `${VERTEX}`;
		expect(analyzeShaderSource(copy)).toBe(analyzeShaderSource(VERTEX));
	});

	it("does not leak member types across different sources", () => {
		const other = analyzeShaderSource(
			"struct type_Globals { int _OnlyHere; };",
		);
		expect(other.globalTypes.has("_OnlyHere")).toBe(true);
		expect(analyzeShaderSource(VERTEX).globalTypes.has("_OnlyHere")).toBe(
			false,
		);
	});
});

describe("cached shader analysis consumers", () => {
	it("createGlobalUniforms merges member types across stages", () => {
		const globals = createGlobalUniforms(VERTEX, FRAGMENT);
		expect(globals).toHaveProperty("_EmissionColor");
		expect(globals).toHaveProperty("_MainTex_ST");
		expect(globals).toHaveProperty("_Color");
	});

	it("shaderPropertyReferences unions member access across stages", () => {
		const used = shaderPropertyReferences(VERTEX, FRAGMENT);
		expect(used.has("_Color")).toBe(true);
		expect(used.has("_EmissionColor")).toBe(true);
	});
});
