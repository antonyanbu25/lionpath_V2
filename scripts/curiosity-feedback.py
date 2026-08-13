#!/usr/bin/env python3
"""Apply conservative curiosity feedback actions to Gideon's memory."""

import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request


API_URL = "https://api.neuralwatt.com/v1/chat/completions"
MODEL = "glm-5.2"
MAX_TOKENS = 1200
TEMPERATURE = 0.2
API_KEY_NAME = "HERMES_CUSTOM_API_NEURALWATT_COM_API_KEY"
SYSTEM_PROMPT = (
    "You are Gideon. You wrote a curiosity brief. Given the brief, proposed "
    "changes, and current memory, decide which changes to apply to memory. "
    'Be conservative — only apply clearly useful changes. Output JSON: '
    '{"actions":[{"op":"add|update","key":"...","value":"..."}]}.'
)


def hermes_home() -> str:
    return os.environ.get("HERMES_HOME") or os.path.expanduser("~/.hermes")


def db_path(home: str) -> str:
    return os.environ.get("HERMES_DB") or os.path.join(home, "state.db")


def read_env_value(home: str, key: str) -> str:
    env_path = os.path.join(home, ".env")
    values = {}
    with open(env_path, "r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            name = name.strip()
            value = value.strip()
            if value and value[0] in ("'", '"') and value[-1:] == value[0]:
                value = value[1:-1]
            values[name] = value
    try:
        return values[key]
    except KeyError as exc:
        raise RuntimeError(f"missing {key} in {env_path}") from exc


def read_brief(path: str) -> str:
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def parse_changes(raw: str):
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"argv[2] is not valid JSON: {exc}") from exc


def connect_readonly(path: str) -> sqlite3.Connection:
    uri = f"file:{os.path.abspath(path)}?mode=ro"
    return sqlite3.connect(uri, uri=True)


def summarize_memory(path: str, limit: int = 120) -> str:
    try:
        with connect_readonly(path) as conn:
            rows = conn.execute(
                """
                SELECT key, value, COALESCE(updated_at, 0)
                FROM memory
                ORDER BY COALESCE(updated_at, 0) DESC, key
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
    except sqlite3.Error as exc:
        return f"Memory unavailable: {exc}"

    if not rows:
        return "Memory is empty."

    lines = []
    for key, value, updated_at in rows:
        value_text = "" if value is None else str(value)
        if len(value_text) > 500:
            value_text = value_text[:497] + "..."
        lines.append(f"- {key}: {value_text} (updated_at={updated_at})")
    return "\n".join(lines)


def build_user_prompt(brief_text: str, changes_proposed, memory_summary: str) -> str:
    return "\n\n".join(
        [
            "Brief:",
            brief_text,
            "Changes proposed JSON:",
            json.dumps(changes_proposed, ensure_ascii=False, sort_keys=True),
            "Current memory summary:",
            memory_summary,
        ]
    )


def request_glm(api_key: str, user_prompt: str) -> dict:
    payload = {
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "temperature": TEMPERATURE,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
    }
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        API_URL,
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GLM HTTP {exc.code}: {body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"GLM request failed: {exc}") from exc


def message_content(response: dict):
    choices = response.get("choices") or []
    if not choices:
        return None, None
    message = choices[0].get("message") or {}
    return message.get("content"), message.get("reasoning")


def extract_json_object(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        return json.loads(text[start : end + 1])


def decide_actions(api_key: str, user_prompt: str) -> dict:
    response = request_glm(api_key, user_prompt)
    content, reasoning = message_content(response)
    if content is None:
        response = request_glm(api_key, user_prompt)
        content, reasoning = message_content(response)
    if content is None:
        content = reasoning
    if content is None:
        raise RuntimeError("GLM returned content:null and no reasoning field")

    try:
        result = extract_json_object(content)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"GLM did not return valid JSON: {exc}") from exc

    actions = result.get("actions")
    if not isinstance(actions, list):
        raise RuntimeError('GLM JSON must contain an "actions" list')
    return {"actions": actions}


def normalized_actions(result: dict) -> list[dict]:
    actions = []
    for item in result.get("actions", []):
        if not isinstance(item, dict):
            continue
        op = item.get("op")
        key = item.get("key")
        value = item.get("value")
        if op not in {"add", "update"}:
            continue
        if not isinstance(key, str) or not key.strip():
            continue
        if value is None:
            continue
        if not isinstance(value, str):
            value = json.dumps(value, ensure_ascii=False, sort_keys=True)
        actions.append({"op": op, "key": key.strip(), "value": value})
    return actions


def apply_actions(path: str, actions: list[dict]) -> None:
    with sqlite3.connect(path) as conn:
        conn.executemany(
            """
            INSERT OR REPLACE INTO memory(key,value,updated_at)
            VALUES(?, ?, strftime('%s','now'))
            """,
            [(action["key"], action["value"]) for action in actions],
        )


def record_changes_applied(
    path: str, brief_text: str, changes_proposed_raw: str, applied_json: str
) -> None:
    try:
        with sqlite3.connect(path) as conn:
            exists = conn.execute(
                """
                SELECT 1
                FROM sqlite_master
                WHERE type='table' AND name='curiosity_briefs'
                """
            ).fetchone()
            if not exists:
                return
            conn.execute(
                """
                UPDATE curiosity_briefs
                SET changes_applied = ?
                WHERE id = (
                  SELECT id
                  FROM curiosity_briefs
                  WHERE brief_text = ? OR changes_proposed = ?
                  ORDER BY created_at DESC, id DESC
                  LIMIT 1
                )
                """,
                (applied_json, brief_text, changes_proposed_raw),
            )
    except sqlite3.Error:
        return


def main() -> int:
    if len(sys.argv) != 3:
        print(
            "usage: curiosity-feedback.py <brief-path> <changes-proposed-json>",
            file=sys.stderr,
        )
        return 2

    home = hermes_home()
    database = db_path(home)
    try:
        api_key = read_env_value(home, API_KEY_NAME)
        brief_text = read_brief(sys.argv[1])
        changes_proposed = parse_changes(sys.argv[2])
        memory_summary = summarize_memory(database)
        prompt = build_user_prompt(brief_text, changes_proposed, memory_summary)
        result = decide_actions(api_key, prompt)
        actions = normalized_actions(result)
        apply_actions(database, actions)
        applied_json = json.dumps(
            {"actions": actions}, ensure_ascii=False, sort_keys=True
        )
        record_changes_applied(database, brief_text, sys.argv[2], applied_json)
        print(applied_json)
        return 0
    except Exception as exc:
        print(f"curiosity-feedback: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
