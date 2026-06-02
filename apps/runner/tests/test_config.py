import os

from reacher_runner.config import load_config


def test_config_maps_google_gemini_key(monkeypatch) -> None:
    monkeypatch.setenv("GOOGLE_GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    config = load_config()
    assert config.gemini_api_key == "test-key"
    assert os.environ["GOOGLE_API_KEY"] == "test-key"


def test_config_maps_github_token_alias(monkeypatch) -> None:
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.setenv("GH_TOKEN", "gh-test")
    config = load_config()
    assert config.github_token == "gh-test"


def test_config_maps_github_api_token_alias(monkeypatch) -> None:
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GH_TOKEN", raising=False)
    monkeypatch.setenv("GITHUB_API_TOKEN", "github-api-test")
    config = load_config()
    assert config.github_token == "github-api-test"
