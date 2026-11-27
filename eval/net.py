"""HTTP with an on-disk cache, retries and back-off. Standard library only.

Every download the dataset builder makes goes through `cached_get` or `RpcClient`, so a run
can be repeated from `eval/data/raw/` without the network, and an interrupted run resumes
where it stopped. No request ever carries anything about this repository or its user.
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable, Optional

USER_AGENT = "holdback-eval/1.0"
RETRY_STATUSES = {408, 425, 429, 500, 502, 503, 504}


class FetchError(Exception):
    """A source could not be fetched. The message names the host and status, never a secret."""


def _request(
    url: str,
    *,
    data: Optional[bytes] = None,
    headers: Optional[dict[str, str]] = None,
    timeout: float = 30.0,
    attempts: int = 5,
) -> bytes:
    host = url.split("/")[2] if "://" in url else url
    delay = 1.0
    last = "no attempt made"
    for attempt in range(attempts):
        request = urllib.request.Request(url, data=data, headers={"user-agent": USER_AGENT})
        for name, value in (headers or {}).items():
            request.add_header(name, value)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            last = f"HTTP {error.code}"
            if error.code not in RETRY_STATUSES:
                break
            retry_after = error.headers.get("retry-after") if error.headers else None
            if retry_after and retry_after.isdigit():
                delay = max(delay, float(retry_after))
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:
            last = type(error).__name__
        if attempt < attempts - 1:
            time.sleep(delay)
            delay = min(delay * 2, 30.0)
    raise FetchError(f"{host}: {last}")


def cache_path(raw_dir: Path, name: str) -> Path:
    path = raw_dir / name
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def cached_get(
    raw_dir: Path,
    name: str,
    url: str,
    *,
    headers: Optional[dict[str, str]] = None,
    refresh: bool = False,
) -> bytes:
    """The bytes at `url`, from `raw_dir/name` when present, else downloaded and stored."""
    path = cache_path(raw_dir, name)
    if path.exists() and not refresh:
        return path.read_bytes()
    body = _request(url, headers=headers)
    path.write_bytes(body)
    return body


class RpcClient:
    """Solana JSON-RPC over HTTP with a per-call disk cache and a polite request rate.

    Public endpoints allow a limited number of requests per ten seconds; `min_interval`
    spaces calls out and 429 answers are retried with back-off by `_request`.
    """

    def __init__(self, url: str, raw_dir: Path, *, min_interval: float = 0.35) -> None:
        self.url = url
        self.raw_dir = raw_dir / "rpc"
        self.min_interval = min_interval
        self._last_call = 0.0
        self.network_calls = 0

    def call(
        self,
        method: str,
        params: list[Any],
        *,
        cache: bool = True,
        transform: Optional[Callable[[Any], Any]] = None,
    ) -> Any:
        """One RPC call. `transform` reduces the answer before it is cached and returned,
        which keeps multi-megabyte blocks and signature pages out of the cache."""
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        digest = hashlib.sha256(f"{method}:{json.dumps(params, sort_keys=True)}".encode())
        path = cache_path(self.raw_dir, f"{method}-{digest.hexdigest()[:24]}.json")
        if cache and path.exists():
            return json.loads(path.read_text())
        wait = self.min_interval - (time.monotonic() - self._last_call)
        if wait > 0:
            time.sleep(wait)
        raw = _request(
            self.url,
            data=body.encode(),
            headers={"content-type": "application/json"},
            timeout=40.0,
        )
        self._last_call = time.monotonic()
        self.network_calls += 1
        payload = json.loads(raw)
        if "error" in payload:
            code = payload["error"].get("code")
            raise FetchError(f"{method}: RPC error {code}")
        result = payload.get("result")
        if transform is not None:
            result = transform(result)
        if cache:
            path.write_text(json.dumps(result))
        return result
