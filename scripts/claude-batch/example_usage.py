#!/usr/bin/env python3
"""Example Claude Message Batch API usage."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from batch_client import BatchClient


MANIFEST_PATH = Path("/tmp/mesh-D2-batch-manifest/kimi_k3_batch_requests.json")


def load_requests() -> list[dict[str, Any]]:
    if MANIFEST_PATH.exists():
        with MANIFEST_PATH.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, list):
            raise ValueError(f"{MANIFEST_PATH} must contain a JSON list")
        return data

    return [
        {
            "custom_id": "sample-1",
            "params": {
                "max_tokens": 128,
                "messages": [
                    {
                        "role": "user",
                        "content": "Give a concise status line for this sample batch.",
                    }
                ],
            },
        }
    ]


def preview_text(result: dict[str, Any]) -> str:
    result_payload = result.get("result") or {}
    message = result_payload.get("message") or {}
    content = message.get("content") or []
    parts = [
        item.get("text", "")
        for item in content
        if isinstance(item, dict) and item.get("type") == "text"
    ]
    return " ".join(parts).replace("\n", " ")[:200]


def main() -> None:
    client = BatchClient()
    for result in client.submit_and_wait(load_requests()):
        custom_id = result.get("custom_id", "<missing custom_id>")
        print(f"{custom_id}: {preview_text(result)}")


if __name__ == "__main__":
    main()
