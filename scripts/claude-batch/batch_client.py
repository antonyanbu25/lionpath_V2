#!/usr/bin/env python3
"""Client helpers for Claude Message Batch API workflows."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Callable


class BatchClient:
    """Small wrapper around Anthropic's Message Batch API."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str = "https://api.anthropic.com",
    ) -> None:
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not self.api_key:
            raise ValueError("ANTHROPIC_API_KEY is required")

        self.base_url = base_url
        self.extra_headers = {"anthropic-version": "2023-06-01"}
        self.cache_dir = Path("/tmp/.hermes/cache")

        try:
            from anthropic import Anthropic
        except ImportError as exc:
            raise ImportError(
                "The anthropic package is required. Install with: "
                "pip install -r scripts/claude-batch/requirements.txt"
            ) from exc

        self.client = Anthropic(api_key=self.api_key, base_url=self.base_url)

    def submit_batch(
        self,
        requests: list[dict[str, Any]],
        model: str = "claude-fable-5",
    ) -> str:
        """Submit a batch and return its id."""
        normalized = [
            self._with_default_model(request, model)
            for request in requests
        ]
        batch = self._with_retries(
            lambda: self.client.messages.batches.create(
                requests=normalized,
                extra_headers=self.extra_headers,
            )
        )
        return self._field(batch, "id")

    def poll_until_done(
        self,
        batch_id: str,
        poll_interval: int = 60,
        timeout: int = 3600,
    ) -> dict[str, Any]:
        """Poll a batch until it ends or expires."""
        deadline = time.monotonic() + timeout
        while True:
            batch = self._with_retries(
                lambda: self.client.messages.batches.retrieve(
                    batch_id,
                    extra_headers=self.extra_headers,
                )
            )
            payload = self._to_plain(batch)
            status = payload.get("processing_status")
            if status in {"ended", "expired"}:
                return payload
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Timed out waiting for batch {batch_id}")
            time.sleep(poll_interval)

    def retrieve_results(self, batch_id: str) -> list[dict[str, Any]]:
        """Retrieve batch results and cache them as a backup."""
        response = self._with_retries(
            lambda: self.client.messages.batches.results(
                batch_id,
                extra_headers=self.extra_headers,
            )
        )
        results = [self._to_plain(item) for item in response]
        self._cache_results(batch_id, results)
        return results

    def submit_and_wait(
        self,
        requests: list[dict[str, Any]],
        model: str = "claude-fable-5",
        poll_interval: int = 60,
        timeout: int = 3600,
    ) -> list[dict[str, Any]]:
        """Submit a batch, wait for completion, and return results."""
        batch_id = self.submit_batch(requests, model=model)
        self.poll_until_done(
            batch_id,
            poll_interval=poll_interval,
            timeout=timeout,
        )
        return self.retrieve_results(batch_id)

    def _with_retries(self, operation: Callable[[], Any]) -> Any:
        for attempt in range(4):
            try:
                return operation()
            except Exception as exc:
                if attempt == 3 or not self._is_retryable(exc):
                    raise
                retry_after = self._retry_after(exc)
                delay = retry_after if retry_after is not None else 5 * (2 ** attempt)
                time.sleep(delay)
        raise RuntimeError("unreachable retry state")

    @staticmethod
    def _is_retryable(exc: Exception) -> bool:
        status_code = getattr(exc, "status_code", None)
        return status_code == 429 or (
            isinstance(status_code, int) and 500 <= status_code <= 599
        )

    @staticmethod
    def _retry_after(exc: Exception) -> float | None:
        response = getattr(exc, "response", None)
        headers = getattr(response, "headers", None)
        if not headers:
            return None
        value = headers.get("retry-after")
        if value is None:
            return None
        try:
            return float(value)
        except ValueError:
            return None

    @staticmethod
    def _with_default_model(
        request: dict[str, Any],
        model: str,
    ) -> dict[str, Any]:
        copied = dict(request)
        params = dict(copied.get("params") or {})
        params.setdefault("model", model)
        copied["params"] = params
        return copied

    @staticmethod
    def _field(value: Any, name: str) -> Any:
        if isinstance(value, dict):
            return value[name]
        return getattr(value, name)

    @classmethod
    def _to_plain(cls, value: Any) -> Any:
        if hasattr(value, "model_dump"):
            return value.model_dump(mode="json")
        if hasattr(value, "to_dict"):
            return value.to_dict()
        if isinstance(value, dict):
            return {key: cls._to_plain(item) for key, item in value.items()}
        if isinstance(value, list):
            return [cls._to_plain(item) for item in value]
        if isinstance(value, tuple):
            return [cls._to_plain(item) for item in value]
        return value

    def _cache_results(self, batch_id: str, results: list[dict[str, Any]]) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        cache_path = self.cache_dir / f"batch_{batch_id}.json"
        with cache_path.open("w", encoding="utf-8") as handle:
            json.dump(results, handle, indent=2, sort_keys=True)
            handle.write("\n")
