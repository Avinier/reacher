import os

from reacher_runner.config import load_config


def test_config_maps_google_gemini_key(monkeypatch) -> None:
    monkeypatch.setenv("GOOGLE_GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    config = load_config()
    assert config.gemini_api_key == "test-key"
    assert os.environ["GOOGLE_API_KEY"] == "test-key"
