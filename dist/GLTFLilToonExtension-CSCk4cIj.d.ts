import { Material } from 'three';
import { GLTFLoaderPlugin, GLTFParser, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

type LilToonWarningCode = "unsupported-feature" | "unused-texture" | "texture-type-mismatch" | "spec-version-mismatch" | "unsupported-shader-variant";
/** Serializable, non-fatal compatibility diagnostic. */
interface LilToonWarning {
    severity: "warning";
    code: LilToonWarningCode;
    materialName: string;
    materialIndex?: number;
    shaderKey: string;
    property: string;
    message: string;
}

/**
 * Cooperative scheduling shared by the loader and renderer preparation paths.
 * Long synchronous construction (property bags, shader-source parsing, pass
 * recipes) is split at material or mesh boundaries so a load does not produce
 * a single multi-hundred-millisecond task.
 */
interface LilToonTaskPacing {
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

interface GLTFLilToonExtensionOptions {
    /** Non-fatal compatibility warnings. Omit to log them to the console. */
    onWarning?: (warning: LilToonWarning) => void;
    /** Optional strict format bridge for per-use sampling metadata. */
    getTextureColorSpace?: (materialIndex: number, property: string, textureIndex?: number) => "srgb" | "linear" | undefined;
    /**
     * Splits per-material property/shader preparation across task-queue turns
     * so loading a model does not block the main thread in one long task.
     */
    pacing?: LilToonTaskPacing;
}
declare class GLTFLilToonExtension implements GLTFLoaderPlugin {
    #private;
    readonly parser: GLTFParser;
    readonly options: GLTFLilToonExtensionOptions;
    readonly name = "MOCHIYA_materials_liltoon";
    constructor(parser: GLTFParser, options?: GLTFLilToonExtensionOptions);
    loadMaterial(materialIndex: number): Promise<Material> | null;
    afterRoot(result: GLTF): Promise<void>;
}

export { type GLTFLilToonExtensionOptions as G, type LilToonTaskPacing as L, GLTFLilToonExtension as a, type LilToonWarning as b, type LilToonWarningCode as c };
