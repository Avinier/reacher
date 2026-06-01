from __future__ import annotations

from pathlib import Path

from reacher_runner.agents.outreach_prepare_agent import OutreachPrepareAgent
from reacher_runner.agents.research_agent import ResearchAgent
from reacher_runner.browserbase.driver import BrowserbaseDriver
from reacher_runner.config import Config
from reacher_runner.db import ReacherDb


class RunExecutor:
    def __init__(self, config: Config, db: ReacherDb):
        self.config = config
        self.db = db
        self.skills_root = Path(__file__).resolve().parents[2] / "skills"
        self.driver = BrowserbaseDriver(config)

    def execute(self, run) -> None:
        self.db.mark_run(run["id"], "running")
        self.db.add_step(run["id"], "plan", "Runner claimed run", "Local Python runner is executing this job.")

        smoke = self.driver.smoke_test()
        self.db.add_step(run["id"], "browser_session", "Browserbase smoke check", str(smoke["reason"]), output_json=smoke)

        if run["kind"] == "research":
            ResearchAgent(self.db, self.config.data_dir, self.skills_root, self.config).run(run)
            health = self._research_health(run["id"])
            if health["targets"] == 0 and health["failed_steps"] > 0:
                self.db.mark_run(
                    run["id"],
                    "failed",
                    result_summary="Research finished with no targets because one or more discovery paths failed.",
                    error_message="No targets were saved; inspect failed timeline steps for provider errors.",
                )
                return
            self.db.mark_run(run["id"], "completed", result_summary="Research completed with saved filters, targets, evidence, drafts, and exports.")
            return

        if run["kind"] == "outreach_prepare":
            OutreachPrepareAgent(self.db, self.skills_root).run(run)
            self.db.mark_run(run["id"], "waiting_for_operator", result_summary="Outreach preparation recorded and stopped before final send.")
            return

        if run["kind"] == "reddit_write":
            self.db.add_step(run["id"], "operator_wait", "Reddit write action requires operator execution", "Use the Reddit page and Devvit playtest app to execute approved post, comment, or private-message actions.")
            self.db.mark_run(run["id"], "waiting_for_operator", result_summary="Reddit write action is queued for explicit operator execution.")
            return

        if run["kind"] == "export":
            ResearchAgent(self.db, self.config.data_dir, self.skills_root, self.config).write_exports(run["id"])
            self.db.mark_run(run["id"], "completed", result_summary="Exports regenerated.")
            return

        if run["kind"] == "context_verify":
            self.db.add_step(run["id"], "observe", "Context verification queued", "Use the web context UI for Browserbase login and verification.")
            self.db.mark_run(run["id"], "completed", result_summary="Context verification run completed.")
            return

        raise ValueError(f"Unsupported run kind: {run['kind']}")

    def _research_health(self, run_id: str) -> dict[str, int]:
        row = self.db.conn.execute(
            """
            SELECT
                (SELECT COUNT(*) FROM targets WHERE run_id = ?) AS targets,
                (SELECT COUNT(*) FROM run_steps WHERE run_id = ? AND status = 'failed') AS failed_steps
            """,
            (run_id, run_id),
        ).fetchone()
        return {"targets": int(row["targets"] if row else 0), "failed_steps": int(row["failed_steps"] if row else 0)}
