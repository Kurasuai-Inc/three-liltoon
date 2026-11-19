/**
 * Cooperative scheduling shared by the loader and renderer preparation paths.
 * Long synchronous construction (property bags, shader-source parsing, pass
 * recipes) is split at material or mesh boundaries so a load does not produce
 * a single multi-hundred-millisecond task.
 */
export interface LilToonTaskPacing {
	/**
	 * Milliseconds of uninterrupted work allowed between task-queue yields.
	 * Default 10.
	 */
	readonly budgetMs?: number;
	/**
	 * Returns control to the task queue. Defaults to a zero-delay timer so
	 * hidden pages still yield even when requestAnimationFrame does not run.
	 */
	readonly yieldControl?: () => Promise<void>;
}

const defaultYieldControl = () =>
	new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Returns a pace function that resolves immediately while cumulative work stays
 * under the budget and awaits the task queue once the budget is exceeded.
 * State is shared per instance so consecutive units spread across tasks.
 */
export function createTaskPace(
	pacing: LilToonTaskPacing = {},
): () => Promise<void> {
	const yieldControl = pacing.yieldControl ?? defaultYieldControl;
	const budgetMs = pacing.budgetMs ?? 10;
	let resumedAt = performance.now();
	return async () => {
		if (performance.now() - resumedAt < budgetMs) return;
		await yieldControl();
		resumedAt = performance.now();
	};
}
