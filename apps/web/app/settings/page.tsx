import { databasePath } from "@/lib/db/client";
import { GmailConnectActions } from "@/components/gmail-connect-actions";
import { GmailReadPreview } from "@/components/gmail-read-preview";
import { getGmailIntegration } from "@/lib/db/repositories";
import { hasGmailReadScope } from "@/lib/gmail/oauth";

export default function SettingsPage() {
  const gmailIntegration = getGmailIntegration();
  const gmailNeedsReconnect = Boolean(gmailIntegration) && !hasGmailReadScope(gmailIntegration?.scopes);
  const gmailConfigured = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_REDIRECT_URI
  );
  const env = {
    browserbase: Boolean(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID),
    gemini: Boolean(process.env.GOOGLE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY),
    gmail: {
      configured: gmailConfigured,
      connected: Boolean(gmailIntegration),
      needsReconnect: gmailNeedsReconnect,
      account: String(gmailIntegration?.account_email ?? gmailIntegration?.account_label ?? "")
    },
    reddit: {
      app: process.env.DEVVIT_APP_NAME ?? "reacher-usage",
      subreddit: process.env.DEVVIT_SUBREDDIT ?? "reacher_usage_dev"
    },
    database: databasePath()
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Local runtime configuration.</h1>
        </div>
      </header>
      <section className="panel wide">
        <table className="table">
          <tbody>
            <tr><th>Browserbase keys</th><td><span className={env.browserbase ? "status" : "status bad"}>{env.browserbase ? "configured" : "missing"}</span></td></tr>
            <tr><th>Gemini key</th><td><span className={env.gemini ? "status" : "status bad"}>{env.gemini ? "configured" : "missing"}</span></td></tr>
            <tr>
              <th>Gmail OAuth</th>
              <td>
                <div className="toolbar">
                  <span className={env.gmail.connected && !env.gmail.needsReconnect ? "status" : env.gmail.configured ? "status active" : "status bad"}>
                    {env.gmail.connected && env.gmail.needsReconnect ? "reconnect for read access" : env.gmail.connected ? "connected" : env.gmail.configured ? "configured" : "missing credentials"}
                  </span>
                  {env.gmail.account && <span>{env.gmail.account}</span>}
                  <GmailConnectActions configured={env.gmail.configured} connected={env.gmail.connected} needsReconnect={env.gmail.needsReconnect} />
                </div>
                <GmailReadPreview enabled={env.gmail.connected && !env.gmail.needsReconnect} />
              </td>
            </tr>
            <tr><th>Reddit Devvit app</th><td>{env.reddit.app}</td></tr>
            <tr><th>Reddit playtest subreddit</th><td>{env.reddit.subreddit}</td></tr>
            <tr><th>SQLite path</th><td>{env.database}</td></tr>
            <tr><th>Final-send automation</th><td><span className="status bad">disabled in v1</span></td></tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
