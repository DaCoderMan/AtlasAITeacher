#!/usr/bin/env node
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const repoRoot = resolve(appRoot, '..', '..');
const runtimeRoot = resolve(appRoot, 'runtime');

rmSync(runtimeRoot, { recursive: true, force: true });
mkdirSync(runtimeRoot, { recursive: true });

for (const relative of ['api/mcp.js', 'api/oauth-protected-resource.js', 'lib', 'mcp', 'config/atlas.json']) {
  cpSync(resolve(repoRoot, relative), resolve(runtimeRoot, relative), { recursive: true });
}

console.log(`Prepared atlas-mcp runtime from ${repoRoot}`);
