import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rawConfig = require('../config/atlas.json');

const REQUIRED_FIELDS = [
  'id', 'slug', 'name', 'mission', 'success_criteria', 'lifecycle', 'owner',
  'active_agent', 'allowed_agents', 'memory_namespace', 'authoritative_sources',
  'do_not_do', 'autonomy', 'qa_required'
];

function assertString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`manifest ${field} must be a non-empty string`);
}

function assertStringArray(value, field, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some(x => typeof x !== 'string' || !x.trim())) {
    throw new Error(`manifest ${field} must be an array of non-empty strings`);
  }
}

export function validateManifest(manifest, { lifecycle = rawConfig.lifecycle } = {}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('manifest must be an object');
  for (const field of REQUIRED_FIELDS) {
    if (!(field in manifest)) throw new Error(`manifest missing required field: ${field}`);
  }
  for (const field of ['id', 'slug', 'name', 'mission', 'lifecycle', 'owner', 'active_agent', 'memory_namespace', 'autonomy']) {
    assertString(manifest[field], field);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)) throw new Error(`manifest id must be kebab-case: ${manifest.id}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.slug)) throw new Error(`manifest slug must be kebab-case: ${manifest.slug}`);
  if (!lifecycle.includes(manifest.lifecycle)) throw new Error(`invalid lifecycle: ${manifest.lifecycle}`);
  assertStringArray(manifest.success_criteria, 'success_criteria', { allowEmpty: false });
  assertStringArray(manifest.allowed_agents, 'allowed_agents', { allowEmpty: false });
  assertStringArray(manifest.authoritative_sources, 'authoritative_sources', { allowEmpty: false });
  assertStringArray(manifest.do_not_do, 'do_not_do');
  if (manifest.related_assets !== undefined) assertStringArray(manifest.related_assets, 'related_assets');
  if (typeof manifest.qa_required !== 'boolean') throw new Error('manifest qa_required must be boolean');
  if (!manifest.allowed_agents.includes(manifest.active_agent)) {
    throw new Error(`active_agent ${manifest.active_agent} is not allowed by project ${manifest.id}`);
  }
  return manifest;
}

export function buildManifestRegistry(config = rawConfig) {
  if (!Array.isArray(config?.lifecycle) || !config.lifecycle.length) throw new Error('Atlas lifecycle configuration is required');
  if (!Array.isArray(config?.manifests) || !config.manifests.length) throw new Error('Atlas manifest configuration is required');
  const byId = new Map();
  const bySlug = new Map();
  const byName = new Map();
  for (const manifest of config.manifests) {
    validateManifest(manifest, { lifecycle: config.lifecycle });
    const id = manifest.id.toLowerCase();
    const slug = manifest.slug.toLowerCase();
    const name = manifest.name.toLowerCase();
    if (byId.has(id)) throw new Error(`duplicate manifest id: ${manifest.id}`);
    if (bySlug.has(slug)) throw new Error(`duplicate manifest slug: ${manifest.slug}`);
    if (byName.has(name)) throw new Error(`duplicate manifest name: ${manifest.name}`);
    byId.set(id, manifest);
    bySlug.set(slug, manifest);
    byName.set(name, manifest);
  }
  return { byId, bySlug, byName, manifests: [...config.manifests] };
}

const registry = buildManifestRegistry();

export function listProjectManifests() {
  return registry.manifests.map(manifest => ({ ...manifest }));
}

export function getProjectManifest(value) {
  if (!value) return null;
  const key = String(value).trim().toLowerCase();
  return registry.byId.get(key) || registry.bySlug.get(key) || registry.byName.get(key) || null;
}

export function requireProjectManifest(value) {
  const manifest = getProjectManifest(value);
  if (!manifest) throw new Error(`unknown Atlas project: ${value}`);
  return manifest;
}

export function atlasAuthorityRules() {
  return { ...rawConfig.authority };
}

export function atlasLifecycle() {
  return [...rawConfig.lifecycle];
}
