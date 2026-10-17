/**
 * The onnxruntime-web release this package is built and tested against.
 *
 * The runtime's JavaScript and its .wasm files must come from the same
 * release, or it fails to start. The workers bundle this release's
 * JavaScript, and the voice detector uses whichever copy is installed, which
 * the exact version in package.json keeps to this one. Every default for
 * where the .wasm files load from is derived from here, so the two cannot
 * drift apart again; they were once written out in six places.
 */
export const ONNX_RUNTIME_VERSION = '1.29.0';

/** Where the .wasm files load from unless `onnxWasmPath` says otherwise. */
export const DEFAULT_ONNX_WASM_PATH = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_RUNTIME_VERSION}/dist/`;
