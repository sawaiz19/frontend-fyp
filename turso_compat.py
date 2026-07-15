"""
Turso (LibSQL) access over HTTPS using turso-python — works without native libsql wheels
(e.g. Python 3.14 on Windows). Exposes a small sqlite3-like API used by chatbot.py.
"""
from __future__ import annotations

import os
from typing import Any

from turso_python import TursoConnection


def _format_args_turso(args: list[Any] | tuple | None) -> list[dict[str, Any]]:
    """Bind parameters for Turso HTTP API (floats must be JSON numbers, not strings)."""
    if not args:
        return []
    formatted: list[dict[str, Any]] = []
    for a in args:
        if isinstance(a, str):
            formatted.append({"type": "text", "value": a})
        elif isinstance(a, bool):
            formatted.append({"type": "integer", "value": "1" if a else "0"})
        elif isinstance(a, int):
            formatted.append({"type": "integer", "value": str(a)})
        elif isinstance(a, float):
            formatted.append({"type": "float", "value": a})
        elif a is None:
            formatted.append({"type": "null"})
        else:
            raise ValueError(f"Unsupported argument type: {type(a)}")
    return formatted


TursoConnection._format_args = staticmethod(_format_args_turso)  # type: ignore[method-assign]


def _normalize_cell(cell: dict[str, Any]) -> Any:
    if not cell:
        return None
    t = cell.get("type")
    if t == "null":
        return None
    if t == "integer":
        return int(cell["value"])
    if t == "float":
        return float(cell["value"])
    if t == "text":
        return cell.get("value")
    if t == "blob":
        import base64

        raw = cell.get("base64")
        return base64.b64decode(raw) if raw else None
    return cell.get("value")


def _raise_if_pipeline_error(data: dict[str, Any]) -> None:
    for item in data.get("results") or []:
        if item.get("type") == "error":
            msg = item.get("error") or item.get("message") or str(item)
            raise RuntimeError(f"Turso pipeline error: {msg}")


def pipeline_execute_results(data: dict[str, Any]) -> list[dict[str, Any]]:
    """List of execute `result` objects (cols, rows, last_insert_rowid, ...) in order."""
    _raise_if_pipeline_error(data)
    out: list[dict[str, Any]] = []
    for item in data.get("results") or []:
        if item.get("type") != "ok":
            continue
        resp = item.get("response") or {}
        if resp.get("type") == "execute":
            out.append(resp.get("result") or {})
    return out


def last_insert_rowid(result: dict[str, Any]) -> int | None:
    raw = result.get("last_insert_rowid")
    if raw is None:
        return None
    return int(raw)


class TursoRow(dict):
    """dict-like row; chatbot uses row['col'] and dict(row)."""

    def __getitem__(self, key: str) -> Any:
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


class TursoCursor:
    def __init__(self, conn: "TursoCompatConnection") -> None:
        self._conn = conn
        self._rows: list[TursoRow] | None = None
        self._idx = 0
        self.lastrowid: int | None = None
        self.rowcount: int = 0

    def execute(self, sql: str, params: tuple | list | None = None) -> "TursoCursor":
        self._rows = None
        self._idx = 0
        self.lastrowid = None
        args = tuple(params) if params is not None else ()
        data = self._conn._client.execute_query(sql, args)
        results = pipeline_execute_results(data)
        if not results:
            self.rowcount = 0
            return self
        r0 = results[0]
        self.rowcount = int(r0.get("affected_row_count") or 0)
        lid = r0.get("last_insert_rowid")
        self.lastrowid = int(lid) if lid is not None else None
        cols = [c["name"] for c in r0.get("cols", [])]
        built: list[TursoRow] = []
        for row_cells in r0.get("rows") or []:
            d = TursoRow()
            for i, name in enumerate(cols):
                d[name] = _normalize_cell(row_cells[i]) if i < len(row_cells) else None
            built.append(d)
        self._rows = built
        return self

    def executemany(self, sql: str, seq_of_params: list[tuple] | tuple) -> "TursoCursor":
        for params in seq_of_params:
            self.execute(sql, params)
        return self

    def fetchone(self) -> TursoRow | None:
        if not self._rows or self._idx >= len(self._rows):
            return None
        row = self._rows[self._idx]
        self._idx += 1
        return row

    def fetchall(self) -> list[TursoRow]:
        if not self._rows:
            return []
        rest = self._rows[self._idx :]
        self._idx = len(self._rows)
        return rest


class TursoCompatConnection:
    def __init__(self, client: TursoConnection) -> None:
        self._client = client

    def cursor(self) -> TursoCursor:
        return TursoCursor(self)

    def commit(self) -> None:
        pass

    def close(self) -> None:
        pass


_client_singleton: TursoConnection | None = None


def get_db() -> TursoCompatConnection:
    global _client_singleton
    if _client_singleton is None:
        url = os.environ.get("TURSO_DATABASE_URL")
        token = os.environ.get("TURSO_AUTH_TOKEN")
        if not url or not token:
            raise RuntimeError(
                "Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (e.g. in a .env file). "
                "See .env.example."
            )
        _client_singleton = TursoConnection(database_url=url, auth_token=token)
    return TursoCompatConnection(_client_singleton)


def get_turso_raw() -> TursoConnection:
    """Underlying HTTP client (for multi-statement batches)."""
    get_db()
    assert _client_singleton is not None
    return _client_singleton


def write_batch(client: TursoConnection, ops: list[tuple[str, tuple]]) -> list[dict[str, Any]]:
    """Run multiple writes in one HTTP pipeline (one transaction on the server)."""
    payload = [{"sql": s, "args": list(a)} for s, a in ops]
    data = client.batch(payload)
    return pipeline_execute_results(data)
