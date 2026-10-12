import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
const fixture = `/@fs/${path.resolve("test/integration/cubemap-fixture.ts").replaceAll("\\", "/")}`;
for (const name of [
	"synthetic",
	"cubemap-z.glb",
	"cubemap-x.glb",
	"cubemap-vrm.vrm",
]) {
	test(`renders embedded HDR cubes: ${name}`, async ({ page }) => {
		test.skip(
			name !== "synthetic" && !process.env.MOCHIYA_CUBEMAP_FIXTURES,
			"Set MOCHIYA_CUBEMAP_FIXTURES to Unity's generated fixture directory.",
		);
		const errors: string[] = [];
		page.on("pageerror", (e) => errors.push(e.message));
		page.on("console", (m) => {
			if (m.type() === "error") errors.push(m.text());
		});
		await page.goto("/");
		const bytes =
			name === "synthetic"
				? undefined
				: [
						...readFileSync(
							path.join(process.env.MOCHIYA_CUBEMAP_FIXTURES!, name),
						),
					];
		const result = await page.evaluate(
			async ({ url, bytes }) => (await import(url)).verifyCubeTransport(bytes),
			{ url: fixture, bytes },
		);
		expect(
			Object.entries(result.checks).filter(([, ok]) => !ok),
			JSON.stringify(result),
		).toEqual([]);
		expect(result.glError).toBe(0);
		expect(errors).toEqual([]);
	});
}
