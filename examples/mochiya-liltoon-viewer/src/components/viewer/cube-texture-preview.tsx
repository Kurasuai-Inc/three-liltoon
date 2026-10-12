import { useEffect, useMemo, useRef, useState } from "react";
import type { CubeTexture } from "three";
import { CUBE_FACES, cubeFace, cubeFacePixels } from "@/lib/model/cube-preview";
import type { Labels } from "@/lib/i18n";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

function FacePreview({
	cube,
	level,
	face,
	exposure,
	t,
}: {
	cube: CubeTexture;
	level: number;
	face: number;
	exposure: number;
	t: Labels;
}) {
	const ref = useRef<HTMLCanvasElement>(null);
	const pixels = useMemo(
		() => cubeFacePixels(cube, level, face, exposure),
		[cube, level, face, exposure],
	);
	useEffect(() => {
		if (pixels)
			ref.current
				?.getContext("2d")
				?.putImageData(
					new ImageData(pixels.data, pixels.width, pixels.height),
					0,
					0,
				);
	}, [pixels]);
	return (
		<figure className="min-w-0 space-y-1">
			{pixels ? (
				<canvas
					ref={ref}
					width={pixels.width}
					height={pixels.height}
					role="img"
					aria-label={`${CUBE_FACES[face]} ${t.texturePreview}`}
					className="aspect-square w-full rounded-md border bg-muted [image-rendering:pixelated]"
				/>
			) : (
				<div className="grid aspect-square place-items-center rounded-md border bg-muted p-2 text-center text-muted-foreground">
					{t.previewUnavailable}
				</div>
			)}
			<figcaption className="text-center font-mono">
				{CUBE_FACES[face]}
			</figcaption>
		</figure>
	);
}

export function CubeTexturePreview({
	cube,
	t,
}: {
	cube: CubeTexture;
	t: Labels;
}) {
	const [level, setLevel] = useState(0);
	const [exposure, setExposure] = useState(0);
	const size = cubeFace(cube, level, 0);
	return (
		<section
			aria-label={t.cubeFaces}
			className="col-span-2 space-y-3 text-[0.6875rem]"
		>
			<div className="flex items-center justify-between gap-2">
				<span>
					{t.cubeFaces} · {size ? `${size.width} × ${size.height}` : t.unknown}
				</span>
				<Select
					value={String(level)}
					onValueChange={(v) => setLevel(Number(v))}
				>
					<SelectTrigger aria-label={t.mipLevel} className="w-auto">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{Array.from({ length: cube.mipmaps.length + 1 }, (_, i) => (
							<SelectItem key={i} value={String(i)}>
								{t.mipLevel} {i}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="grid grid-cols-3 gap-2">
				{CUBE_FACES.map((label, face) => (
					<FacePreview
						key={label}
						cube={cube}
						level={level}
						face={face}
						exposure={exposure}
						t={t}
					/>
				))}
			</div>
			<label className="flex flex-wrap items-center gap-2">
				<span>
					{t.previewExposure} · {exposure > 0 ? "+" : ""}
					{exposure} EV
				</span>
				<input
					type="range"
					min={-8}
					max={8}
					step={0.5}
					value={exposure}
					onChange={(e) => setExposure(Number(e.target.value))}
					className="min-w-0 flex-1 accent-primary"
				/>
			</label>
			<p className="text-muted-foreground">{t.cubePreviewHint}</p>
		</section>
	);
}
