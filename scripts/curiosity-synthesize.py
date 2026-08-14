#!/usr/bin/env python3
"""Synthesize a curiosity brief from fetched signal using GLM."""

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request


API_URL = "https://api.neuralwatt.com/v1/chat/completions"
MODEL = "glm-5.2"
KEY_NAME = "HERMES_CUSTOM_API_NEURALWATT_COM_API_KEY"


def die(message, code=1):
    print(message, file=sys.stderr)
    raise SystemExit(code)


def hermes_home():
    return os.environ.get("HERMES_HOME") or os.path.join(os.path.expanduser("~"), ".hermes")


def read_env_file(path):
    values = {}
    try:
        with open(path, "r", encoding="utf-8") as env_file:
            for raw_line in env_file:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                if line.startswith("export "):
                    line = line[len("export ") :].strip()
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                    value = value[1:-1]
                values[key] = value
    except FileNotFoundError:
        die(f"missing env file: {path}", 2)
    except OSError as exc:
        die(f"failed to read env file {path}: {exc}", 2)
    return values


def env_int(env_values, name, default):
    raw = env_values.get(name) or os.environ.get(name)
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def read_fetch_output(path):
    try:
        with open(path, "r", encoding="utf-8") as fetch_file:
            return fetch_file.read()
    except OSError as exc:
        die(f"failed to read fetch output {path}: {exc}", 2)


def build_messages(topic, trigger_type, fetch_text):
    system_prompt = (
        f"You are Gideon's curiosity. Given internal state and external signal about {topic}, "
        "produce a \u2264300-word brief: what changed, why it matters to Gideon's goals, "
        "one open question. No code, no config."
    )
    user_prompt = {
        "topic": topic,
        "trigger_type": trigger_type,
        "external_signal": fetch_text,
        "output_contract": {
            "format": "json",
            "required_keys": {
                "brief_markdown": "string, markdown brief of 300 words or fewer",
                "relevance_score": "integer 0-100",
                "changes_proposed": "json object",
            },
        },
    }
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=False)},
    ]


def call_glm(api_key, messages, max_tokens):
    payload = {
        "model": MODEL,
        "max_tokens": max_tokens,
        "temperature": 0.2,
        "messages": messages,
    }
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        API_URL,
        data=body,
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
        detail = exc.read().decode("utf-8", errors="replace")
        die(f"GLM HTTP error {exc.code}: {detail}", 3)
    except urllib.error.URLError as exc:
        die(f"GLM request failed: {exc}", 3)
    except json.JSONDecodeError as exc:
        die(f"GLM returned invalid JSON: {exc}", 3)


def first_choice(response):
    choices = response.get("choices") or []
    if not choices:
        die("GLM response had no choices", 4)
    message = choices[0].get("message") or {}
    return message


def extract_usage(response):
    usage = response.get("usage") or {}
    for key in ("total_tokens", "completion_tokens", "prompt_tokens"):
        value = usage.get(key)
        if isinstance(value, int):
            return value
    return 0


def strip_code_fence(text):
    stripped = text.strip()
    if not stripped.startswith("```"):
        return stripped
    lines = stripped.splitlines()
    if len(lines) >= 3 and lines[-1].strip() == "```":
        return "\n".join(lines[1:-1]).strip()
    return stripped


def parse_model_content(content):
    text = strip_code_fence(content)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if not match:
            die("GLM content did not contain JSON", 4)
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError as exc:
            die(f"GLM JSON payload was invalid: {exc}", 4)

    brief = data.get("brief_markdown") or data.get("brief") or data.get("brief_text")
    if not isinstance(brief, str) or not brief.strip():
        die("GLM JSON missing brief_markdown", 4)

    score = data.get("relevance_score")
    if isinstance(score, str) and score.strip().isdigit():
        score = int(score.strip())
    if not isinstance(score, int):
        die("GLM JSON missing integer relevance_score", 4)
    score = max(0, min(100, score))

    changes = data.get("changes_proposed")
    if changes is None:
        changes = {}
    if isinstance(changes, str):
        try:
            changes = json.loads(changes)
        except json.JSONDecodeError:
            changes = {"raw": changes}
    if not isinstance(changes, dict):
        changes = {"items": changes}

    return brief.strip(), score, changes


def state_script_path(home):
    candidates = [
        os.path.join(home, "scripts", "curiosity-state.sh"),
        os.path.join(os.getcwd(), "scripts", "curiosity-state.sh"),
    ]
    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate
    return candidates[0]


def record_skipped(home, trigger_type, topic, changes_proposed, relevance_score, reason):
    brief_text = f"Skipped: {reason}"
    record_brief(
        home,
        trigger_type,
        topic,
        brief_text,
        changes_proposed,
        relevance_score,
        1,
        reason,
        "skipped",
    )


def record_brief(
    home,
    trigger_type,
    topic,
    brief_text,
    changes_proposed,
    relevance_score,
    skipped,
    skip_reason,
    label,
):
    script = state_script_path(home)
    changes_json = json.dumps(changes_proposed, separators=(",", ":"), sort_keys=True)
    env = os.environ.copy()
    env["HERMES_HOME"] = home
    result = subprocess.run(
        [
            "bash",
            script,
            "record",
            trigger_type,
            topic,
            brief_text,
            changes_json,
            str(relevance_score),
            str(skipped),
            skip_reason,
        ],
        text=True,
        capture_output=True,
        env=env,
        timeout=20,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        print(f"failed to record {label} curiosity brief: {detail}", file=sys.stderr)


def brief_file_content(topic, trigger_type, brief):
    return f"# Curiosity Brief: {topic}\n\nTrigger: {trigger_type}\n\n{brief}\n"


def write_brief(topic, trigger_type, brief):
    epoch = int(time.time())
    path = f"/tmp/curiosity.{epoch}.md"
    content = brief_file_content(topic, trigger_type, brief)
    with open(path, "w", encoding="utf-8") as brief_file:
        brief_file.write(content)
    return path


def synthesize(topic, trigger_type, fetch_path):
    home = hermes_home()
    env_values = read_env_file(os.path.join(home, ".env"))
    api_key = env_values.get(KEY_NAME)
    if not api_key:
        die(f"missing {KEY_NAME} in {os.path.join(home, '.env')}", 2)

    max_tokens = env_int(env_values, "CURIOSITY_MAX_TOKENS", 1200)
    fetch_text = read_fetch_output(fetch_path)
    messages = build_messages(topic, trigger_type, fetch_text)

    response = call_glm(api_key, messages, max_tokens)
    tokens_used = extract_usage(response)
    message = first_choice(response)
    content = message.get("content")

    if content is None:
        response = call_glm(api_key, messages, max_tokens)
        tokens_used += extract_usage(response)
        message = first_choice(response)
        content = message.get("content")
        if content is None:
            reasoning = message.get("reasoning")
            if reasoning:
                print(str(reasoning), file=sys.stderr)
            die("GLM returned content:null after retry", 6)

    if not isinstance(content, str) or not content.strip():
        die("GLM returned empty content", 4)

    brief, relevance_score, changes_proposed = parse_model_content(content)

    if relevance_score < 50:
        reason = f"relevance_score {relevance_score} below threshold 50"
        record_skipped(home, trigger_type, topic, changes_proposed, relevance_score, reason)
        print(
            json.dumps(
                {
                    "status": "skipped",
                    "relevance_score": relevance_score,
                    "changes_proposed": changes_proposed,
                    "tokens_used": tokens_used,
                },
                separators=(",", ":"),
            )
        )
        return

    brief_path = write_brief(topic, trigger_type, brief)
    record_brief(
        home,
        trigger_type,
        topic,
        brief_file_content(topic, trigger_type, brief),
        changes_proposed,
        relevance_score,
        0,
        "",
        "successful",
    )
    print(
        json.dumps(
            {
                "brief_path": brief_path,
                "relevance_score": relevance_score,
                "changes_proposed": changes_proposed,
                "tokens_used": tokens_used,
            },
            separators=(",", ":"),
        )
    )


def main():
    if len(sys.argv) != 4:
        die("usage: curiosity-synthesize.py <topic> <trigger_type> <fetch_output_path>", 2)
    synthesize(sys.argv[1], sys.argv[2], sys.argv[3])


if __name__ == "__main__":
    main()
