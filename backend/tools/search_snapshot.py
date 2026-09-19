#!/usr/bin/env python3
"""Build and diff the local D1 search projection.

This utility deliberately uses only the Python standard library and local SQLite
files. It never calls Wrangler, Cloudflare, or any network service. The output
of ``diff`` is a candidate update: apply every emitted batch successfully before
promoting the candidate snapshot as a new baseline.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping, Sequence


PROJECTION_COLUMNS = (
    "trans_name",
    "origin_name",
    "all_mods",
    "all_keys",
    "all_curseforges",
    "all_modids",
    "frequency",
)
FTS_TABLES = ("dict_search_fts", "dict_search_trigram")
DEFAULT_BUDGET = 50_000
DEFAULT_BATCH_SIZE = 100
MAX_ROWID = 9_223_372_036_854_775_807
TRIGGER_DDL = (
    "CREATE TRIGGER IF NOT EXISTS dict_search_snapshot_fts_ai "
    "AFTER INSERT ON dict_search "
    "BEGIN "
    "INSERT INTO dict_search_fts(rowid, origin_name, trans_name) "
    "VALUES (new.rowid, new.origin_name, new.trans_name); "
    "INSERT INTO dict_search_trigram(rowid, origin_name, trans_name) "
    "VALUES (new.rowid, new.origin_name, new.trans_name); "
    "END;",
    "CREATE TRIGGER IF NOT EXISTS dict_search_snapshot_fts_bd "
    "BEFORE DELETE ON dict_search "
    "BEGIN "
    "INSERT INTO dict_search_fts(dict_search_fts, rowid, origin_name, trans_name) "
    "VALUES ('delete', old.rowid, old.origin_name, old.trans_name); "
    "INSERT INTO dict_search_trigram(dict_search_trigram, rowid, origin_name, trans_name) "
    "VALUES ('delete', old.rowid, old.origin_name, old.trans_name); "
    "END;",
)


class SnapshotError(Exception):
    """An expected input, safety, or SQLite compatibility error."""


@dataclass(frozen=True)
class Delta:
    kind: str
    pair: tuple[object, object]
    old: tuple[object, ...] | None
    new: tuple[object, ...] | None
    rowid: int


def display_path(path: Path) -> str:
    return str(path)


def canonical_path(value: str | os.PathLike[str]) -> Path:
    return Path(value).expanduser().resolve(strict=False)


def require_input_db(value: str, label: str) -> Path:
    path = canonical_path(value)
    if not path.exists():
        raise SnapshotError(f"{label} does not exist: {path}")
    if not path.is_file():
        raise SnapshotError(f"{label} is not a file: {path}")
    return path


def require_new_output(value: str, label: str, inputs: Iterable[Path]) -> Path:
    path = canonical_path(value)
    if path.exists():
        raise SnapshotError(f"refusing to overwrite existing {label}: {path}")
    if not path.parent.exists():
        raise SnapshotError(f"parent directory for {label} does not exist: {path.parent}")
    input_paths = {item.resolve(strict=False) for item in inputs}
    if path in input_paths:
        raise SnapshotError(f"{label} must not replace an input database: {path}")
    return path


def readonly_uri(path: Path) -> str:
    return f"{path.as_uri()}?mode=ro"


def open_readonly(path: Path) -> sqlite3.Connection:
    try:
        conn = sqlite3.connect(readonly_uri(path), uri=True)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only = ON")
        return conn
    except sqlite3.Error as exc:
        raise SnapshotError(f"cannot open SQLite input {path}: {exc}") from exc


def table_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    try:
        return [str(row[1]) for row in conn.execute(f'PRAGMA table_info("{table}")')]
    except sqlite3.Error as exc:
        raise SnapshotError(f"cannot inspect table {table}: {exc}") from exc


def require_columns(conn: sqlite3.Connection, table: str, required: Sequence[str]) -> None:
    columns = table_columns(conn, table)
    if not columns:
        raise SnapshotError(f"SQLite input is missing table {table}")
    missing = [column for column in required if column not in columns]
    if missing:
        joined = ", ".join(missing)
        raise SnapshotError(f"table {table} is missing required columns: {joined}")


def validate_source(path: Path) -> None:
    conn = open_readonly(path)
    try:
        require_columns(conn, "dict", ("trans_name", "origin_name", "modid", "version", "key", "curseforge"))
    finally:
        conn.close()


def extract_projection_select(schema_path: Path) -> str:
    try:
        text = schema_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise SnapshotError(f"cannot read projection schema {schema_path}: {exc}") from exc
    pattern = re.compile(
        r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[\"`]?dict_search[\"`]?\s+AS\s+",
        re.IGNORECASE,
    )
    match = pattern.search(text)
    if not match:
        raise SnapshotError(f"schema {schema_path} has no CREATE TABLE dict_search AS statement")
    remainder = text[match.end() :]
    terminator = re.search(r";\s*CREATE\s+(?:INDEX|VIRTUAL\s+TABLE)\b", remainder, re.IGNORECASE | re.DOTALL)
    if not terminator:
        raise SnapshotError(f"could not find the end of dict_search aggregation in {schema_path}")
    projection = remainder[: terminator.start()].strip()
    if not re.match(r"(?:WITH|SELECT)\b", projection, re.IGNORECASE):
        raise SnapshotError(f"dict_search aggregation in {schema_path} is not a SELECT/ WITH query")
    return projection


def sql_identifier(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def sql_value(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise SnapshotError("cannot emit non-finite numeric SQLite value")
        return repr(value)
    if isinstance(value, bytes):
        raise SnapshotError("cannot emit BLOB data; projection snapshots must be UTF-8 text")
    return "'" + str(value).replace("'", "''") + "'"


def maintenance_ddl() -> tuple[str, ...]:
    """An empty command view keeps compare-and-apply in one SQLite statement.

    The INSTEAD OF trigger raises before any mutation on a stale row. It stores
    no command rows and also accepts an already-applied target as a no-op.
    """
    def matches(record: str) -> str:
        return " AND ".join(
            f"{sql_identifier(column)} IS json_extract(NEW.{record}, '$[{index}]')"
            for index, column in enumerate(PROJECTION_COLUMNS)
        )

    old_match, new_match = matches("old_values"), matches("new_values")
    present = "EXISTS (SELECT 1 FROM dict_search WHERE rowid = NEW.target_rowid)"
    expected = f"EXISTS (SELECT 1 FROM dict_search WHERE rowid = NEW.target_rowid AND {old_match})"
    applied = f"EXISTS (SELECT 1 FROM dict_search WHERE rowid = NEW.target_rowid AND {new_match})"
    assignments = ", ".join(
        f"{sql_identifier(column)} = json_extract(NEW.new_values, '$[{index}]')"
        for index, column in enumerate(PROJECTION_COLUMNS) if index >= 2
    )
    columns = ", ".join(sql_identifier(column) for column in PROJECTION_COLUMNS)
    values = ", ".join(
        f"json_extract(NEW.new_values, '$[{index}]')" for index in range(len(PROJECTION_COLUMNS))
    )
    view = """CREATE VIEW IF NOT EXISTS dict_search_snapshot_changes AS
        SELECT NULL AS operation, NULL AS target_rowid,
               NULL AS old_values, NULL AS new_values WHERE 0;"""
    apply = f"""CREATE TRIGGER IF NOT EXISTS dict_search_snapshot_apply
        INSTEAD OF INSERT ON dict_search_snapshot_changes
        BEGIN
          SELECT CASE WHEN NEW.operation IS NULL
            OR NEW.operation NOT IN ('add', 'update', 'remove')
            OR typeof(NEW.target_rowid) != 'integer' OR NEW.target_rowid <= 0
            THEN RAISE(ABORT, 'invalid search snapshot operation') END;
          SELECT CASE WHEN NEW.operation IN ('update', 'remove') AND
            (NEW.old_values IS NULL OR NOT json_valid(NEW.old_values)
             OR json_type(NEW.old_values) != 'array' OR json_array_length(NEW.old_values) != 7)
            THEN RAISE(ABORT, 'invalid search snapshot old row') END;
          SELECT CASE WHEN NEW.operation IN ('add', 'update') AND
            (NEW.new_values IS NULL OR NOT json_valid(NEW.new_values)
             OR json_type(NEW.new_values) != 'array' OR json_array_length(NEW.new_values) != 7)
            THEN RAISE(ABORT, 'invalid search snapshot new row') END;
          SELECT CASE WHEN NEW.operation = 'update' AND
            (json_extract(NEW.old_values, '$[0]') IS NOT json_extract(NEW.new_values, '$[0]')
             OR json_extract(NEW.old_values, '$[1]') IS NOT json_extract(NEW.new_values, '$[1]'))
            THEN RAISE(ABORT, 'search snapshot update cannot change the translation pair') END;
          SELECT CASE WHEN
            (NEW.operation = 'add' AND {present} AND NOT {applied})
            OR (NEW.operation = 'update' AND NOT {expected} AND NOT {applied})
            OR (NEW.operation = 'remove' AND {present} AND NOT {expected})
            THEN RAISE(ABORT, 'search snapshot baseline mismatch') END;
          UPDATE dict_search SET {assignments}
            WHERE NEW.operation = 'update' AND rowid = NEW.target_rowid
              AND {old_match} AND NOT ({new_match});
          DELETE FROM dict_search
            WHERE NEW.operation = 'remove' AND rowid = NEW.target_rowid AND {old_match};
          INSERT INTO dict_search(rowid, {columns})
            SELECT NEW.target_rowid, {values}
            WHERE NEW.operation = 'add' AND NOT {present};
        END;"""
    return (*TRIGGER_DDL, view, apply)


def pair_sort_key(pair: tuple[object, object]) -> tuple[tuple[int, str], tuple[int, str]]:
    def one(value: object) -> tuple[int, str]:
        return (0, "") if value is None else (1, str(value))

    return one(pair[0]), one(pair[1])


def values_from_row(row: sqlite3.Row | Sequence[object]) -> tuple[object, ...]:
    return tuple(row[index] for index in range(len(PROJECTION_COLUMNS)))


def pair_from_values(values: Sequence[object]) -> tuple[object, object]:
    return values[0], values[1]


def load_baseline(path: Path) -> tuple[dict[tuple[object, object], tuple[object, ...]], dict[tuple[object, object], int], int]:
    conn = open_readonly(path)
    try:
        require_columns(conn, "dict_search", PROJECTION_COLUMNS)
        for table in FTS_TABLES:
            row = conn.execute(
                "SELECT type, sql FROM sqlite_schema WHERE name = ? COLLATE BINARY",
                (table,),
            ).fetchone()
            if row is None or row[0] != "table" or not str(row[1] or "").upper().lstrip().startswith("CREATE VIRTUAL TABLE"):
                raise SnapshotError(f"baseline {path} is missing required virtual table {table}")
        query = (
            "SELECT rowid, "
            + ", ".join(sql_identifier(column) for column in PROJECTION_COLUMNS)
            + " FROM dict_search"
        )
        rows: dict[tuple[object, object], tuple[object, ...]] = {}
        rowids: dict[tuple[object, object], int] = {}
        max_rowid = 0
        for row in conn.execute(query):
            try:
                rowid = int(row[0])
            except (TypeError, ValueError) as exc:
                raise SnapshotError(f"baseline {path} has a non-integer dict_search rowid") from exc
            if rowid <= 0 or rowid > MAX_ROWID:
                raise SnapshotError(f"baseline {path} has invalid dict_search rowid {rowid}")
            values = values_from_row(row[1:])
            pair = pair_from_values(values)
            if pair in rows:
                raise SnapshotError(f"baseline {path} contains duplicate pair {pair!r}")
            rows[pair] = values
            rowids[pair] = rowid
            max_rowid = max(max_rowid, rowid)
        return rows, rowids, max_rowid
    except sqlite3.Error as exc:
        raise SnapshotError(f"cannot read baseline {path}: {exc}") from exc
    finally:
        conn.close()
def load_baseline_json(path: Path) -> tuple[dict, dict, int]:
    """Accept complete Wrangler result envelopes or an explicit array of rows."""
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise SnapshotError(f"cannot read baseline JSON {path}: {exc}") from exc
    envelopes = payload if isinstance(payload, list) else [payload]
    result_rows = []
    required = set(PROJECTION_COLUMNS) | {"rowid"}
    for item in envelopes:
        if not isinstance(item, dict):
            raise SnapshotError("baseline JSON must contain row objects or Wrangler result objects")
        if required <= item.keys():
            result_rows.append(item)
        elif isinstance(item.get("results"), list) and item.get("success", True) is True:
            result_rows.extend(item["results"])
        else:
            raise SnapshotError("baseline JSON contains a failed or malformed query result")
    rows, rowids, used_rowids = {}, {}, set()
    for item in result_rows:
        if not isinstance(item, dict) or not required <= item.keys():
            raise SnapshotError("every baseline row must include rowid and all projection columns")
        rowid = item["rowid"]
        if type(rowid) is not int or not 0 < rowid <= 9_007_199_254_740_991:
            raise SnapshotError("baseline JSON rowid must be an exact positive JavaScript-safe integer")
        if rowid in used_rowids:
            raise SnapshotError(f"baseline JSON repeats rowid {rowid}")
        values = tuple(item[column] for column in PROJECTION_COLUMNS)
        pair = pair_from_values(values)
        if pair in rows:
            raise SnapshotError(f"baseline JSON contains duplicate pair {pair!r}")
        rows[pair], rowids[pair] = values, rowid
        used_rowids.add(rowid)
    return rows, rowids, max(used_rowids, default=0)




def create_snapshot_from_rows(
    output_path: Path,
    rows: Mapping[tuple[object, object], tuple[object, ...]],
    rowids: Mapping[tuple[object, object], int],
) -> None:
    temp_path = output_path.with_name(f".{output_path.name}.tmp-{os.getpid()}")
    if temp_path.exists():
        temp_path.unlink()
    conn: sqlite3.Connection | None = None
    try:
        conn = sqlite3.connect(temp_path)
        conn.execute("PRAGMA journal_mode = DELETE")
        conn.execute("PRAGMA synchronous = FULL")
        conn.execute(
            "CREATE TABLE dict_search ("
            "trans_name, origin_name, all_mods, all_keys, all_curseforges, all_modids, frequency"
            ")"
        )
        insert_sql = (
            "INSERT INTO dict_search(rowid, trans_name, origin_name, all_mods, all_keys, "
            "all_curseforges, all_modids, frequency) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        for pair in sorted(rows, key=pair_sort_key):
            if pair not in rowids:
                raise SnapshotError(f"missing rowid for candidate pair {pair!r}")
            rowid = int(rowids[pair])
            if rowid <= 0 or rowid > MAX_ROWID:
                raise SnapshotError(f"invalid candidate rowid {rowid} for pair {pair!r}")
            conn.execute(insert_sql, (rowid, *rows[pair]))
        conn.execute("CREATE INDEX idx_dict_search_frequency ON dict_search(frequency DESC, origin_name)")
        conn.execute(
            "CREATE VIRTUAL TABLE dict_search_fts USING fts5("
            "origin_name, trans_name, content='dict_search', content_rowid='rowid'"
            ")"
        )
        conn.execute(
            "INSERT INTO dict_search_fts(rowid, origin_name, trans_name) "
            "SELECT rowid, origin_name, trans_name FROM dict_search"
        )
        conn.execute(
            "CREATE VIRTUAL TABLE dict_search_trigram USING fts5("
            "origin_name, trans_name, content='dict_search', content_rowid='rowid', tokenize='trigram'"
            ")"
        )
        conn.execute(
            "INSERT INTO dict_search_trigram(rowid, origin_name, trans_name) "
            "SELECT rowid, origin_name, trans_name FROM dict_search"
        )
        for trigger_sql in maintenance_ddl():
            conn.execute(trigger_sql)
        conn.execute("PRAGMA optimize")
        conn.commit()
        conn.close()
        conn = None
        os.replace(temp_path, output_path)
    except sqlite3.Error as exc:
        raise SnapshotError(f"cannot create snapshot {output_path}: {exc}") from exc
    finally:
        if conn is not None:
            conn.close()
        if temp_path.exists():
            temp_path.unlink()


def aggregate_source(source_path: Path, schema_path: Path) -> dict:
    """Aggregate only locally; FTS is built once, for the resulting snapshot."""
    validate_source(source_path)
    projection = extract_projection_select(schema_path)
    conn = sqlite3.connect(":memory:", uri=True)
    try:
        conn.execute("ATTACH DATABASE ? AS source", (readonly_uri(source_path),))
        conn.execute("CREATE TEMP VIEW dict AS SELECT * FROM source.dict")
        rows = {}
        for row in conn.execute(projection):
            values = values_from_row(row)
            pair = pair_from_values(values)
            if pair in rows:
                raise SnapshotError(f"aggregation produced duplicate pair {pair!r}")
            rows[pair] = values
        return rows
    except sqlite3.Error as exc:
        raise SnapshotError(f"cannot aggregate source {source_path}: {exc}") from exc
    finally:
        conn.close()


def iter_deltas(
    baseline: Mapping[tuple[object, object], tuple[object, ...]],
    baseline_rowids: Mapping[tuple[object, object], int],
    desired: Mapping[tuple[object, object], tuple[object, ...]],
    max_rowid: int,
) -> tuple[list[Delta], dict[tuple[object, object], int]]:
    desired_rowids: dict[tuple[object, object], int] = {}
    for pair in desired:
        if pair in baseline_rowids:
            desired_rowids[pair] = baseline_rowids[pair]
    next_rowid = max_rowid
    added_pairs = sorted((pair for pair in desired if pair not in baseline), key=pair_sort_key)
    for pair in added_pairs:
        if next_rowid >= MAX_ROWID:
            raise SnapshotError("cannot assign a new rowid: baseline is at SQLite INTEGER max")
        next_rowid += 1
        desired_rowids[pair] = next_rowid
    deltas: list[Delta] = []
    all_pairs = sorted(set(baseline) | set(desired), key=pair_sort_key)
    for pair in all_pairs:
        old = baseline.get(pair)
        new = desired.get(pair)
        if old is None and new is not None:
            deltas.append(Delta("add", pair, None, new, desired_rowids[pair]))
        elif old is not None and new is None:
            deltas.append(Delta("remove", pair, old, None, baseline_rowids[pair]))
        elif old != new:
            deltas.append(Delta("update", pair, old, new, baseline_rowids[pair]))
    return deltas, desired_rowids


def simulate_delta(candidate_path: Path, deltas: Sequence[Delta]) -> tuple[int, int]:
    """Measure local trigger/FTS writes plus ordinary index overhead and headroom.

    Each command is committed separately to avoid understating FTS flush costs.
    D1 accounting and its existing FTS merge state can still differ.
    """
    conn = sqlite3.connect(candidate_path, isolation_level=None)
    try:
        start = conn.total_changes
        for delta in deltas:
            for statement in emit_delta_statements(delta):
                if len(statement.encode("utf-8")) > 100_000:
                    raise SnapshotError("a delta statement exceeds D1's 100 KB SQL limit")
                conn.execute(statement)
        measured = conn.total_changes - start
        estimated = 2 * (measured + 2 * len(deltas)) + (100 if deltas else 0)
        return estimated, measured
    finally:
        conn.close()


def emit_delta_statements(delta: Delta) -> list[str]:
    def record(values: tuple | None) -> str:
        if values is None:
            return "NULL"
        try:
            return sql_value(json.dumps(values, ensure_ascii=False, separators=(",", ":"), allow_nan=False))
        except (TypeError, ValueError) as exc:
            raise SnapshotError(f"cannot serialize snapshot row: {exc}") from exc

    return [
        "INSERT INTO dict_search_snapshot_changes(operation, target_rowid, old_values, new_values) "
        f"VALUES ({sql_value(delta.kind)}, {delta.rowid}, {record(delta.old)}, {record(delta.new)});"
    ]



def render_sql(
    deltas: Sequence[Delta],
    batch_size: int,
    estimated: int,
    fts_operations: int,
) -> str:
    lines = [
        "-- mcmod-translation-dict local incremental search projection update",
        "-- LOCAL ONLY: this file contains no network or Wrangler operation.",
        "-- Each command atomically verifies old/target content, then maintains content and FTS.",
        "-- Apply each BATCH section as one wrangler execute unit, or bind its statements in D1Database.batch().",
        "-- Deliberately no BEGIN/COMMIT: D1 owns transaction boundaries and rejects nested transactions.",
        f"-- Estimated writes with headroom: {estimated}; FTS logical operations: {fts_operations}. Not a D1 billing guarantee.",
        "-- A batch split is not a quota workaround: rejected large/full updates still need a later quota window.",
    ]
    if deltas:
        lines.extend(
            (
                "",
                "-- SETUP: idempotent FTS maintenance and compare-and-apply command view.",
                *maintenance_ddl(),
                "-- Submit SETUP first. Baseline mismatch aborts that statement; do not continue or promote the candidate.",
            )
        )
    if not deltas:
        lines.append("-- No SQL statements are needed; the baseline projection is identical.")
        return "\n".join(lines) + "\n"
    batch_count = (len(deltas) + batch_size - 1) // batch_size
    for batch_index in range(batch_count):
        start = batch_index * batch_size
        end = min(len(deltas), start + batch_size)
        lines.extend(("", f"-- BATCH {batch_index + 1}/{batch_count}: operations {start + 1}-{end}"))
        for delta in deltas[start:end]:
            lines.append(f"-- {delta.kind.upper()} pair {delta.pair!r}, rowid {delta.rowid}")
            lines.extend(emit_delta_statements(delta))
        lines.append(f"-- END BATCH {batch_index + 1}/{batch_count}")
    return "\n".join(lines) + "\n"
def atomic_write_text(path: Path, content: str) -> None:
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="\n", dir=path.parent, prefix=f".{path.name}.tmp-", delete=False
        ) as handle:
            temp_path = Path(handle.name)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
        temp_path = None
    except OSError as exc:
        raise SnapshotError(f"cannot write {path}: {exc}") from exc
    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()


def default_schema_path() -> Path:
    return Path(__file__).resolve().parents[1] / "schema" / "search-indexes.sql"


def build_command(args: argparse.Namespace) -> int:
    source = require_input_db(args.source, "source database")
    output = require_new_output(args.output, "snapshot output", (source,))
    schema = canonical_path(args.schema) if args.schema else default_schema_path()
    if not schema.is_file():
        raise SnapshotError(f"projection schema does not exist: {schema}")
    rows = aggregate_source(source, schema)
    rowids = {pair: index for index, pair in enumerate(sorted(rows, key=pair_sort_key), 1)}
    create_snapshot_from_rows(output, rows, rowids)
    print(f"built local projection snapshot: {display_path(output)}")
    print(f"rows: {len(rows)}; rowids: deterministic pair order starting at 1")
    print("limitations: local aggregation only; this snapshot does not import raw dict data into D1.")
    return 0


def baseline_json_command(args: argparse.Namespace) -> int:
    source = require_input_db(args.input, "baseline JSON")
    output = require_new_output(args.output, "baseline snapshot output", (source,))
    rows, rowids, max_rowid = load_baseline_json(source)
    create_snapshot_from_rows(output, rows, rowids)
    print(f"built rowid-preserving baseline snapshot: {display_path(output)}")
    print(f"rows: {len(rows)}; maximum preserved rowid: {max_rowid}")
    print("limitations: JSON must come from SELECT rowid AS rowid, *; ordinary dumps are not authoritative for rowids.")
    return 0


def diff_command(args: argparse.Namespace) -> int:
    source = require_input_db(args.source, "source database")
    baseline_path = require_input_db(args.baseline, "baseline database")
    sql_output = require_new_output(args.output, "SQL output", (source, baseline_path))
    candidate_output = require_new_output(args.candidate, "candidate snapshot output", (source, baseline_path))
    schema = canonical_path(args.schema) if args.schema else default_schema_path()
    if not schema.is_file():
        raise SnapshotError(f"projection schema does not exist: {schema}")
    if args.max_estimated_writes < 0:
        raise SnapshotError("--max-estimated-writes must be non-negative")
    if args.batch_size <= 0:
        raise SnapshotError("--batch-size must be positive")
    if sql_output == candidate_output:
        raise SnapshotError("SQL output and candidate snapshot output must be different paths")
    baseline, baseline_rowids, max_rowid = load_baseline(baseline_path)
    with tempfile.TemporaryDirectory(prefix="search-snapshot-") as temp_dir:
        desired = aggregate_source(source, schema)
        deltas, candidate_rowids = iter_deltas(baseline, baseline_rowids, desired, max_rowid)
        fts_operations = 2 * sum(delta.kind in {"add", "remove"} for delta in deltas)
        if not baseline and desired and not args.allow_initial:
            raise SnapshotError(
                "baseline is empty and desired projection is non-empty; refusing initial/full setup by default "
                "(pass --allow-initial only after separately planning the import)"
            )
        simulated = Path(temp_dir) / "candidate.sqlite"
        create_snapshot_from_rows(simulated, baseline, baseline_rowids)
        estimated, measured = simulate_delta(simulated, deltas)
        if estimated > args.max_estimated_writes:
            raise SnapshotError(
                f"estimated writes {estimated} exceed budget {args.max_estimated_writes}; "
                "no SQL or candidate output was emitted"
            )
        actual, actual_rowids, _ = load_baseline(simulated)
        if actual != desired or actual_rowids != candidate_rowids:
            raise SnapshotError("local delta did not produce the desired projection; refusing output")
        # Complete the local candidate before emitting any usable remote SQL.
        try:
            with simulated.open("rb") as source_file, candidate_output.open("xb") as target:
                shutil.copyfileobj(source_file, target)
            atomic_write_text(sql_output, render_sql(deltas, args.batch_size, estimated, fts_operations))
        except Exception:
            if candidate_output.exists():
                candidate_output.unlink()
            raise

    additions = sum(delta.kind == "add" for delta in deltas)
    removals = sum(delta.kind == "remove" for delta in deltas)
    updates = sum(delta.kind == "update" for delta in deltas)
    batches = (len(deltas) + args.batch_size - 1) // args.batch_size if deltas else 0
    print(f"diff SQL: {display_path(sql_output)}")
    print(f"candidate snapshot (promote only after every batch succeeds): {display_path(candidate_output)}")
    print(f"changed pairs: {len(deltas)}; metadata-only updates: {updates}; added: {additions}; removed: {removals}")
    print(f"estimated writes with headroom: {estimated}; local SQLite changes: {measured}; FTS operations: {fts_operations}; batch units: {batches}")
    print("limitations: estimates are not guaranteed D1 billed writes; apply locally or with D1 batch/execute, never this tool.")
    return 0


def add_common_schema(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--schema",
        help="local aggregation SQL (default: backend/schema/search-indexes.sql)",
    )


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build and diff dict_search snapshots using local SQLite only.",
        epilog=(
            "No subcommand performs network or Wrangler operations. For add/delete deltas, submit SETUP once, "
            "then each BATCH as one wrangler execute unit or D1Database.batch([db.prepare(statement), ...]). "
            "The candidate is only a proposed next baseline: apply every batch successfully and verify searches "
            "before promoting it. Generated SQL intentionally omits BEGIN/COMMIT. Splitting a large delta does "
            "not bypass D1's daily write allowance."
        ),
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    baseline_json = subparsers.add_parser(
        "baseline-json",
        aliases=["baseline-from-json"],
        help="make a rowid-preserving baseline snapshot from saved local Wrangler JSON",
    )
    baseline_json.add_argument(
        "--input",
        required=True,
        help="local JSON file from SELECT rowid AS rowid, * FROM dict_search --json",
    )
    baseline_json.add_argument("--output", required=True, help="new SQLite baseline snapshot path (must not exist)")
    baseline_json.set_defaults(handler=baseline_json_command)

    build = subparsers.add_parser("build", aliases=["prepare"], help="build a deterministic local projection snapshot")
    build.add_argument("--source", required=True, help="local SQLite database containing dict")
    build.add_argument("--output", required=True, help="new SQLite projection snapshot path (must not exist)")
    add_common_schema(build)
    build.set_defaults(handler=build_command)

    diff = subparsers.add_parser("diff", help="diff local source projection against an actual baseline snapshot")
    diff.add_argument("--source", required=True, help="new local SQLite database containing dict")
    diff.add_argument("--baseline", required=True, help="local SQLite snapshot containing deployed dict_search rowids")
    diff.add_argument("--output", "--sql", dest="output", required=True, help="new incremental SQL file (must not exist)")
    diff.add_argument("--candidate", required=True, help="new candidate baseline SQLite path (must not exist)")
    diff.add_argument(
        "--max-estimated-writes",
        type=int,
        default=DEFAULT_BUDGET,
        help=f"refuse when local write estimate with headroom exceeds this (default: {DEFAULT_BUDGET}); not a D1 guarantee",
    )
    diff.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"pair operations per transaction-safe output unit (default: {DEFAULT_BATCH_SIZE})",
    )
    diff.add_argument(
        "--allow-initial",
        action="store_true",
        help="allow an empty baseline to emit an initial setup delta; still subject to the write budget",
    )
    add_common_schema(diff)
    diff.set_defaults(handler=diff_command)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = make_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.handler(args))
    except SnapshotError as exc:
        print(f"search_snapshot: error: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("search_snapshot: interrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
