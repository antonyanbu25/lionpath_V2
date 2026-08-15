#!/usr/bin/env python3
"""Command line interface for Claude Message Batch API workflows."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from batch_client import BatchClient


def read_requests(path: str) -> list[dict[str, Any]]:
    with Path(path).open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, list):
        raise ValueError("request file must contain a JSON list")
    return data


def write_json(path: str | None, payload: Any) -> None:
    text = json.dumps(payload, indent=2, sort_keys=True)
    if path:
        with Path(path).open("w", encoding="utf-8") as handle:
            handle.write(text)
            handle.write("\n")
    else:
        print(text)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Submit, poll, and retrieve Claude Message Batch jobs.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    submit = subparsers.add_parser("submit", help="submit a JSON batch file")
    submit.add_argument("json_file")
    submit.add_argument("--model", default="claude-fable-5")
    submit.add_argument("--poll", action="store_true")

    poll = subparsers.add_parser("poll", help="poll a batch until done")
    poll.add_argument("batch_id")
    poll.add_argument("--interval", type=int, default=60)
    poll.add_argument("--timeout", type=int, default=3600)

    retrieve = subparsers.add_parser("retrieve", help="retrieve batch results")
    retrieve.add_argument("batch_id")
    retrieve.add_argument("--output")

    wait = subparsers.add_parser("wait", help="wait for a batch and retrieve results")
    wait.add_argument("batch_id")
    wait.add_argument("--interval", type=int, default=60)
    wait.add_argument("--timeout", type=int, default=3600)
    wait.add_argument("--output")

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    client = BatchClient()

    if args.command == "submit":
        batch_id = client.submit_batch(
            read_requests(args.json_file),
            model=args.model,
        )
        if args.poll:
            status = client.poll_until_done(batch_id)
            write_json(None, status)
        else:
            print(batch_id)
    elif args.command == "poll":
        write_json(
            None,
            client.poll_until_done(
                args.batch_id,
                poll_interval=args.interval,
                timeout=args.timeout,
            ),
        )
    elif args.command == "retrieve":
        write_json(args.output, client.retrieve_results(args.batch_id))
    elif args.command == "wait":
        client.poll_until_done(
            args.batch_id,
            poll_interval=args.interval,
            timeout=args.timeout,
        )
        write_json(args.output, client.retrieve_results(args.batch_id))
    else:
        parser.error(f"unknown command: {args.command}")


if __name__ == "__main__":
    main()
