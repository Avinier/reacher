import { type BrowserPlatform } from "@reacher/shared";
import { id } from "../db/client";
import { getBrowserContext, updateContext } from "../db/repositories";

const startUrls: Record<BrowserPlatform, string> = {
  linkedin: "https://www.linkedin.com/feed/",
  x: "https://x.com/home",
  reddit: "https://www.reddit.com/",
  discord: "https://discord.com/channels/@me"
};

export function validateBrowserbaseConfig() {
  const missing = ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"].filter((key) => !process.env[key]);
  return { ok: missing.length === 0, missing };
}

export async function openLoginSession(platform: BrowserPlatform) {
  const config = validateBrowserbaseConfig();
  let providerContextId = String(getBrowserContext(platform)?.provider_context_id ?? "");
  let providerSessionId = id("bbsession");
  let liveUrl = startUrls[platform];

  if (config.ok) {
    try {
      const { Browserbase } = await import("@browserbasehq/sdk");
      const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });
      if (!providerContextId) {
        const browserContext = await bb.contexts.create();
        providerContextId = browserContext.id;
      }
      const session = await bb.sessions.create({
        projectId: process.env.BROWSERBASE_PROJECT_ID!,
        browserSettings: {
          context: {
            id: providerContextId,
            persist: true
          }
        }
      });
      providerSessionId = session.id;
      liveUrl = `https://browserbase.com/sessions/${session.id}`;
    } catch (error) {
      updateContext(platform, {
        status: "error",
        lastError: error instanceof Error ? error.message : "Browserbase session creation failed"
      });
      throw error;
    }
  }

  updateContext(platform, {
    status: "needs_login",
    providerContextId,
    lastSessionId: providerSessionId,
    lastError: config.ok ? undefined : `Browserbase credentials missing: ${config.missing.join(", ")}`
  });

  return {
    providerContextId,
    providerSessionId,
    liveUrl,
    startUrl: startUrls[platform],
    configOk: config.ok,
    missing: config.missing
  };
}

export async function verifyContext(platform: BrowserPlatform) {
  const config = validateBrowserbaseConfig();
  const current = getBrowserContext(platform);
  const hasContext = Boolean(current?.provider_context_id);
  const ready = config.ok && hasContext;
  updateContext(platform, {
    status: ready ? "ready" : "error",
    accountLabel: ready ? `${platform} account` : undefined,
    lastError: ready ? undefined : `Cannot verify without ${config.ok ? "a Browserbase context" : config.missing.join(", ")}`,
    verified: ready
  });

  return {
    status: ready ? "ready" : "error",
    accountLabel: ready ? `${platform} account` : null,
    evidence: {
      url: startUrls[platform]
    },
    missing: config.missing
  };
}
