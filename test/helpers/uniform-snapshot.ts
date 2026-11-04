/** Snapshot actual uniform payloads, including nested _Globals, without rewriting them. */
export function uniformSnapshot(value: unknown): unknown {
	if (value === null || typeof value !== "object") return value;
	if (ArrayBuffer.isView(value))
		return Array.from(value as unknown as ArrayLike<number>);
	if (Array.isArray(value)) return value.map(uniformSnapshot);
	const object = value as Record<string, unknown>;
	if (object.isTexture) {
		const source = object.source as { uuid: string; version: number };
		return {
			texture: object.uuid,
			version: object.version,
			source: source.uuid,
			sourceVersion: source.version,
			matrix: uniformSnapshot(object.matrix),
		};
	}
	if (typeof object.toArray === "function")
		return (object.toArray as () => unknown).call(value);
	return Object.fromEntries(
		Object.keys(object)
			.sort()
			.map((key) => [key, uniformSnapshot(object[key])]),
	);
}
