import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

function ensureEvidenceDir(outDir) {
  const evidenceDir = join(outDir, "evidence");
  mkdirSync(evidenceDir, { recursive: true });
  return evidenceDir;
}

function runCurl(commandArgs) {
  return new Promise((resolve) => {
    const child = spawn("curl", commandArgs, { shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      resolve({ code: 1, stdout, stderr: stderr + err.message });
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function buildMessageText(offer) {
  const pieces = [
    `FlashSlot: ${offer?.service_type ?? "unknown service"}`,
    offer?.starts_at ? `Starts: ${offer.starts_at}` : null,
    offer?.location_id ? `Location: ${offer.location_id}` : null,
    offer?.price ? `Price: ${offer.price} ${offer?.currency ?? ""}` : null,
    offer?.notes ? `Notes: ${offer.notes}` : null
  ].filter(Boolean);
  return pieces.join(" | ");
}

export default async function runTelegramShellDriver({
  offer,
  outDir,
  channel_config: channelConfig = {},
  dry_run: dryRun = false
}) {
  if (!outDir) {
    throw new Error("telegram_shell driver requires outDir");
  }
  const token = process.env.FLASH_TELEGRAM_BOT_TOKEN || channelConfig.token;
  const chatId = process.env.FLASH_TELEGRAM_CHAT_ID || channelConfig.chat_id;
  if (!token || !chatId) {
    throw new Error("telegram_shell driver requires FLASH_TELEGRAM_BOT_TOKEN and FLASH_TELEGRAM_CHAT_ID");
  }
  const evidenceDir = ensureEvidenceDir(outDir);
  const requestPayload = {
    driver: "telegram_shell",
    dry_run: Boolean(dryRun),
    chat_id: chatId,
    text: buildMessageText(offer)
  };
  const requestPath = join(evidenceDir, "telegram_request.json");
  writeFileSync(requestPath, JSON.stringify(requestPayload, null, 2), "utf8");
  const stdoutPath = join(evidenceDir, "telegram_stdout.log");
  const stderrPath = join(evidenceDir, "telegram_stderr.log");
  const responsePath = join(evidenceDir, "telegram_response.json");

  if (dryRun) {
    const response = { ok: true, dry_run: true };
    writeFileSync(stdoutPath, "", "utf8");
    writeFileSync(stderrPath, "", "utf8");
    writeFileSync(responsePath, JSON.stringify(response, null, 2), "utf8");
    return {
      ok: true,
      sent: 0,
      failed: 0,
      evidence_paths: [requestPath, responsePath, stdoutPath, stderrPath],
      driver: "telegram_shell",
      dry_run: true
    };
  }

  const endpoint = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text: requestPayload.text });
  const curlArgs = ["-sS", "-X", "POST", endpoint, "-H", "Content-Type: application/json", "-d", body];
  const { code, stdout, stderr } = await runCurl(curlArgs);
  writeFileSync(stdoutPath, stdout, "utf8");
  writeFileSync(stderrPath, stderr, "utf8");
  let responseJSON = null;
  try {
    responseJSON = stdout ? JSON.parse(stdout) : null;
  } catch (err) {
    responseJSON = { parse_error: err.message };
  }
  writeFileSync(
    responsePath,
    JSON.stringify({ ok: code === 0, raw: responseJSON, stdoutLength: stdout.length }, null, 2),
    "utf8"
  );
  const ok = code === 0 && responseJSON?.ok !== false;
  return {
    ok,
    sent: ok ? 1 : 0,
    failed: ok ? 0 : 1,
    evidence_paths: [requestPath, responsePath, stdoutPath, stderrPath],
    driver: "telegram_shell",
    dry_run: false,
    raw_response: responseJSON
  };
}
