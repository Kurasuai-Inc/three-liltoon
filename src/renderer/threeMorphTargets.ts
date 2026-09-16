import {
	DataTexture,
	FloatType,
	RedFormat,
	ShaderChunk,
	type BufferGeometry,
	type Mesh,
	type RawShaderMaterial,
} from "three";

/** Material-owned scratch texture, rebound from the current mesh on every draw. */
export class MorphWeights {
	readonly uniform = { value: null as DataTexture | null };
	update(mesh: Mesh, maxTextureSize: number): void {
		const count =
			(
				mesh.geometry.morphAttributes.position ||
				mesh.geometry.morphAttributes.normal
			)?.length ?? 0;
		if (!count) return;
		const width = Math.min(count, maxTextureSize);
		const height = Math.ceil(count / width);
		if (height > maxTextureSize)
			throw new Error(
				"[three-liltoon] Morph weights exceed this device's texture size limit.",
			);
		let texture = this.uniform.value;
		if (
			!texture ||
			texture.image.width !== width ||
			texture.image.height !== height
		) {
			this.dispose();
			texture = new DataTexture(
				new Float32Array(width * height),
				width,
				height,
				RedFormat,
				FloatType,
			);
			texture.name = "three-liltoon morph weights";
			this.uniform.value = texture;
		}
		const data = texture.image.data as Float32Array;
		let changed = texture.version === 0;
		for (let i = 0; i < count; i++) {
			const value = Math.fround(mesh.morphTargetInfluences?.[i] ?? 0);
			if (data[i] !== value) {
				data[i] = value;
				changed = true;
			}
		}
		if (changed) texture.needsUpdate = true;
	}
	dispose(): void {
		this.uniform.value?.dispose();
		this.uniform.value = null;
	}
}

// Retain the installed peer's displacement lookup and morph arithmetic. Only
// the weight transport changes; no global ShaderChunk or renderer patch.
function morphChunks(source: string): string {
	const declaration =
		/uniform float morphTargetInfluences\[\s*MORPHTARGETS_COUNT\s*\];/;
	if (!declaration.test(ShaderChunk.morphtarget_pars_vertex))
		throw new Error(
			"[three-liltoon] Unsupported Three.js morph weight declaration.",
		);
	return source
		.replace(
			"#include <morphtarget_pars_vertex>",
			ShaderChunk.morphtarget_pars_vertex.replace(
				declaration,
				`
uniform highp sampler2D mochiyaMorphWeights;
float mochiyaMorphWeight(int index) {
	int width = textureSize(mochiyaMorphWeights, 0).x;
	return texelFetch(mochiyaMorphWeights, ivec2(index % width, index / width), 0).r;
}`,
			),
		)
		.replace("#include <morphnormal_vertex>", ShaderChunk.morphnormal_vertex)
		.replace("#include <morphtarget_vertex>", ShaderChunk.morphtarget_vertex)
		.replace(/morphTargetInfluences\[\s*i\s*\]/g, "mochiyaMorphWeight(i)");
}

/** Feed Three's morphed attributes into the compiled lilToon vertex entry. */
export function withThreeMorphTargets(source: string): string {
	if (
		!source.includes("void main()") ||
		!source.includes("in vec4 position;")
	) {
		throw new Error(
			"[three-liltoon] Compiled vertex entry no longer matches the Three.js morph integration.",
		);
	}
	return morphChunks(
		source.replace(
			"void main()",
			`
precision highp sampler2DArray;
#include <morphtarget_pars_vertex>
void lilToonMain(vec4 position, vec3 normal)`,
		) +
			`
void main() {
	vec3 transformed = position.xyz;
	vec3 objectNormal = ${source.includes("in vec3 normal;") ? "normal" : "vec3(0.0, 0.0, 1.0)"};
	#include <morphnormal_vertex>
	#include <morphtarget_vertex>
	lilToonMain(vec4(transformed, position.w), objectNormal);
}
`,
	);
}

/** RawShaderMaterial omits Three's geometry defines; supply only that metadata.
 * WebGLRenderer owns morph displacement textures and the base influence.
 */
export function updateThreeMorphDefines(
	material: RawShaderMaterial,
	geometry: BufferGeometry,
): void {
	const morph = geometry.morphAttributes;
	const count = (morph.position || morph.normal || morph.color)?.length ?? 0;
	const next = {
		USE_MORPHTARGETS: Boolean(morph.position),
		USE_MORPHNORMALS: Boolean(morph.normal),
		MORPHTARGETS_COUNT: count,
		MORPHTARGETS_TEXTURE_STRIDE: morph.color
			? 3
			: morph.normal
				? 2
				: morph.position
					? 1
					: 0,
	};
	let changed = false;
	for (const [name, value] of Object.entries(next)) {
		if (material.defines[name] !== value) {
			material.defines[name] = value;
			changed = true;
		}
	}
	if (changed) material.needsUpdate = true;
}
