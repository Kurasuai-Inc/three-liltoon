/**
 * Cached parse of a generated shader source. Every LilToonMaterial construction
 * derived the globals struct, property references, and cube samplers by running
 * full-source regexes again, even though programs are shared across materials.
 * Results are keyed by the exact source string so identical text is parsed once.
 */
export interface LilToonShaderSourceAnalysis {
	/** Member name to GLSL type of the `struct type_Globals` block. */
	readonly globalTypes: ReadonlyMap<string, string>;
	/** Property names referenced through `_Globals.X` member access. */
	readonly usedProperties: ReadonlySet<string>;
	/** Uniform names declared as `samplerCube`. */
	readonly cubeSamplers: ReadonlySet<string>;
}

// Programs are bounded at 128 variants; allowing two stages per variant keeps
// every live source parsed once while still evicting stale entries first.
const LIMIT = 256;
const cache = new Map<string, LilToonShaderSourceAnalysis>();

function parse(source: string): LilToonShaderSourceAnalysis {
	const globalTypes = new Map<string, string>();
	const body = /struct\s+type_Globals\s*\{([\s\S]*?)\};/.exec(source)?.[1];
	if (body)
		for (const match of body.matchAll(
			/(?:lowp\s+|mediump\s+|highp\s+)?(mat4|vec4|vec3|vec2|float|uint|int)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?\s*;/g,
		))
			globalTypes.set(
				match[2]!,
				`${match[1]}${match[3] ? `[${match[3]}]` : ""}`,
			);
	const usedProperties = new Set<string>();
	for (const match of source.matchAll(/\b_Globals\.([A-Za-z_]\w*)/g))
		usedProperties.add(match[1]!);
	const cubeSamplers = new Set<string>();
	for (const match of source.matchAll(
		/uniform\s+(?:\w+\s+)?samplerCube\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/g,
	))
		cubeSamplers.add(match[1]!);
	return { globalTypes, usedProperties, cubeSamplers };
}

export function analyzeShaderSource(
	source: string,
): LilToonShaderSourceAnalysis {
	const hit = cache.get(source);
	if (hit) {
		cache.delete(source);
		cache.set(source, hit);
		return hit;
	}
	const result = parse(source);
	if (cache.size >= LIMIT) cache.delete(cache.keys().next().value!);
	cache.set(source, result);
	return result;
}
