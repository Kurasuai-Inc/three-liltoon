# Ambient comparison capture

This page renders the same simple lilToon sphere used by the Unity capture at a
fixed camera, resolution, and background. Its profile selects either the exact
Unity probe coefficients or scene lights that exercise `LilToonLightAdapter`.
Use the latter for before/after adapter captures; use the former to compare
lilToon's SH packing against Unity's `ambientProbe`.

Start it through the workspace managed server with:

```powershell
pwsh D:\AgentWorkspace\private\bin\serve.ps1 `
  -Name three-liltoon-ambient-capture `
  -Cmd node `
  -Args '"D:\path\to\project\node_modules\vite\bin\vite.js" --host 127.0.0.1 --port {port} --strictPort' `
  -Cwd D:\path\to\project
```

Open `/examples/ambient-capture/?profile=<URL-encoded-profile-URL>`. The profile
contains `name`, `subject`, `width`, `height`, `background`, `camera`,
`lighting`, optional `directional`, and `unity` fields. Camera and light vectors
are world-space XYZ arrays. `lighting.kind` is either `unity-probe`, with `sh9`
channels in `SphericalHarmonicsL2[channel, coefficient]` order, or
`three-adapter`, with linear RGB triplets for `ambient` and `hemisphere`
colors/intensities/direction. The triplets preserve Unity's linear color values
without an sRGB hex conversion.
Probe values are recorded unchanged in metadata and packed into
`unity_SHAr/Ag/Ab`, `unity_SHBr/Bg/Bb`, and `unity_SHC` using Unity's
`PackCoefficients` layout. In adapter mode, the page leaves the material's SH
uniforms under the renderer adapter's control. The `unity` object is copied to
metadata alongside the image.
The mapping follows [Unity's PackCoefficients implementation](https://github.com/Unity-Technologies/FPSSample/blob/master/Packages/com.unity.render-pipelines.high-definition/Runtime/Lighting/SphericalHarmonics.cs)
and the shader polynomial in the repository's vendored
`lil_common_functions.hlsl:lilShadeSH9`.

Example profile:

```json
{
	"name": "flat-face-direct-only",
	"subject": {
		"kind": "sphere",
		"radius": 1,
		"widthSegments": 24,
		"heightSegments": 16,
		"color": [0.5, 0.5, 0.5]
	},
	"width": 256,
	"height": 256,
	"background": "#000000",
	"camera": {
		"projection": "orthographic",
		"position": [0, 0, 5],
		"target": [0, 0, 0],
		"orthographicSize": 1.1,
		"near": 0.01,
		"far": 100
	},
	"lighting": {
		"kind": "unity-probe",
		"sh9": {
			"r": [0, 0, 0, 0, 0, 0, 0, 0, 0],
			"g": [0, 0, 0, 0, 0, 0, 0, 0, 0],
			"b": [0, 0, 0, 0, 0, 0, 0, 0, 0]
		}
	},
	"unity": {
		"ambientMode": "Flat",
		"ambientLight": "#000000",
		"ambientIntensity": 1,
		"activeColorSpace": "Linear"
	}
}
```

Use captured `sh9` values for both Flat and Trilight probe comparisons; do not
reconstruct the probe from sky, equator, or ground colors. Adapter comparison
profiles instead pass the matching Three ambient and hemisphere inputs. The
Unity lighting source uses the same packed basis in
`lil_common_functions.hlsl`'s `lilShadeSH9` evaluation.
Keep the page background black to match the Unity capture camera's solid-black
clear color; it affects whole-image pixel statistics even though it is unlit.

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
