# Ambient comparison capture

This page renders one GLB at a fixed camera, resolution, background, and scene
light setup. Supply a profile collected from the matching Unity capture and
serve the model/profile from the isolated 4090 workspace.

Start it through the workspace managed server with:

```powershell
npm run example:ambient-capture:dev -- --host 0.0.0.0 --port {port}
```

Open `/examples/ambient-capture/?profile=<URL-encoded-profile-URL>`. The profile
contains `name`, `modelUrl`, `width`, `height`, `background`, `camera`,
`directional`, `ambient`, and `unity` fields. Camera and light vectors are
world-space XYZ arrays. The `unity` object is copied to the capture metadata so
the original Unity values remain beside the image.

Example profile:

```json
{
	"name": "flat-face-direct-only",
	"modelUrl": "https://<managed-host>/<isolated-source-model>.glb",
	"width": 256,
	"height": 256,
	"background": "#808080",
	"camera": {
		"position": [0, 0.06, 1.194],
		"target": [0, 0.06, 0],
		"fov": 30,
		"near": 0.01,
		"far": 100
	},
	"directional": {
		"color": "#ffffff",
		"intensity": 1,
		"position": [0.6, 1.4, 1.2],
		"target": [0, 0, 0]
	},
	"ambient": { "kind": "flat", "color": "#000000", "intensity": 0 },
	"unity": {
		"ambientMode": "Flat",
		"ambientLight": "#000000",
		"ambientIntensity": 1,
		"activeColorSpace": "Linear"
	}
}
```

For a Trilight profile, provide `skyColor`, `equatorColor`, `groundColor`,
`intensity`, and `position`. Three.js `HemisphereLight` only represents sky and
ground as a first-order gradient; the equator value is retained in JSON but is
not rendered. The capture metadata labels this approximation explicitly so
pixel differences remain visible instead of being mistaken for a full Unity
Trilight implementation.

Capture the WebGL canvas and its metadata, optionally pairing it with the Unity
PNG (same pixel dimensions):

```powershell
node tools/capture/ambient-pair.mjs `
  --url "<managed-viewer-url>/examples/ambient-capture/?profile=<profile-url>" `
  --out "D:/AgentWorkspace/tmp/liltoon-support-20261014/out/three-flat.png" `
  --unity "D:/AgentWorkspace/tmp/liltoon-support-20261014/out/unity-flat.png"
```

The script writes the Three PNG, metadata JSON, side-by-side PNG, and mean
absolute RGB error. It fails on mismatched image dimensions or a WebGL load
error. Keep source assets read-only and place every output under the task's
`out/` directory.
