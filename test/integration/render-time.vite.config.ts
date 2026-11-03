import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({
	base: "./",
	build: {
		outDir: ".tmp/render-time-web",
		rollupOptions: { input: resolve("test/integration/render-time.html") },
	},
});
