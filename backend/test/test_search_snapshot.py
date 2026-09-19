import json
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path


TOOL = Path(__file__).resolve().parents[1] / "tools" / "search_snapshot.py"


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.rows = [
            ("铜锭", "Copper", "example", "1", "item.copper", ""),
            ("旧矿石", "Old ore", "example", "1", "item.old", ""),
        ]
        self.source(self.rows)
        exported = [{"rowid": rowid, "trans_name": row[0], "origin_name": row[1],
                     "all_mods": "example (1)", "all_keys": row[4],
                     "all_curseforges": "", "all_modids": "example", "frequency": 1}
                    for rowid, row in zip((7, 21), self.rows)]
        (self.path / "baseline.json").write_text(
            json.dumps([{"success": True, "results": exported}]), encoding="utf-8"
        )
        self.run_tool("baseline-json", "--input", "baseline.json", "--output", "baseline.db")

    def source(self, rows):
        with closing(sqlite3.connect(self.path / "source.db")) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS dict(trans_name, origin_name, modid, version, "key", curseforge)')
            db.execute("DELETE FROM dict")
            db.executemany("INSERT INTO dict VALUES(?,?,?,?,?,?)", rows)

    def run_tool(self, *args, success=True):
        result = subprocess.run([sys.executable, str(TOOL), *args], cwd=self.path,
                                capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode == 0, success, result.stderr)
        return result

    def diff(self, *args, success=True):
        return self.run_tool("diff", "--source", "source.db", "--baseline", "baseline.db",
                             "--output", "delta.sql", "--candidate", "candidate.db",
                             *args, success=success)

    def test_delta_preserves_rowids_fts_and_safe_replay(self):
        self.source([self.rows[0], ("铜锭", "Copper", "example", "2", "item.copper", ""),
                     ("矿石_%\\箱", "O'Brien ore", "new", "1", "item.ore's", "")])
        self.diff()
        shutil.copyfile(self.path / "baseline.db", self.path / "applied.db")
        sql = (self.path / "delta.sql").read_text(encoding="utf-8")
        with closing(sqlite3.connect(self.path / "applied.db")) as actual, closing(sqlite3.connect(self.path / "candidate.db")) as candidate:
            actual.executescript(sql)
            self.assertEqual(actual.execute("SELECT rowid,* FROM dict_search ORDER BY rowid").fetchall(),
                             candidate.execute("SELECT rowid,* FROM dict_search ORDER BY rowid").fetchall())
            self.assertEqual(actual.execute("SELECT rowid FROM dict_search WHERE origin_name='Copper'").fetchone(), (7,))
            self.assertEqual(actual.execute("SELECT rowid FROM dict_search WHERE origin_name=?", ("O'Brien ore",)).fetchone(), (22,))
            self.assertEqual(actual.execute("SELECT rowid FROM dict_search_fts WHERE dict_search_fts MATCH 'Old'").fetchall(), [])
            self.assertEqual(actual.execute("SELECT rowid FROM dict_search_trigram WHERE dict_search_trigram MATCH ?", ('trans_name:"矿石_%"',)).fetchall(), [(22,)])
            before = actual.total_changes
            actual.executescript(sql)
            self.assertEqual(actual.total_changes, before)

    def test_metadata_update_does_not_rewrite_search_indexes(self):
        self.source([*self.rows, ("铜锭", "Copper", "example", "2", "item.copper", "")])
        self.diff()
        with closing(sqlite3.connect(self.path / "baseline.db")) as db:
            before = db.total_changes
            db.executescript((self.path / "delta.sql").read_text(encoding="utf-8"))
            self.assertEqual(db.execute("SELECT all_mods FROM dict_search WHERE rowid=7").fetchone(), ("example (1/2)",))
            self.assertEqual(db.total_changes - before, 1)
            self.assertEqual(db.execute("SELECT rowid FROM dict_search_fts WHERE dict_search_fts MATCH 'Copper'").fetchall(), [(7,)])

    def test_identical_projection_has_no_remote_writes(self):
        self.diff("--max-estimated-writes", "0")
        with closing(sqlite3.connect(self.path / "baseline.db")) as db:
            before = db.total_changes
            db.executescript((self.path / "delta.sql").read_text(encoding="utf-8"))
            self.assertEqual(db.total_changes, before)

    def test_budget_refusal_leaves_no_partial_outputs(self):
        self.source([self.rows[0]])
        self.diff("--max-estimated-writes", "1", success=False)
        self.assertFalse((self.path / "delta.sql").exists())
        self.assertFalse((self.path / "candidate.db").exists())

    def test_malformed_baseline_cannot_silently_drop_rows(self):
        path = self.path / "baseline.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload[0]["results"].append({"rowid": 99})
        path.write_text(json.dumps(payload), encoding="utf-8")
        self.run_tool("baseline-json", "--input", "baseline.json", "--output", "bad.db", success=False)
        self.assertFalse((self.path / "bad.db").exists())

    def replace_pair(self, db, rowid):
        values = list(db.execute("SELECT * FROM dict_search WHERE rowid=?", (rowid,)).fetchone())
        values[0:3] = ["钻石", "Diamond", "diamondmod (9)"]
        db.execute("DELETE FROM dict_search WHERE rowid=?", (rowid,))
        db.execute("INSERT INTO dict_search(rowid,trans_name,origin_name,all_mods,all_keys,all_curseforges,all_modids,frequency) VALUES(?,?,?,?,?,?,?,?)", (rowid, *values))
        db.commit()

    def test_stale_update_rejects_reused_rowid_without_changing_content_or_fts(self):
        self.source([*self.rows, ("铜锭", "Copper", "example", "2", "item.copper", "")])
        self.diff()
        with closing(sqlite3.connect(self.path / "baseline.db")) as db:
            self.replace_pair(db, 7)
            before = db.execute("SELECT rowid,* FROM dict_search ORDER BY rowid").fetchall()
            with self.assertRaises(sqlite3.IntegrityError):
                db.executescript((self.path / "delta.sql").read_text(encoding="utf-8"))
            self.assertEqual(db.execute("SELECT rowid,* FROM dict_search ORDER BY rowid").fetchall(), before)
            self.assertEqual(db.execute("SELECT rowid FROM dict_search_fts WHERE dict_search_fts MATCH 'Diamond'").fetchall(), [(7,)])
            self.assertEqual(db.execute("SELECT rowid FROM dict_search_fts WHERE dict_search_fts MATCH 'Copper'").fetchall(), [])

    def test_stale_delete_rejects_reused_rowid(self):
        self.source([self.rows[0]])
        self.diff()
        with closing(sqlite3.connect(self.path / "baseline.db")) as db:
            self.replace_pair(db, 21)
            before = db.execute("SELECT rowid,* FROM dict_search ORDER BY rowid").fetchall()
            with self.assertRaises(sqlite3.IntegrityError):
                db.executescript((self.path / "delta.sql").read_text(encoding="utf-8"))
            self.assertEqual(db.execute("SELECT rowid,* FROM dict_search ORDER BY rowid").fetchall(), before)
            self.assertEqual(db.execute("SELECT rowid FROM dict_search_fts WHERE dict_search_fts MATCH 'Diamond'").fetchall(), [(21,)])

    def test_update_checks_old_metadata_even_when_pair_identity_matches(self):
        self.source([*self.rows, ("铜锭", "Copper", "example", "2", "item.copper", "")])
        self.diff()
        with closing(sqlite3.connect(self.path / "baseline.db")) as db:
            db.execute("UPDATE dict_search SET all_keys='manual.edit' WHERE rowid=7")
            db.commit()
            with self.assertRaises(sqlite3.IntegrityError):
                db.executescript((self.path / "delta.sql").read_text(encoding="utf-8"))
            self.assertEqual(db.execute("SELECT all_keys,all_mods FROM dict_search WHERE rowid=7").fetchone(),
                             ("manual.edit", "example (1)"))

    def test_missing_update_is_a_conflict_not_a_successful_noop(self):
        self.source([*self.rows, ("铜锭", "Copper", "example", "2", "item.copper", "")])
        self.diff()
        with closing(sqlite3.connect(self.path / "baseline.db")) as db:
            db.execute("DELETE FROM dict_search WHERE rowid=7")
            db.commit()
            with self.assertRaises(sqlite3.IntegrityError):
                db.executescript((self.path / "delta.sql").read_text(encoding="utf-8"))
            self.assertIsNone(db.execute("SELECT * FROM dict_search WHERE rowid=7").fetchone())

    def test_insert_conflict_does_not_overwrite_existing_row(self):
        self.source([*self.rows, ("新矿石", "New ore", "newmod", "1", "item.new", "")])
        self.diff()
        with closing(sqlite3.connect(self.path / "baseline.db")) as db:
            db.execute("INSERT INTO dict_search(rowid,origin_name,trans_name,all_mods) VALUES(22,'Other','其他','othermod (1)')")
            db.commit()
            with self.assertRaises(sqlite3.IntegrityError):
                db.executescript((self.path / "delta.sql").read_text(encoding="utf-8"))
            self.assertEqual(db.execute("SELECT origin_name FROM dict_search WHERE rowid=22").fetchone(), ("Other",))
            self.assertEqual(db.execute("SELECT rowid FROM dict_search_fts WHERE dict_search_fts MATCH 'Other'").fetchall(), [(22,)])


if __name__ == "__main__":
    unittest.main()
