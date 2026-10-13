# Ambient comparison capture

This page renders one GLB at a fixed camera, resolution, and background. It
copies the 27 `RenderSettings.ambientProbe` coefficients into lilToon's SH
uniforms using Unity's shader packing. Supply a profile from the matching Unity
capture and serve the model/profile from the isolated 4090 workspace.

Start it through the workspace managed server with:

```powershell
npm run example:ambient-capture:dev -- --host 0.0.0.0 --port {port}
```

Open `/examples/ambient-capture/?profile=<URL-encoded-profile-URL>`. The profile
contains `name`, `modelUrl`, `width`, `height`, `background`, `camera`,
`directional`, `sh9`, and `unity` fields. Camera and light vectors are
world-space XYZ arrays. `sh9.r`, `.g`, and `.b` each contain nine coefficient
values in `SphericalHarmonicsL2[channel, coefficient]` order. Those values are
recorded unchanged in metadata and packed into `unity_SHAr/Ag/Ab`,
`unity_SHBr/Bg/Bb`, and `unity_SHC` using Unity's `PackCoefficients` layout. The
`unity` object is also copied to metadata alongside the image.
The mapping follows [Unity's PackCoefficients implementation](https://github.com/Unity-Technologies/FPSSample/blob/master/Packages/com.unity.render-pipelines.high-definition/Runtime/Lighting/SphericalHarmonics.cs)
and the shader polynomial in the repository's vendored
`lil_common_functions.hlsl:lilShadeSH9`.

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
	"sh9": {
		"r": [0, 0, 0, 0, 0, 0, 0, 0, 0],
		"g": [0, 0, 0, 0, 0, 0, 0, 0, 0],
		"b": [0, 0, 0, 0, 0, 0, 0, 0, 0]
	},
	"unity": {
		"ambientMode": "Flat",
		"ambientLight": "#000000",
		"ambientIntensity": 1,
		"activeColorSpace": "Linear"
	}
}
```

Use the same `sh9` structure for Flat and Trilight. Do not reconstruct the
probe from sky, equator, or ground colors; the captured SH values are the input.
The Unity lighting source uses the same packed basis in
`lil_common_functions.hlsl`'s `lilShadeSH9` evaluation.

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
