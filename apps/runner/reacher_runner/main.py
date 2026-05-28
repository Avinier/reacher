from __future__ import annotations

import argparse
import time

from reacher_runner.config import load_config
from reacher_runner.db import ReacherDb
from reacher_runner.runs.executor import RunExecutor


def run_once() -> int:
    config = load_config()
    db = ReacherDb(config.database_path)
    try:
        run = db.claim_next_run()
        if run is None:
            print("No queued runs.")
            return 0
        executor = RunExecutor(config, db)
        try:
            executor.execute(run)
            print(f"Executed run {run['id']}.")
            return 0
        except Exception as error:
            db.add_step(run["id"], "plan", "Runner failed", str(error), status="failed")
            db.mark_run(run["id"], "failed", error_message=str(error))
            raise
    finally:
        db.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="Claim and execute at most one queued run.")
    args = parser.parse_args()

    if args.once:
        return run_once()

    config = load_config()
    while True:
        run_once()
        time.sleep(config.poll_interval_ms / 1000)


if __name__ == "__main__":
    raise SystemExit(main())
