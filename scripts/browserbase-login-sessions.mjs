#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env");

const platforms = {
  linkedin: {
    contextEnv: "LINKEDIN_BROWSERBASE_CONTEXT_ID",
    loginUrl: "https://www.linkedin.com/feed/",
  },
  x: {
    contextEnv: "X_BROWSERBASE_CONTEXT_ID",
    loginUrl: "https://x.com/home",
  },
  reddit: {
    contextEnv: "REDDIT_BROWSERBASE_CONTEXT_ID",
    loginUrl: "https://www.reddit.com/",
  },
  discord: {
    contextEnv: "DISCORD_BROWSERBASE_CONTEXT_ID",
    loginUrl: "https://discord.com/channels/@me",
  },
};

function parseEnv(raw) {
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return env;
}

function upsertEnv(raw, key, value) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}=.*$`, "m");
  if (pattern.test(raw)) return raw.replace(pattern, `${key}=${value}`);
  const needsNewline = raw.endsWith("\n") ? "" : "\n";
  return `${raw}${needsNewline}${key}=${value}\n`;
}

async function browserbase(path, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.browserbase.com/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-BB-API-Key": requiredEnv.BROWSERBASE_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(
      `Browserbase ${method} ${path} failed (${res.status}): ${JSON.stringify(data)}`,
    );
  }

  return data;
}

function selectedPlatforms() {
  const args = process.argv.slice(2);
  const open = args.includes("--open");
  const names = args.filter((arg) => arg !== "--open");
  const selected = names.length ? names : Object.keys(platforms);

  for (const name of selected) {
    if (!platforms[name]) {
      throw new Error(`Unknown platform "${name}". Use: ${Object.keys(platforms).join(", ")}`);
    }
  }

  return { selected, open };
}

let rawEnv = readFileSync(envPath, "utf8");
let parsedEnv = parseEnv(rawEnv);
const requiredEnv = {
  BROWSERBASE_API_KEY: parsedEnv.BROWSERBASE_API_KEY,
  BROWSERBASE_PROJECT_ID: parsedEnv.BROWSERBASE_PROJECT_ID,
};

for (const [key, value] of Object.entries(requiredEnv)) {
  if (!value) throw new Error(`Missing ${key} in ${envPath}`);
}

const { selected, open } = selectedPlatforms();
const results = [];

for (const platformName of selected) {
  const platform = platforms[platformName];
  let contextId = parsedEnv[platform.contextEnv];

  if (!contextId) {
    const context = await browserbase("/contexts", {
      method: "POST",
      body: { projectId: requiredEnv.BROWSERBASE_PROJECT_ID },
    });
    contextId = context.id;
    rawEnv = upsertEnv(rawEnv, platform.contextEnv, contextId);
    parsedEnv = parseEnv(rawEnv);
    writeFileSync(envPath, rawEnv);
  }

  const session = await browserbase("/sessions", {
    method: "POST",
    body: {
      projectId: requiredEnv.BROWSERBASE_PROJECT_ID,
      browserSettings: {
        context: {
          id: contextId,
          persist: true,
        },
        viewport: {
          width: 1440,
          height: 1000,
        },
      },
      timeout: 21600,
      keepAlive: true,
      userMetadata: {
        app: "reacher",
        platform: platformName,
        purpose: "manual-login",
      },
    },
  });

  const debug = await browserbase(`/sessions/${session.id}/debug`);
  const liveUrl = debug.debuggerFullscreenUrl || debug.debuggerUrl;

  results.push({
    platform: platformName,
    contextEnv: platform.contextEnv,
    contextId,
    sessionId: session.id,
    liveUrl,
    loginUrl: platform.loginUrl,
  });

  if (open && liveUrl) {
    execFileSync("open", [liveUrl]);
  }

  console.log(JSON.stringify(results.at(-1), null, 2));
}

if (results.length > 1) {
  console.log("");
  console.log("All sessions:");
  console.log(JSON.stringify(results, null, 2));
}
console.log("");
console.log("Next steps:");
console.log("1. Open each liveUrl.");
console.log("2. Navigate to the matching loginUrl if it is not already open.");
console.log("3. Log in manually and complete 2FA if prompted.");
console.log("4. Close/end the Browserbase session after login so context persistence syncs.");
console.log("5. Wait a few seconds before reusing the same context.");
