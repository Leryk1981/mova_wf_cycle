#!/usr/bin/env node
/**
 * Local Shell Driver v0
 *
 * Offline-safe executor driver that runs shell commands directly on the host.
 * Implements EXECUTOR_DRIVER_CONTRACT_v0 for simple probes and diagnostics.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

class LocalShellDriver {
  constructor({ defaultShell } = {}) {
    this.defaultShell = defaultShell || (process.platform === "win32" ? "powershell.exe" : "/bin/bash");
  }

  async runTool(request = {}, options = {}) {
    const { request_id, tool_id, args = {}, ctx = {} } = request;
    if (tool_id !== "shell") {
      throw new Error(`local_shell_v0 only supports tool_id="shell" (received "${tool_id}")`);
    }
    const command = typeof args.command === "string" ? args.command : null;
    if (!command) {
      throw new Error("local_shell_v0 requires args.command (string)");
    }
    const timeoutMs =
      typeof args.timeout_ms === "number" && Number.isFinite(args.timeout_ms) ? Math.max(args.timeout_ms, 0) : undefined;
    const shell = args.shell || this.defaultShell;

    const spawnOptions = {
      shell: true,
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true
    };
    if (shell && shell !== true) {
      spawnOptions.shell = shell;
    }

    const startedAt = performance.now();
    const result = spawnSync(command, spawnOptions);
    const durationMs = Math.round(performance.now() - startedAt);

    if (result.error) {
      throw new Error(`local_shell_v0 failed: ${result.error.message}`);
    }

    const exitCode = typeof result.status === "number" ? result.status : 0;
    const stdout = result.stdout || "";
    const stderr = result.stderr || "";

    const toolResult = {
      request_id: request_id || null,
      command,
      exit_code: exitCode,
      stdout,
      stderr,
      duration_ms: durationMs
    };

    const logsDir = options.logsDir;
    const localEvidencePaths = [];
    if (logsDir) {
      fs.mkdirSync(logsDir, { recursive: true });
      const repoRoot = process.cwd();
      const files = [
        { name: "command.txt", content: `${command}\n` },
        { name: "stdout.log", content: stdout },
        { name: "stderr.log", content: stderr }
      ];
      for (const file of files) {
        const outPath = path.join(logsDir, file.name);
        fs.writeFileSync(outPath, file.content, "utf8");
        const rel = path.relative(repoRoot, outPath).replace(/\\/g, "/");
        if (!rel.startsWith("..")) {
          localEvidencePaths.push(rel);
        }
      }
    }

    return {
      ok: exitCode === 0,
      tool_result: toolResult,
      policy_check: {
        decision: "allow",
        reason: "local_shell_v0 offline execution",
        rule_id: "local_shell_v0_allow"
      },
      evidence_refs: ["local_shell_v0:stdout"],
      local_evidence_paths: localEvidencePaths,
      engine_ref: "local_shell_v0@localhost",
      run_id: ctx.run_id || null,
      step_id: ctx.step_id || null
    };
  }
}

export function createDriver(options = {}) {
  return new LocalShellDriver(options);
}

export { LocalShellDriver };
