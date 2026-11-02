import { describe, expect, it } from "vitest";
import { LinearSRGBColorSpace, SRGBColorSpace, Texture } from "three";
import { TextureViews } from "../../src/utils/TextureViews.js";

describe("per-use texture color spaces", () => {
	it("keeps shared source textures unchanged while creating independent sampling views", () => {
		const source = new Texture();
		source.colorSpace = SRGBColorSpace;
		const resource = {
			property: "_MainTex",
			uniform: "u_MainTex",
			sampler: "lil_sampler_linear",
		} as never;
		const srgbView = new TextureViews().get(
			resource,
			{ _MainTex: source },
			{ _MainTex: "srgb" },
		);
		const linearView = new TextureViews().get(
			resource,
			{ _MainTex: source },
			{ _MainTex: "linear" },
		);
		expect(srgbView).not.toBe(source);
		expect(linearView).not.toBe(source);
		expect(srgbView?.colorSpace).toBe(SRGBColorSpace);
		expect(linearView?.colorSpace).toBe(LinearSRGBColorSpace);
		expect(source.colorSpace).toBe(SRGBColorSpace);
	});

	it("creates a view once and does not invalidate the shared image on later binds", () => {
		const source = new Texture();
		const views = new TextureViews();
		const resource = {
			property: "_MainTex",
			uniform: "u_MainTex",
			sampler: "lil_sampler_linear",
		} as never;
		const initialVersion = source.source.version;
		const first = views.get(resource, { _MainTex: source });
		expect(source.source.version).toBe(initialVersion + 1);
		for (let frame = 0; frame < 3; frame++)
			expect(views.get(resource, { _MainTex: source })).toBe(first);
		expect(source.source.version).toBe(initialVersion + 1);
		views.dispose();
		source.dispose();
	});
});
