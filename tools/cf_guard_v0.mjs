#!/usr/bin/env node

import { spawn } from "node:child_process";

function main() {
  const args = process.argv.slice(2);
  const separator = args.indexOf("--");
  const commandArgs = separator === -1 ? args : args.slice(separator + 1);

  if (process.env.CF_ENABLE !== "1") {
    console.log("SKIP: CF_ENABLE not set");
    process.exit(0);
  }

  if (commandArgs.length === 0) {
    console.error("[cf_guard_v0] ERROR: missing command to run");
    process.exit(1);
  }

  const child = spawn(commandArgs[0], commandArgs.slice(1), {
    stdio: "inherit",
    shell: true
  });

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    console.error("[cf_guard_v0] failed to start command:", error.message);
    process.exit(1);
  });
}

main();
