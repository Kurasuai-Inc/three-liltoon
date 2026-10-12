import type { CubeTexture, IUniform, WebGLRenderer } from "three";
import type { ShaderResource } from "../generated/shaders.js";
export interface TextureLimits {
	vertex: number;
	fragment: number;
	combined: number;
}
const limits = new WeakMap<WebGLRenderer, TextureLimits>();
export function assertTextureLimits(
	name: string,
	resources: readonly ShaderResource[],
	limit: TextureLimits,
	morph = false,
): void {
	const vertex =
		new Set(resources.filter((r) => r.stage === "vertex").map((r) => r.uniform))
			.size +
		2 * Number(morph);
	const fragment = new Set(
		resources.filter((r) => r.stage === "fragment").map((r) => r.uniform),
	).size;
	const combined = vertex + fragment;
	if (
		vertex > limit.vertex ||
		fragment > limit.fragment ||
		combined > limit.combined
	)
		throw new Error(
			`[three-liltoon] ${name}: texture units exceed this device's limits (vertex ${vertex}/${limit.vertex}, fragment ${fragment}/${limit.fragment}, combined ${combined}/${limit.combined}). Enabled features were preserved; use fewer textures or a device with higher limits.`,
		);
}
export function checkTextureLimits(
	renderer: WebGLRenderer,
	name: string,
	resources: readonly ShaderResource[],
	morph: boolean,
): void {
	let limit = limits.get(renderer);
	if (!limit) {
		const gl = renderer.getContext();
		limit = {
			vertex: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
			fragment: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
			combined: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
		};
		limits.set(renderer, limit);
	}
	assertTextureLimits(name, resources, limit, morph);
}

/** Data cubemaps cannot use Three's ordinary image-resize fallback. */
export function checkCubeTextureSizes(
	renderer: WebGLRenderer,
	uniforms: Record<string, IUniform>,
): void {
	for (const [name, uniform] of Object.entries(uniforms)) {
		const cube = uniform.value as CubeTexture | undefined;
		if (!cube?.isCubeTexture) continue;
		const face = cube.images?.[0] as
			{ image?: { width?: number }; width?: number } | undefined;
		const width = face?.image?.width ?? face?.width;
		if (width !== undefined && width > renderer.capabilities.maxCubemapSize)
			throw new Error(
				`[three-liltoon] ${name}: cubemap face size ${width} exceeds this device's limit ${renderer.capabilities.maxCubemapSize}. Export a smaller cubemap.`,
			);
	}
}
