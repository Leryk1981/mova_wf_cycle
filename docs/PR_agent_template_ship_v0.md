### feat: agent_template_v0 (Claude Code) + ship manifest + station steps
Adds a deterministic “empty agent” template pack for the Claude Code (Anthropic-style) engine:

packs/agent_template_v0:

DS/ENV request + bundle outputs

deterministic generator emits repo-kit bundle:

mova/policy (deny-by-default), mova/registry, mova/roles, mova/pipeline

.claude/settings.json, .claude/commands/{gates,quality,station}.md, CLAUDE.md, README

ship tool emits artifacts/agent_ship/<run_id>/bundle + manifest.json with bytes+sha256 for every file

quality runner validates bundle + ship manifest; includes negative suite driver

station_cycle_v1:

policy-gated steps: quality_agent_template, ship_agent_template

vendors reports/manifests into station artifacts

scripts:

demo:agent_template

quality:agent_template

quality:agent_template:neg

ship:agent_template

Notes:

runtime artifacts dirs are ignored to keep git clean.
