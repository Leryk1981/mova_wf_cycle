# Agent Runner v0

Lightweight runner that drives a bundled MOVA agent via the Control MCP (stdio) transport.

- gent_runner_execute_v0.mjs: validates runner requests, spawns the MCP server, pings / executes MOVA tools, and writes artifacts into rtifacts/agent_runner.
- demo_agent_runner_v0.mjs: ships the agent_template bundle, then exercises the runner in the plan and xecute stages while reporting artifact paths.
- quality_agent_runner_v0.mjs: runs the demo, inspects the generated artifacts, and writes a quality report.

Examples live under docs/examples.
