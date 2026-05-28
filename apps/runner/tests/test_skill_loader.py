from pathlib import Path

from reacher_runner.skills.loader import SkillLoader


def test_loader_selects_global_and_platform_skills() -> None:
    root = Path(__file__).resolve().parents[1] / "skills"
    loaded = SkillLoader(root).load("research", ["web", "linkedin", "reddit"])
    paths = {item.path.name for item in loaded}
    assert "research.md" in paths
    assert "page_cues.md" in paths
    assert all(item.sha256 for item in loaded)
