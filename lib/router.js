import { getAgent, listAgents } from './agent-registry.js';
import { getQualityGateStatus } from './quality-gate.js';

const INTENT_RULES = [
  { pattern: /\b(sale|sales|lead|prospect|offer|outreach|client|revenue|funnel)\b/i, agent: 'Workitu Growth', workflow: 'growth' },
  { pattern: /\b(build|implement|code|debug|fix|refactor|test|deploy)\b/i, agent: 'Builder', workflow: 'build' },
  { pattern: /\b(research|compare|investigate|evidence|sources|deep research)\b/i, agent: 'Researcher', workflow: 'research' },
  { pattern: /\b(prd|requirements|product spec|acceptance criteria|architecture brief)\b/i, agent: 'Product/PRD', workflow: 'product' },
  { pattern: /\b(hebrew|ivrit|עברית|translate.*hebrew)\b/i, agent: 'Magic Hebrew', workflow: 'learn' },
  { pattern: /\b(learn|teach|study|quiz|practice|mastery)\b/i, agent: 'Learning Coach', workflow: 'learn' },
  { pattern: /\b(job|career|resume|cv|application|interview|salary)\b/i, agent: 'Career', workflow: 'career' },
  { pattern: /\b(budget|finance|financial|money|cash flow|expense)\b/i, agent: 'Money', workflow: 'finance' },
  { pattern: /\b(logistics|appointment|admin|operation|workflow|organize)\b/i, agent: 'Operations', workflow: 'operations' },
  { pattern: /\b(marketing|post|content|campaign|copy|seo)\b/i, agent: 'Content & Marketing', workflow: 'marketing' },
  { pattern: /\b(server|infra|infrastructure|api|database|docker|network|oauth|security)\b/i, agent: 'Systems/Infrastructure', workflow: 'infrastructure' },
  { pattern: /\b(agent factory|agent module|module contract|agent registry)\b/i, agent: 'Agent Factory', workflow: 'agents' },
  { pattern: /\b(memory|ingest|knowledge|dedup|provenance|archive|library)\b/i, agent: 'Information Librarian', workflow: 'knowledge' },
  { pattern: /\b(review|critic|qa|verify|audit|acceptance)\b/i, agent: 'Critic/QA', workflow: 'review' }
];

const RISK_ORDER = { low: 0, medium: 1, high: 2 };

function riskWithin(agent, risk) {
  return RISK_ORDER[risk] <= RISK_ORDER[agent.risk_ceiling];
}

function requiredCapabilities(text = '') {
  const required = new Set();
  if (/\b(calendar|appointment|schedule|meeting)\b/i.test(text)) required.add('calendar');
  if (/\b(email|gmail|message|reply)\b/i.test(text)) required.add('gmail');
  if (/\b(github|repo|pull request|issue|commit)\b/i.test(text)) required.add('github');
  if (/\b(file|drive|document|pdf|artifact)\b/i.test(text)) required.add('drive');
  if (/\b(notion|wiki|knowledge base)\b/i.test(text)) required.add('notion');
  if (/\b(voice|speak|stt|tts)\b/i.test(text)) required.add('voice');
  return [...required];
}

export function routeAgent({ resolved_context, intent = '', mode = null, risk = 'low', language = null, service_health = [] } = {}) {
  if (!['low', 'medium', 'high'].includes(risk)) throw new Error(`invalid risk: ${risk}`);
  const text = String(intent || mode || '').trim();
  const manifest = resolved_context?.project || null;
  const matchedRule = INTENT_RULES.find(candidate => candidate.pattern.test(text)) || null;
  const warnings = [];

  let rule;
  if (!matchedRule) {
    rule = manifest?.active_agent
      ? { agent: manifest.active_agent, workflow: mode || 'project', origin: 'project_default' }
      : { agent: 'Atlas', workflow: mode || 'orchestrate', origin: 'global_default' };
  } else if (manifest && !manifest.allowed_agents.includes(matchedRule.agent)) {
    warnings.push({
      type: 'cross_project_specialist_request',
      requested_agent: matchedRule.agent,
      requested_workflow: matchedRule.workflow,
      active_project_id: manifest.id,
      action: 'escalated_to_atlas'
    });
    rule = { agent: 'Atlas', workflow: 'scope_escalation', origin: 'scope_guard' };
  } else {
    rule = { ...matchedRule, origin: 'intent_rule' };
  }

  let agent = getAgent(rule.agent);
  if (!agent) {
    warnings.push({ type: 'agent_not_registered', requested: rule.agent });
    agent = getAgent('Atlas');
    rule = { agent: 'Atlas', workflow: 'orchestrate', origin: 'registry_fallback' };
  }

  if (manifest && !manifest.allowed_agents.includes(agent.name)) {
    warnings.push({ type: 'agent_not_allowed_by_project', requested: agent.name, project_id: manifest.id });
    agent = getAgent('Atlas');
    rule = { agent: 'Atlas', workflow: 'scope_escalation', origin: 'scope_guard_fallback' };
  }
  if (!riskWithin(agent, risk)) {
    warnings.push({ type: 'risk_exceeds_agent_ceiling', agent: agent.name, risk, ceiling: agent.risk_ceiling });
    agent = getAgent('Atlas');
    rule = { agent: 'Atlas', workflow: 'risk_escalation', origin: 'risk_guard' };
  }

  const capabilities = requiredCapabilities(text);
  const qualityGate = getQualityGateStatus();
  const experimentalRouting = qualityGate.controls.experimental_routing;
  const healthById = new Map((service_health || []).map(item => [item.service_id, item]));
  for (const capability of capabilities) {
    const state = healthById.get(capability);
    if (!state) warnings.push({ type: 'capability_health_unverified', capability });
    else if (state.health !== 'healthy') warnings.push({ type: 'capability_degraded', capability, health: state.health, failure_summary: state.failure_summary || null });
  }

  const qa_required = Boolean(manifest?.qa_required || agent.qa_default || ['medium', 'high'].includes(risk) || matchedRule?.workflow === 'build');
  if (experimentalRouting.requested && !experimentalRouting.enabled) {
    warnings.push({
      type: 'experimental_routing_blocked',
      reason: experimentalRouting.reason,
      missing_requirements: experimentalRouting.missing_requirements || []
    });
  }
  return {
    selected_agents: [agent.name],
    selected_agent_ids: [agent.id],
    workflow_type: rule.workflow,
    required_capabilities: capabilities,
    qa_required,
    language: language || null,
    risk,
    rationale: {
      rule: rule.origin,
      matched_specialist: matchedRule?.agent || null,
      project_id: manifest?.id || null,
      project_scope_applied: Boolean(manifest),
      routing_mode: experimentalRouting.enabled ? experimentalRouting.mode : 'baseline'
    },
    warnings,
    routing_controls: {
      mode: experimentalRouting.enabled ? experimentalRouting.mode : 'baseline',
      experiment: experimentalRouting
    }
  };
}

export function routerCatalog() {
  return { agents: listAgents(), rules: INTENT_RULES.map(rule => ({ agent: rule.agent, workflow: rule.workflow })) };
}
