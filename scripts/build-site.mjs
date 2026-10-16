#!/usr/bin/env node
// Build a clean GitHub Pages artifact using only the public-site allowlist.
import { cp, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, checkSite, collectSiteFiles } from './check-site.mjs';

const output = path.join(ROOT, '_site');
function assertBuildDirectory(target, kind) {
  const resolved = path.resolve(target);
  if (path.dirname(resolved) !== ROOT || (kind === 'output'
    ? path.basename(resolved) !== '_site'
    : !/^\.site-build-[\w-]+$/.test(path.basename(resolved)))) {
    throw new Error(`Refusing to replace a directory outside the build area: ${resolved}`);
  }
  return resolved;
}
let staging;
try {
  const source = await checkSite(ROOT);
  if (source.errors.length) throw new Error(source.errors.join('\n'));
  staging = await mkdtemp(path.join(ROOT, '.site-build-'));
  for (const file of source.files) {
    await mkdir(path.dirname(path.join(staging, file)), { recursive: true });
    await cp(path.join(ROOT, file), path.join(staging, file));
  }
  const built = await checkSite(staging);
  if (built.errors.length) throw new Error(built.errors.join('\n'));
  const copied = await collectSiteFiles(staging);
  if (JSON.stringify(copied) !== JSON.stringify(source.files)) throw new Error('Published file list changed during the build.');
  // Only this fixed child directory is replaced; the source tree is never removed.
  assertBuildDirectory(staging, 'staging');
  await rm(assertBuildDirectory(output, 'output'), { recursive: true, force: true });
  await rename(staging, output);
  staging = undefined;
  console.log(`Built ${copied.length} public files in _site/; source and artifact checks passed.`);
} catch (error) {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (staging) await rm(assertBuildDirectory(staging, 'staging'), { recursive: true, force: true });
}
