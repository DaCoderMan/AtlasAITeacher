#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOTS = ['api', 'lib', 'mcp', 'scripts', 'tests'];
const EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

function extension(path) {
  const index = path.lastIndexOf('.');
  return index >= 0 ? path.slice(index) : '';
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (EXTENSIONS.has(extension(entry.name))) files.push(full);
  }
  return files;
}

const files = ROOTS.flatMap(root => walk(root)).sort();
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`\nSyntax check failed: ${relative(process.cwd(), file)}\n`);
    process.stderr.write(result.stderr || result.stdout || 'unknown syntax error\n');
  }
}

if (failed) process.exit(1);
console.log(`Syntax OK: ${files.length} JavaScript files`);
