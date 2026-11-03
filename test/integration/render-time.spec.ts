import { expect, test } from "@playwright/test";
import path from "node:path";

test("fixed capture time holds every actual draw uniform including nested _Globals", async ({
	page,
}) => {
	await page.goto("/");
	const fixture = `/@fs/${path.resolve("test/integration/render-time-fixture.ts").replaceAll("\\", "/")}`;
	const result = await page.evaluate(
		async (url) => (await import(url)).verifyRenderTime(),
		fixture,
	);
	expect(result.uniformEqual).toBe(true);
	expect(result.nestedGlobalsIncluded).toBe(true);
	expect(result.comparedDraws).toBeGreaterThanOrEqual(2);
});
