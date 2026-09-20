import { expect, it } from "vitest";
import { BufferAttribute, PlaneGeometry } from "three";
import { computeMikkTSpaceTangents } from "three/addons/utils/BufferGeometryUtils.js";
import * as Mikk from "three/examples/jsm/libs/mikktspace.module.js";
import { generateIndexedTangents } from "../../src/loaders/indexedTangents.js";

it("retains exact per-corner tangent, skin and morph data without expanding all targets", async () => {
	await Mikk.ready;
	const original = new PlaneGeometry(2, 2, 12, 12);
	const n = original.getAttribute("position").count;
	original.morphTargetsRelative = true;
	original.morphAttributes.position = Array.from(
		{ length: 70 },
		(_, j) =>
			new BufferAttribute(
				Float32Array.from({ length: n * 3 }, (_, i) => Math.sin(i + j) * 0.01),
				3,
			),
	);
	original.setAttribute(
		"skinIndex",
		new BufferAttribute(new Uint16Array(n * 4), 4),
	);
	const expected = computeMikkTSpaceTangents(original.clone(), Mikk);
	generateIndexedTangents(original, Mikk);
	expect(original.index).not.toBeNull();
	expect(original.getAttribute("position").count).toBe(n);
	const corners = original.toNonIndexed();
	for (const name of ["position", "normal", "uv", "tangent", "skinIndex"])
		expect(corners.getAttribute(name).array).toEqual(
			expected.getAttribute(name).array,
		);
	for (let i = 0; i < 70; i++)
		expect(corners.morphAttributes.position![i].array).toEqual(
			expected.morphAttributes.position![i].array,
		);
	expect(original.morphTargetsRelative).toBe(true);
});
it("splits a shared vertex only when generated corner tangents differ", () => {
	const g = new PlaneGeometry();
	generateIndexedTangents(g, {
		generateTangents: () =>
			new Float32Array([
				1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, -1, 0, 1, 0, -1, 0, 1, 0,
				-1,
			]),
	});
	expect(g.index!.count).toBe(6);
	expect(g.getAttribute("position").count).toBe(6);
});
