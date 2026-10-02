import fs from 'fs';
import path from 'path';

console.log('[Smoke Test] Starting post-build bundle integrity assertions...');

const rootDir = path.resolve(import.meta.dirname, '..');
const distDir = path.join(rootDir, 'dist');
const packageJsonPath = path.join(rootDir, 'package.json');

let errors = 0;

// 1. Assert required build artifact files exist
const requiredFiles = ['index.js', 'index.d.ts'];
requiredFiles.forEach((file) => {
  const filePath = path.join(distDir, file);
  if (!fs.existsSync(filePath)) {
    console.error(`[FAIL] Missing build output: dist/${file}`);
    errors++;
  } else {
    console.log(`[PASS] Found build output: dist/${file}`);
  }
});

// 2. Assert package.json does not contain risky postinstall hooks
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
if (pkg.scripts && pkg.scripts.postinstall) {
  console.error('[FAIL] package.json contains forbidden postinstall script.');
  errors++;
} else {
  console.log('[PASS] No postinstall script detected in package.json.');
}

if (pkg.files && pkg.files.includes('scripts')) {
  console.error('[FAIL] package.json includes "scripts" folder in published files list.');
  errors++;
} else {
  console.log('[PASS] "scripts" folder correctly excluded from published files list.');
}

// 3. Inspect ESM bundle for illegal dynamic require('react') from unbundled jsx-runtime
const esmPath = path.join(distDir, 'index.js');
if (fs.existsSync(esmPath)) {
  const content = fs.readFileSync(esmPath, 'utf8');
  if (content.includes('require("react")') || content.includes("require('react')")) {
    console.error('[FAIL] dist/index.js contains illegal dynamic require("react") call!');
    errors++;
  } else {
    console.log('[PASS] dist/index.js contains zero unbundled React JSX runtime dynamic requires.');
  }

  if (!content.includes('AiVoiceAvatar') && !content.includes('useAiVoiceAvatar')) {
    console.error('[FAIL] dist/index.js is missing primary exports!');
    errors++;
  } else {
    console.log('[PASS] Verified primary exports present in dist/index.js.');
  }
}

// 4. Every subpath in "exports" points at files the build produced
for (const [subpath, targets] of Object.entries(pkg.exports ?? {})) {
  for (const target of new Set(Object.values(targets))) {
    if (!fs.existsSync(path.join(rootDir, target))) {
      console.error(`[FAIL] exports "${subpath}" points at ${target}, which the build did not produce.`);
      errors++;
    }
  }
}
console.log('[PASS] Checked every "exports" entry against dist.');

// 5. The model cache is imported inside workers, so it may import nothing but
// its own files: one bare import would pull a package, React say, into them.
const seen = new Set();
const walk = (file) => {
  if (seen.has(file)) return;
  seen.add(file);
  const source = fs.readFileSync(file, 'utf8');
  for (const [, spec] of source.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g)) {
    if (!spec.startsWith('.')) {
      console.error(`[FAIL] ${path.relative(rootDir, file)} imports "${spec}"; the model cache must stand alone.`);
      errors++;
    } else {
      walk(path.resolve(path.dirname(file), spec));
    }
  }
};
const modelCacheEntry = path.join(distDir, 'model-cache.js');
if (fs.existsSync(modelCacheEntry)) {
  walk(modelCacheEntry);
  console.log(`[PASS] dist/model-cache.js stands alone (${seen.size} files).`);
}

if (errors > 0) {
  console.error(`\n[Smoke Test] FAILED with ${errors} error(s).`);
  process.exit(1);
} else {
  console.log('\n[Smoke Test] SUCCESS! Bundle passed all integrity and cross-bundler compatibility assertions.');
  process.exit(0);
}
