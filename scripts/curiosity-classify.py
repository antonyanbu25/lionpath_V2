#!/usr/bin/env python3
"""Classify proposed curiosity changes into act-layer risk buckets."""

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any


CLASS_AUTO_ACT = "AUTO_ACT"
CLASS_HUMAN_REQUIRED = "HUMAN_REQUIRED"
CLASS_BLOCK = "BLOCK"


def default_hermes_home() -> str:
    return os.environ.get("HERMES_HOME") or "/root/.hermes"


def default_db_path() -> str:
    return os.environ.get("HERMES_DB") or os.path.join(default_hermes_home(), "state.db")


def rules_path() -> Path:
    return Path(__file__).resolve().with_name("curiosity-risk-rules.json")


def load_rules() -> dict[str, Any]:
    with rules_path().open("r", encoding="utf-8") as handle:
        return json.load(handle)


def normalize_changes(raw: str | None) -> list[dict[str, Any]]:
    if raw is None or not raw.strip():
        return []

    parsed = json.loads(raw)
    if parsed is None:
        return []
    if isinstance(parsed, list):
        items = parsed
    elif isinstance(parsed, dict) and isinstance(parsed.get("items"), list):
        items = parsed["items"]
    else:
        raise ValueError("changes_proposed must be a JSON array")

    changes = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise ValueError(f"change item {index} must be an object")
        changes.append(item)
    return changes


def normalize_tags(change: dict[str, Any]) -> set[str]:
    tags = change.get("tags", [])
    if tags is None:
        return set()
    if isinstance(tags, str):
        return {tags}
    if isinstance(tags, list):
        return {tag for tag in tags if isinstance(tag, str)}
    return set()


def classify_change(change: dict[str, Any], rules: dict[str, Any]) -> tuple[str, str]:
    primitive = str(change.get("primitive") or "")
    target = str(change.get("target") or "")
    tags = normalize_tags(change)

    if primitive in rules.get("block_primitives", []):
        return CLASS_BLOCK, f"primitive {primitive} is blocked"
    for substring in rules.get("block_target_substrings", []):
        if substring in target:
            return CLASS_BLOCK, f"target contains blocked substring {substring}"
    if primitive in rules.get("human_required_primitives", []):
        return CLASS_HUMAN_REQUIRED, f"primitive {primitive} requires human approval"
    if change.get("creates_new") is True:
        return CLASS_HUMAN_REQUIRED, "change creates a new resource"
    if "AGENT_REQUIRES_APPROVAL" in tags:
        return CLASS_HUMAN_REQUIRED, "change is tagged AGENT_REQUIRES_APPROVAL"
    if primitive in rules.get("auto_act_primitives", []):
        return CLASS_AUTO_ACT, f"primitive {primitive} is auto-actable"
    return CLASS_HUMAN_REQUIRED, "no rule matched; defaulting to human approval"


def payload_json(change: dict[str, Any]) -> str:
    payload = change.get("payload", "")
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def classify_brief(brief_id: int) -> None:
    rules = load_rules()
    with sqlite3.connect(default_db_path()) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT changes_proposed FROM curiosity_briefs WHERE id = ?",
            (brief_id,),
        ).fetchone()
        if row is None:
            print(f"curiosity-classify: no brief id {brief_id}", file=sys.stderr)
            return

        changes = normalize_changes(row["changes_proposed"])
        if not changes:
            return

        for change in changes:
            classification, reason = classify_change(change, rules)
            primitive = str(change.get("primitive") or "")
            target = str(change.get("target") or "")
            cursor = conn.execute(
                """
                INSERT INTO curiosity_actions(
                  brief_id,
                  proposed_at,
                  classification,
                  primitive,
                  target,
                  payload,
                  status,
                  reason
                )
                VALUES (?, datetime('now'), ?, ?, ?, ?, 'proposed', ?)
                """,
                (
                    brief_id,
                    classification,
                    primitive,
                    target,
                    payload_json(change),
                    reason,
                ),
            )
            action_id = cursor.lastrowid
            conn.execute(
                """
                INSERT INTO curiosity_action_log(action_id, event_type, at, detail)
                VALUES (?, 'classified', datetime('now'), ?)
                """,
                (action_id, f"CLASSIFICATION: {reason}"),
            )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--brief-id", required=True, type=int)
    return parser.parse_args()


def main() -> int:
    try:
        args = parse_args()
        classify_brief(args.brief_id)
    except SystemExit:
        return 0
    except Exception as exc:
        print(f"curiosity-classify: {exc}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
