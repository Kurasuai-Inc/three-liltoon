import {
	BufferAttribute,
	type BufferGeometry,
	type InterleavedBufferAttribute,
	type TypedArray,
} from "three";

type Attribute = BufferAttribute | InterleavedBufferAttribute;
type Mikk = {
	generateTangents(
		position: Float32Array,
		normal: Float32Array,
		uv: Float32Array,
	): Float32Array;
};

/** Preserve MikkTSpace's corner results without expanding every blendshape. */
export function generateIndexedTangents(geometry: BufferGeometry, mikk: Mikk) {
	const index = geometry.index;
	const position = geometry.getAttribute("position");
	const count = index?.count ?? position.count;
	const corners = (attribute: Attribute, size: number) => {
		const result = new Float32Array(count * size);
		for (let corner = 0; corner < count; corner++) {
			const vertex = index ? index.getX(corner) : corner;
			result[corner * size] = attribute.getX(vertex);
			result[corner * size + 1] = attribute.getY(vertex);
			if (size === 3) result[corner * size + 2] = attribute.getZ(vertex);
		}
		return result;
	};
	const tangents = mikk.generateTangents(
		corners(position, 3),
		corners(geometry.getAttribute("normal"), 3),
		corners(geometry.getAttribute("uv"), 2),
	);
	// Match Three's glTF handedness convention exactly.
	for (let i = 3; i < tangents.length; i += 4) tangents[i] *= -1;
	if (!index) {
		geometry.setAttribute("tangent", new BufferAttribute(tangents, 4));
		return;
	}
	const bits = new Uint32Array(
		tangents.buffer,
		tangents.byteOffset,
		tangents.length,
	);
	const vertices: number[] = [],
		tangentCorners: number[] = [],
		indices = new Uint32Array(count);
	const groups = new Map<string, number>();
	for (let corner = 0; corner < count; corner++) {
		const original = index.getX(corner),
			offset = corner * 4;
		const key = `${original}/${bits[offset]}/${bits[offset + 1]}/${bits[offset + 2]}/${bits[offset + 3]}`;
		let vertex = groups.get(key);
		if (vertex === undefined) {
			vertex = vertices.length;
			groups.set(key, vertex);
			vertices.push(original);
			tangentCorners.push(corner);
		}
		indices[corner] = vertex;
	}
	const remapped = new Map<Attribute, BufferAttribute>();
	const remap = (attribute: Attribute) => {
		const existing = remapped.get(attribute);
		if (existing) return existing;
		const ArrayType = attribute.array.constructor as new (
			length: number,
		) => TypedArray;
		const array = new ArrayType(vertices.length * attribute.itemSize);
		const interleaved = "data" in attribute;
		const stride = interleaved ? attribute.data.stride : attribute.itemSize;
		const offset = interleaved ? attribute.offset : 0;
		for (let v = 0; v < vertices.length; v++)
			for (let c = 0; c < attribute.itemSize; c++)
				array[v * attribute.itemSize + c] =
					attribute.array[vertices[v] * stride + offset + c];
		const result = new BufferAttribute(
			array,
			attribute.itemSize,
			attribute.normalized,
		);
		result.name = attribute.name;
		result.setUsage(interleaved ? attribute.data.usage : attribute.usage);
		if (!interleaved) result.gpuType = attribute.gpuType;
		remapped.set(attribute, result);
		return result;
	};
	for (const [name, attribute] of Object.entries(geometry.attributes))
		geometry.setAttribute(name, remap(attribute));
	for (const name of Object.keys(
		geometry.morphAttributes,
	) as (keyof typeof geometry.morphAttributes)[]) {
		geometry.morphAttributes[name] = geometry.morphAttributes[name]?.map(remap);
	}
	const indexedTangents = new Float32Array(vertices.length * 4);
	tangentCorners.forEach((corner, vertex) =>
		indexedTangents.set(
			tangents.subarray(corner * 4, corner * 4 + 4),
			vertex * 4,
		),
	);
	geometry.setAttribute("tangent", new BufferAttribute(indexedTangents, 4));
	geometry.setIndex(
		new BufferAttribute(
			vertices.length <= 65535 ? new Uint16Array(indices) : indices,
			1,
		),
	);
}
