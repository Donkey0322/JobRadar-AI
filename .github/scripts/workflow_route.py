"""Routing decisions shared by the job workflows.

The functions are the behavior tests import. The CLI prints GitHub Actions
outputs for the workflows.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

LA = ZoneInfo("America/Los_Angeles")

SCAN_CRONS = (
    "10 7-23 * * 1",
    "10 8-23 * * 2-5",
    "10 0-7 * * 2-6",
)
SYNC_CRONS = (
    "*/20 14-23 * * *",
    "*/20 0-7 * * *",
)

# Commits that already call Publish Jobs. A later push of the same commit must
# not board or notify a second time. The checkpoint prefix is included because
# its message also contains [skip ci], which suppresses push workflows; Batch
# publishes that commit itself.
PIPELINE_PREFIXES = (
    "chore(discovery):",
    "chore(community):",
    "chore(batch): collect",
    "chore(batch): checkpoint",
    "data: add job from issue",
)

# GitHub skips push and pull_request workflows when any commit in the push
# contains one of these markers. https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs
SKIP_MARKERS = ("[skip ci]", "[ci skip]", "[no ci]", "[skip actions]", "[actions skip]")
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
# Push workflows read the webhook payload. Its commits array holds at most 2048
# commits. The Events API timeline caps a different PushEvent list at 20.
WEBHOOK_PUSH_COMMIT_CAP = 2048

BOARD_FILES = (
    "config.json",
    "data/opportunities.ndjson",
    "scripts/readme.ts",
)

MAINTENANCE = {
    "clean": {
        "argv": ["pnpm", "jobctl", "job", "clean"],
        "paths": ["data"],
        "message": "chore(clean-outdated-url): clean outdated url",
    },
    "dedup": {
        "argv": ["pnpm", "jobctl", "job", "dedup"],
        "paths": ["data"],
        "message": "chore(maintenance): dedup jobs",
    },
    "company refresh": {
        "argv": ["pnpm", "jobctl", "company", "refresh"],
        "paths": ["data"],
        "message": "chore(maintenance): refresh companies",
    },
    "board refresh": {
        "argv": ["pnpm", "jobctl", "board", "refresh"],
        "paths": ["README.md", "job-postings", "assets/featured-badges"],
        "message": "docs: update generated job boards",
    },
}


def jobs_gate(event_name: str, task: str, schedule: str, now: datetime) -> dict[str, str]:
    local = now.astimezone(LA)

    if event_name == "workflow_dispatch":
        if task not in {"scan", "sync"}:
            raise ValueError(f"unknown jobs task {task}")
        return {
            "should_run": "true",
            "task": task,
            "lookback_days": "2" if task == "scan" else "",
            "message": "",
        }

    if event_name != "schedule":
        raise ValueError(f"unknown jobs event {event_name}")

    if schedule in SCAN_CRONS:
        return scan_window(local)
    if schedule in SYNC_CRONS:
        return sync_window(local)
    raise ValueError(f"unknown jobs schedule {schedule}")


def scan_window(local: datetime) -> dict[str, str]:
    weekday = local.isoweekday()
    if weekday > 5:
        return {
            "should_run": "false",
            "task": "scan",
            "lookback_days": "",
            "message": "Skipping ATS discovery on the California weekend.",
        }

    lookback = "3" if weekday == 1 and local.hour == 0 else "2"
    message = "Using a 3-day lookback for the Monday weekend catch-up." if lookback == "3" else ""
    return {"should_run": "true", "task": "scan", "lookback_days": lookback, "message": message}


def sync_window(local: datetime) -> dict[str, str]:
    if 7 <= local.hour <= 23:
        return {"should_run": "true", "task": "sync", "lookback_days": "", "message": ""}
    return {
        "should_run": "false",
        "task": "sync",
        "lookback_days": "",
        "message": "Skipping community sync outside 07:00-23:40 California time.",
    }


def skips_push(message: str) -> bool:
    return any(marker in message for marker in SKIP_MARKERS)


def batch_should_start(event_name: str, commit_message: str) -> bool:
    if event_name != "push":
        return True
    if skips_push(commit_message):
        return False
    if first_line(commit_message).startswith("chore(batch): collect"):
        return False
    return True


def batch_due(event_name: str, queue: str | None, inflight: str | None) -> bool:
    if event_name == "workflow_dispatch":
        return True
    if queue and any(line.strip() for line in queue.splitlines()):
        return True
    if not inflight:
        return False
    payload = json.loads(inflight)
    return isinstance(payload, list) and len(payload) > 0


def is_pipeline_commit(message: str) -> bool:
    first = first_line(message)
    return any(first.startswith(prefix) for prefix in PIPELINE_PREFIXES)


def is_board_file(path: str) -> bool:
    if path in BOARD_FILES:
        return True
    if not path.startswith("data/archive/"):
        return False
    name = path.removeprefix("data/archive/")
    return "/" not in name and name.startswith("opportunities-") and name.endswith(".ndjson")


def classify_files(files: list[str]) -> dict[str, bool]:
    board = any(is_board_file(path) for path in files)
    notify = "data/jobs.ndjson" in files
    return {"board": board, "notify": notify, "run": board or notify}


def route_push(message: str, files: list[str], messages: list[str] | None = None) -> dict[str, bool]:
    subjects = messages if messages is not None else [message]
    subjects = [subject for subject in subjects if subject]
    if subjects and all(is_pipeline_commit(subject) or skips_push(subject) for subject in subjects):
        return {"run": False, "board": False, "notify": False}
    return classify_files(files)


def is_zero_sha(value: str) -> bool:
    return bool(value) and set(value) == {"0"}


def resolve_push_bounds(
    before: str, after: str, oldest_parents: list[str] | None, commit_ids: list[str]
) -> dict[str, str]:
    """Return the notify range for one push.

    An existing branch uses before and after. Those two SHAs cover the whole
    push, including one whose webhook commit list was truncated. A new branch
    has an all-zero before. A list shorter than the webhook cap is complete:
    it starts at the parent of the oldest commit, or the empty tree for a root
    commit. A list that reached the cap may be truncated, so it is not used.
    An empty list added no commits.
    """

    parents = oldest_parents or []
    if before and not is_zero_sha(before):
        return {"status": "range", "from": before, "to": after, "reason": ""}
    if len(commit_ids) >= WEBHOOK_PUSH_COMMIT_CAP:
        return {
            "status": "incomplete",
            "from": "",
            "to": after,
            "reason": (
                "This push created a ref, so before is zero. "
                f"github.event.commits has {len(commit_ids)} entries, the webhook maximum of "
                f"{WEBHOOK_PUSH_COMMIT_CAP}, and may omit older commits. "
                "Notification was not sent."
            ),
        }
    if not commit_ids:
        return {"status": "empty", "from": after, "to": after, "reason": ""}
    if not parents:
        return {"status": "range", "from": EMPTY_TREE, "to": after, "reason": ""}
    return {"status": "range", "from": parents[0], "to": after, "reason": ""}


def collect_should_continue(submit_result: str, checkpoint_result: str) -> bool:
    return submit_result == "success" and checkpoint_result in {"success", "failure", "skipped"}


def notify_enabled(config: dict) -> bool:
    dashboard = config.get("dashboard") or {}
    return bool(dashboard.get("notify", True))


def should_notify(board_result: str, notify: bool, send: bool, prepare_result: str = "success") -> bool:
    return (
        prepare_result == "success"
        and notify
        and send
        and board_result in {"success", "failure", "skipped"}
    )


def maintenance_plan(event_name: str, task: str) -> dict:
    selected = "clean" if event_name == "schedule" else task
    if selected not in MAINTENANCE:
        raise ValueError(f"unknown maintenance task {selected}")
    return {"task": selected, **MAINTENANCE[selected]}


def first_line(message: str) -> str:
    return message.splitlines()[0] if message else ""


def emit(pairs: dict[str, str]) -> None:
    text = "".join(f"{key}={value}\n" for key, value in pairs.items())
    target = os.environ.get("GITHUB_OUTPUT")
    if target:
        with open(target, "a", encoding="utf-8") as handle:
            handle.write(text)
        return
    sys.stdout.write(text)


def changed_files(before: str, sha: str) -> list[str]:
    if not before or before == sha:
        return []
    result = subprocess.check_output(["git", "diff", "--name-only", before, sha], text=True)
    return [line for line in result.splitlines() if line]


def commit_parents(sha: str) -> list[str] | None:
    result = subprocess.run(["git", "rev-parse", f"{sha}^@"], check=False, capture_output=True, text=True)
    if result.returncode != 0:
        return None
    return [line for line in result.stdout.split() if line]


def commit_subjects(from_sha: str, to_sha: str) -> list[str]:
    if not from_sha or from_sha == to_sha:
        return []
    spec = to_sha if from_sha == EMPTY_TREE else f"{from_sha}..{to_sha}"
    result = subprocess.check_output(["git", "log", "--format=%s", spec], text=True)
    return [line for line in result.splitlines() if line]


def jobs_gate_cli() -> None:
    raw_now = os.environ.get("NOW")
    now = datetime.fromisoformat(raw_now.replace("Z", "+00:00")) if raw_now else datetime.now(LA)
    if now.tzinfo is None:
        now = now.replace(tzinfo=LA)
    result = jobs_gate(
        os.environ.get("EVENT_NAME", ""),
        os.environ.get("TASK", ""),
        os.environ.get("SCHEDULE", ""),
        now,
    )
    if result["message"]:
        print(result["message"], file=sys.stderr)
    emit(
        {
            "should_run": result["should_run"],
            "task": result["task"],
            "lookback_days": result["lookback_days"],
        }
    )


def batch_due_cli() -> None:
    event_name = os.environ.get("EVENT_NAME", "")
    due = batch_due(event_name, read_optional("data/batch/queue.ndjson"), read_optional("data/batch/inflight.json"))
    if event_name == "workflow_dispatch":
        print("Manual run; skipping idle gate.", file=sys.stderr)
    else:
        print("Batch work is pending." if due else "No queued or inflight batch work.", file=sys.stderr)
    emit({"due": "true" if due else "false"})


def report_incomplete_range(reason: str) -> None:
    print(reason, file=sys.stderr)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(reason + "\n")


def publish_route_cli() -> None:
    before = os.environ.get("BEFORE", "")
    after = os.environ["SHA"]
    raw_ids = os.environ.get("PUSH_COMMITS", "")
    parsed_ids = json.loads(raw_ids) if raw_ids else []
    commit_ids = parsed_ids if isinstance(parsed_ids, list) else []
    new_ref = not before or is_zero_sha(before)
    parents: list[str] | None = []
    if new_ref and commit_ids and len(commit_ids) < WEBHOOK_PUSH_COMMIT_CAP:
        parents = commit_parents(commit_ids[0])
        if parents is None:
            report_incomplete_range(
                "This push created a ref, so before is zero. "
                f"The parent of the oldest pushed commit {commit_ids[0]} could not be resolved. "
                "Notification was not sent."
            )
            sys.exit(1)
    bounds = resolve_push_bounds(before, after, parents, commit_ids)
    if bounds["status"] == "incomplete":
        report_incomplete_range(bounds["reason"])
        sys.exit(1)
    from_sha = bounds["from"]
    to_sha = bounds["to"]
    if from_sha == EMPTY_TREE:
        subprocess.run(["git", "hash-object", "-t", "tree", "--stdin"], input=b"", check=True)
    files = changed_files(from_sha, to_sha)
    route = route_push(os.environ.get("COMMIT_MESSAGE", ""), files, commit_subjects(from_sha, to_sha))
    emit_route(to_sha, route, from_sha)


def classify_head_cli() -> None:
    sha = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    files = changed_files(f"{sha}~1", sha)
    emit_route(sha, classify_files(files))


def notify_enabled_cli() -> None:
    raw = subprocess.check_output(["git", "show", f"{os.environ['DATA_SHA']}:config.json"], text=True)
    enabled = notify_enabled(json.loads(raw))
    print("Notifications disabled." if not enabled else "Notifications enabled.", file=sys.stderr)
    emit({"send": "true" if enabled else "false"})


def maintenance_task_cli() -> None:
    plan = maintenance_plan(os.environ.get("EVENT_NAME", ""), os.environ.get("TASK", ""))
    sys.stdout.write(f"{plan['task']}\n")


def maintenance_commit_cli() -> None:
    plan = maintenance_plan(os.environ.get("EVENT_NAME", ""), os.environ.get("TASK", ""))
    dirty = [
        path
        for path in plan["paths"]
        if subprocess.check_output(["git", "status", "--porcelain", "--", path], text=True).strip()
    ]
    if not dirty:
        print("No changes to commit.", file=sys.stderr)
        emit({"has_commit": "false"})
        return

    subprocess.check_call(["git", "config", "user.name", "actions-bot"])
    subprocess.check_call(["git", "config", "user.email", "actions@github.com"])
    subprocess.check_call(["git", "add", "--", *dirty])
    subprocess.check_call(["git", "-c", "commit.gpgsign=false", "commit", "-m", plan["message"]])
    emit({"has_commit": "true"})


def emit_route(sha: str, route: dict[str, bool], from_sha: str = "") -> None:
    emit(
        {
            "run": "true" if route["run"] else "false",
            "board": "true" if route["board"] else "false",
            "notify": "true" if route["notify"] else "false",
            "from_sha": from_sha,
            "data_sha": sha,
        }
    )


def read_optional(path: str) -> str | None:
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    commands = {
        "jobs-gate": jobs_gate_cli,
        "batch-due": batch_due_cli,
        "publish-route": publish_route_cli,
        "classify-head": classify_head_cli,
        "notify-enabled": notify_enabled_cli,
        "maintenance-task": maintenance_task_cli,
        "maintenance-commit": maintenance_commit_cli,
    }
    if command not in commands:
        raise SystemExit(f"unknown command {command}")
    commands[command]()


if __name__ == "__main__":
    main()
