/**
 * Model cache entry point: `react-ai-voice-avatar/model-cache`
 *
 * The store the engine keeps its own models in, for a model of yours. Chrome's
 * Cache API refuses any single file of 256 MiB or more, so transformers.js
 * quietly downloads a large model again on every visit. This keeps it in the
 * Origin Private File System instead, which has no such limit:
 *
 *   import { env } from '@huggingface/transformers';
 *   import { createModelCache, isModelCacheSupported } from 'react-ai-voice-avatar/model-cache';
 *
 *   if (isModelCacheSupported()) {
 *     env.useCustomCache = true;
 *     env.customCache = createModelCache();
 *   }
 *
 * A separate entry so that it can be imported inside a Web Worker. It depends
 * on nothing but the browser: no React, and none of the engine's own workers.
 */

export { createModelCache, isModelCacheSupported } from './lib/modelCache';
export type { ModelCache, ModelCacheOptions } from './lib/modelCache';
