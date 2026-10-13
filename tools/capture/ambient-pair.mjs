import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";

function readArgs(args) {
	const values = new Map();
	for (let index = 0; index < args.length; index += 1) {
		if (!args[index].startsWith("--"))
			throw new Error(`Unexpected argument: ${args[index]}`);
		const key = args[index].slice(2);
		const value = args[index + 1];
		if (!value || value.startsWith("--"))
			throw new Error(`Missing value for --${key}`);
		values.set(key, value);
		index += 1;
	}
	return values;
}

const args = readArgs(process.argv.slice(2));
const url = args.get("url");
const outputPath = args.get("out");
const unityPath = args.get("unity");
if (!url || !outputPath)
	throw new Error(
		"Usage: node tools/capture/ambient-pair.mjs --url <capture URL> --out <three.png> [--unity <unity.png>]",
	);

const out = resolve(outputPath);
await mkdir(dirname(out), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
	const page = await browser.newPage({ deviceScaleFactor: 1 });
	page.on("console", (message) => {
		if (message.type() === "error") process.stderr.write(`${message.text()}\n`);
	});
	page.on("pageerror", (error) => process.stderr.write(`${error.stack}\n`));
	await page.goto(url, { waitUntil: "networkidle" });
	await page.waitForFunction(() => window.__CAPTURE_READY__ === true, {
		timeout: 60_000,
	});
	const metadata = await page.evaluate(() => window.__CAPTURE_METADATA__);
	const size = await page.locator("#scene").evaluate((canvas) => ({
		width: canvas.width,
		height: canvas.height,
	}));
	await page.setViewportSize(size);
	await page.locator("#scene").screenshot({ path: out });
	await writeFile(
		out.replace(/\.png$/i, ".json"),
		`${JSON.stringify(metadata, null, 2)}\n`,
	);

	if (unityPath) {
		const threePng = PNG.sync.read(await readFile(out));
		const unityPng = PNG.sync.read(await readFile(resolve(unityPath)));
		if (
			threePng.width !== unityPng.width ||
			threePng.height !== unityPng.height
		)
			throw new Error(
				`Image dimensions differ: Three ${threePng.width}x${threePng.height}, Unity ${unityPng.width}x${unityPng.height}`,
			);
		const joined = new PNG({
			width: threePng.width * 2,
			height: threePng.height,
		});
		let absoluteError = 0;
		for (let y = 0; y < threePng.height; y += 1) {
			for (let x = 0; x < threePng.width; x += 1) {
				const pixel = (y * threePng.width + x) * 4;
				const left = (y * joined.width + x) * 4;
				const right = (y * joined.width + x + threePng.width) * 4;
				for (let channel = 0; channel < 4; channel += 1) {
					joined.data[left + channel] = threePng.data[pixel + channel];
					joined.data[right + channel] = unityPng.data[pixel + channel];
					if (channel < 3)
						absoluteError += Math.abs(
							threePng.data[pixel + channel] - unityPng.data[pixel + channel],
						);
				}
			}
		}
		const joinedPath = out.replace(/\.png$/i, "-side-by-side.png");
		await writeFile(joinedPath, PNG.sync.write(joined));
		const pixelCount = threePng.width * threePng.height;
		process.stdout.write(
			`${JSON.stringify({
				three: out,
				unity: resolve(unityPath),
				sideBySide: joinedPath,
				width: threePng.width,
				height: threePng.height,
				meanAbsoluteRgbError: absoluteError / (pixelCount * 3),
			})}\n`,
		);
	}
} finally {
	await browser.close();
}
