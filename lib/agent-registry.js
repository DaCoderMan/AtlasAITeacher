import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rawConfig = require('../config/atlas.json');

const RISK = ['low', 'medium', 'high'];

export function validateAgentContract(agent) {
  if (!agent || typeof agent !== 'object' || Array.isArray(agent)) throw new Error('agent contract must be an object');
  for (const field of ['id', 'name', 'mission', 'risk_ceiling']) {
    if (typeof agent[field] !== 'string' || !agent[field].trim()) throw new Error(`agent ${field} must be a non-empty string`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(agent.id)) throw new Error(`agent id must be kebab-case: ${agent.id}`);
  if (!Array.isArray(agent.capabilities) || !agent.capabilities.length || agent.capabilities.some(x => typeof x !== 'string' || !x.trim())) {
    throw new Error(`agent ${agent.id} capabilities must be a non-empty string array`);
  }
  if (!RISK.includes(agent.risk_ceiling)) throw new Error(`agent ${agent.id} has invalid risk_ceiling`);
  if (typeof agent.qa_default !== 'boolean') throw new Error(`agent ${agent.id} qa_default must be boolean`);
  return agent;
}

export function buildAgentRegistry(agents = rawConfig.agents) {
  if (!Array.isArray(agents) || !agents.length) throw new Error('Atlas agent configuration is required');
  const byId = new Map();
  const byName = new Map();
  for (const agent of agents) {
    validateAgentContract(agent);
    if (byId.has(agent.id.toLowerCase())) throw new Error(`duplicate agent id: ${agent.id}`);
    if (byName.has(agent.name.toLowerCase())) throw new Error(`duplicate agent name: ${agent.name}`);
    byId.set(agent.id.toLowerCase(), agent);
    byName.set(agent.name.toLowerCase(), agent);
  }
  return { agents: [...agents], byId, byName };
}

const registry = buildAgentRegistry();

export function listAgents() {
  return registry.agents.map(agent => ({ ...agent, capabilities: [...agent.capabilities] }));
}

export function getAgent(value) {
  if (!value) return null;
  const key = String(value).trim().toLowerCase();
  return registry.byId.get(key) || registry.byName.get(key) || null;
}

export function requireAgent(value) {
  const agent = getAgent(value);
  if (!agent) throw new Error(`unknown Atlas agent: ${value}`);
  return agent;
}

export function agentCanServeProject(agent, manifest) {
  const resolved = typeof agent === 'string' ? getAgent(agent) : agent;
  if (!resolved || !manifest) return false;
  return manifest.allowed_agents.includes(resolved.name);
}
