from __future__ import annotations

from pathlib import Path

from reacher_runner.db import ReacherDb
from reacher_runner.skills.loader import SkillLoader


class OutreachPrepareAgent:
    def __init__(self, db: ReacherDb, skills_root: Path):
        self.db = db
        self.skills = SkillLoader(skills_root)

    def run(self, run) -> None:
        settings = self.db.settings(run)
        platforms = settings.get("platforms", ["linkedin"])
        loaded = self.skills.load("outreach_prepare", platforms)
        self.db.add_step(run["id"], "plan", "Loaded outreach preparation skills", f"{len(loaded)} skill files selected.")
        self.db.add_step(run["id"], "operator_wait", "Final send disabled", "The v1 runner records preparation and waits for the operator before any final send.")
        self.db.save_outreach_fixture(run)
