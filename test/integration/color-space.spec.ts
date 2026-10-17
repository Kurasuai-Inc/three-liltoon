import { expect, test } from "@playwright/test";
import path from "node:path";

const fixture = `/@fs/${path.resolve("test/integration/color-space-fixture.ts").replaceAll("\\", "/")}`;

test("matches canvas and sRGB render-target output for the same lilToon input", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});

	await page.goto("/");
	const result = await page.evaluate(
		async (url) => (await import(url)).compareCanvasAndSrgbRenderTarget(),
		fixture,
	);

	expect(result.shaderOutputSrgb).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
	for (const sample of result.cases) {
		expect(sample.canvasPixel).toEqual(sample.renderTargetPixel);
		expect(sample.canvasPixel).toEqual(sample.unitySrgb8);
		expect(sample.colorUniform.slice(0, 3)).toEqual(sample.inputLinear);
	}
	expect(result.glError).toBe(0);
	expect(errors).toEqual([]);
});
