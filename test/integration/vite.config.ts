import { defineConfig } from "vite";

export default defineConfig({
	// Fixtures import VRM expressions lazily. Prebundle them before testing so
	// dependency discovery cannot reload the page during a GPU comparison.
	optimizeDeps: { include: ["@pixiv/three-vrm"] },
});
