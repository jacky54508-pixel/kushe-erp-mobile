"""P40-16E: real PostgreSQL transactional simulation with FAKE records ONLY.

Connection deliberately restricted to a localhost PostgreSQL GitHub Actions service.
Not a Supabase schema migration, not a production data connector, not posting code.
"""
from __future__ import annotations

import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import threading
import unittest

import psycopg
from psycopg.errors import UniqueViolation


DSN = os.environ.get("P40E_CI_DSN", "")
if not DSN or any(x in DSN.lower() for x in (
    "supabase", "aws", "pooler", "db.", ".com", ".net"
)):
    raise RuntimeError("P40-16E requires an explicitly configured LOCAL ephemeral PostgreSQL DSN")
from urllib.parse import urlsplit
DSN_PARTS = urlsplit(DSN)
if DSN_PARTS.hostname not in ("127.0.0.1", "localhost") or DSN_PARTS.path != "/p40_16e_ci":
    raise RuntimeError("P40-16E refuses to connect outside the local ephemeral CI database")


class GateError(Exception):
    pass


def connect():
    return psycopg.connect(DSN, connect_timeout=8)


def doc_snapshot(conn, doc_id):
    row = conn.execute(
        "SELECT revision,snapshot_token,original_gross FROM p40_16e_lab.synthetic_documents "
        "WHERE document_id=%s FOR UPDATE", (doc_id,)
    ).fetchone()
    if row is None:
        raise GateError("Unknown synthetic source document")
    return row


def fingerprint(data):
    payload = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


FIELDS = ("net", "tax", "gross", "retention", "receivable")


def checked_split(rows):
    if not isinstance(rows, list) or not (1 <= len(rows) <= 30):
        raise GateError("Missing source allocation rows")
    ids = set()
    totals = {k: 0 for k in FIELDS}
    for row in rows:
        bid = row.get("billing_id")
        if not isinstance(bid, str) or len(bid) < 2 or bid in ids:
            raise GateError("Missing or duplicated original billing ID")
        ids.add(bid)
        for key in FIELDS:
            val = row.get(key)
            if type(val) is not int or not (0 <= val <= (2**63 - 1)):
                raise GateError("Non-integer / negative source adjustment")
            totals[key] += val
        if not (row["gross"] > 0 and row["net"] + row["tax"] == row["gross"]
                and row["gross"] - row["retention"] == row["receivable"]):
            raise GateError("Unbalanced source adjustment")
    if totals["net"] + totals["tax"] != totals["gross"] or (
        totals["gross"] - totals["retention"] != totals["receivable"]
    ):
        raise GateError("Unbalanced total adjustment")
    if any(x > 2**63 - 1 for x in totals.values()):
        raise GateError("Amount outside PostgreSQL BIGINT range")
    return totals


def apply_allowance(
    doc_id: str, event_id: str, operation_key: str, expected_revision: int,
    expected_snapshot: str, allocations: list[dict], evidence_reviewed: bool = False,
):
    """One real *ephemeral test database* transaction; zero real ERP financial writes.

    A true production design still requires separate accounting approval,
    identity/permission model and correct production data binding.
    """
    if evidence_reviewed is not True:
        raise GateError("Synthetic document review gate not acknowledged")
    if min(len(doc_id), len(event_id), len(operation_key), len(expected_snapshot)) < 2:
        raise GateError("Missing event identity")
    totals = checked_split(allocations)
    content = {
        "kind": "SIMULATED_ALLOWANCE",
        "doc": doc_id,
        "snapshot": expected_snapshot,
        "allocation": allocations,
        "totals": totals,
    }
    sig = fingerprint(content)
    with connect() as conn:
        conn.execute("SET LOCAL lock_timeout = '8s'")
        revision, live_snapshot, original_gross = doc_snapshot(conn, doc_id)
        if live_snapshot != expected_snapshot:
            raise GateError("Stale source snapshot")
        old = conn.execute(
            "SELECT event_id,document_id,event_kind,payload_sha256 "
            "FROM p40_16e_lab.synthetic_events WHERE operation_key=%s", (operation_key,)
        ).fetchone()
        if old:
            if (old[0], old[1], old[2], old[3].strip()) != (
                event_id, doc_id, "SIMULATED_ALLOWANCE", sig
            ):
                raise GateError("Duplicate operation key with conflicting payload")
            return "replay"
        if revision != expected_revision:
            raise GateError("CAS revision conflict")
        prior = conn.execute(
            "SELECT count(*) FROM p40_16e_lab.synthetic_events WHERE document_id=%s",
            (doc_id,),
        ).fetchone()[0]
        if prior:
            raise GateError("Document already has an adjustment history; manual review required")
        if totals["gross"] >= original_gross:
            raise GateError("Discount cannot consume original document total")
        conn.execute(
            "INSERT INTO p40_16e_lab.synthetic_events"
            "(event_id,operation_key,document_id,revision,event_kind,reverses_event_id,"
            "basis_snapshot,payload_sha256,gross_delta,net_delta,tax_delta,retention_delta,receivable_delta)"
            " VALUES (%s,%s,%s,%s,'SIMULATED_ALLOWANCE',NULL,%s,%s,%s,%s,%s,%s,%s)",
            (event_id, operation_key, doc_id, revision + 1, expected_snapshot, sig,
             totals["gross"], totals["net"], totals["tax"],
             totals["retention"], totals["receivable"]),
        )
        for item in allocations:
            conn.execute(
                "INSERT INTO p40_16e_lab.synthetic_event_allocations "
                "(event_id,original_billing_id,gross_delta,net_delta,tax_delta,retention_delta,receivable_delta)"
                " VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (event_id, item["billing_id"], item["gross"], item["net"], item["tax"],
                 item["retention"], item["receivable"]),
            )
        result = conn.execute(
            "UPDATE p40_16e_lab.synthetic_documents SET revision=revision+1 "
            "WHERE document_id=%s AND revision=%s AND snapshot_token=%s",
            (doc_id, revision, expected_snapshot),
        )
        if result.rowcount != 1:
            raise GateError("CAS update failed")
    return "inserted-synthetic"


def apply_reversal(
    doc_id: str, parent_event_id: str, event_id: str, operation_key: str,
    expected_revision: int, expected_snapshot: str, reason: str,
):
    if not isinstance(reason, str) or len(reason.strip()) < 2:
        raise GateError("Missing reversal explanation")
    if min(len(doc_id), len(parent_event_id), len(event_id), len(operation_key)) < 2:
        raise GateError("Missing reversal identifiers")
    with connect() as conn:
        conn.execute("SET LOCAL lock_timeout = '8s'")
        revision, snapshot, _ = doc_snapshot(conn, doc_id)
        if snapshot != expected_snapshot:
            raise GateError("Stale reversal snapshot")
        parent = conn.execute(
            "SELECT event_kind,document_id,basis_snapshot,gross_delta,net_delta,tax_delta,"
            "retention_delta,receivable_delta FROM p40_16e_lab.synthetic_events "
            "WHERE event_id=%s", (parent_event_id,),
        ).fetchone()
        if not parent or parent[:3] != (
            "SIMULATED_ALLOWANCE", doc_id, expected_snapshot
        ):
            raise GateError("Original event missing or refers to different document")
        data = {
            "kind": "SIMULATED_REVERSAL",
            "doc": doc_id,
            "parent": parent_event_id,
            "snapshot": expected_snapshot,
            "reason": reason,
            "gross": parent[3],
        }
        sig = fingerprint(data)
        old = conn.execute(
            "SELECT event_id,document_id,event_kind,payload_sha256 "
            "FROM p40_16e_lab.synthetic_events WHERE operation_key=%s", (operation_key,)
        ).fetchone()
        if old:
            if (old[0], old[1], old[2], old[3].strip()) != (
                event_id, doc_id, "SIMULATED_REVERSAL", sig
            ):
                raise GateError("Replayed reversal differs from original command")
            return "replay"
        if revision != expected_revision:
            raise GateError("CAS revision conflict")
        already = conn.execute(
            "SELECT event_id FROM p40_16e_lab.synthetic_events WHERE reverses_event_id=%s",
            (parent_event_id,),
        ).fetchone()
        if already:
            raise GateError("Already reversed: no second compensation allowed")
        conn.execute(
            "INSERT INTO p40_16e_lab.synthetic_events "
            "(event_id,operation_key,document_id,revision,event_kind,reverses_event_id,"
            "basis_snapshot,payload_sha256,gross_delta,net_delta,tax_delta,retention_delta,receivable_delta)"
            " VALUES (%s,%s,%s,%s,'SIMULATED_REVERSAL',%s,%s,%s,%s,%s,%s,%s,%s)",
            (event_id, operation_key, doc_id, revision + 1, parent_event_id, expected_snapshot,
             sig, *parent[3:]),
        )
        result = conn.execute(
            "UPDATE p40_16e_lab.synthetic_documents SET revision=revision+1 "
            "WHERE document_id=%s AND revision=%s AND snapshot_token=%s",
            (doc_id, revision, expected_snapshot),
        )
        if result.rowcount != 1:
            raise GateError("Reversal CAS update failed")
    return "reversed-synthetic"


def fake_allocations(suffix=""):
    # Purely invented allocations; not actual accountant-approved tax numbers.
    return [
        {"billing_id": "SYNTH-A" + suffix, "net": 20000, "tax": 1000,
         "gross": 21000, "retention": 0, "receivable": 21000},
        {"billing_id": "SYNTH-B" + suffix, "net": 10571, "tax": 529,
         "gross": 11100, "retention": 0, "receivable": 11100},
    ]


def fake_command(doc="SYNTH-DOC", event="SYNTH-EVENT-1", op="SYNTH-KEY-1", rev=0):
    return (doc, event, op, rev, "SYNTHETIC-SNAPSHOT", fake_allocations(doc), True)


def read_state(doc="SYNTH-DOC"):
    with connect() as conn:
        record = conn.execute(
            "SELECT revision FROM p40_16e_lab.synthetic_documents WHERE document_id=%s",
            (doc,),
        ).fetchone()
        events = conn.execute(
            "SELECT event_kind,gross_delta FROM p40_16e_lab.synthetic_events "
            "WHERE document_id=%s ORDER BY revision", (doc,)
        ).fetchall()
        alloc_count = conn.execute(
            "SELECT count(*) FROM p40_16e_lab.synthetic_event_allocations x "
            "JOIN p40_16e_lab.synthetic_events e ON e.event_id=x.event_id "
            "WHERE e.document_id=%s", (doc,)
        ).fetchone()[0]
    return record[0], events, alloc_count


class IsolatedDatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # ClientCursor sends a standalone multi-statement SQL file using simple query protocol.
        with connect() as conn:
            with conn.cursor(cursor_factory=psycopg.ClientCursor) as cur:
                cur.execute(Path(__file__).with_name("isolated_schema.sql").read_text())

    def setUp(self):
        with connect() as conn:
            conn.execute(
                "TRUNCATE p40_16e_lab.synthetic_event_allocations,"
                "p40_16e_lab.synthetic_events,p40_16e_lab.synthetic_documents CASCADE"
            )
            for name in ("SYNTH-DOC", "SYNTH-DOC-2", "SYNTH-DOC-3"):
                conn.execute(
                    "INSERT INTO p40_16e_lab.synthetic_documents "
                    "(document_id,snapshot_token,original_gross) VALUES (%s,%s,632100)",
                    (name, "SYNTHETIC-SNAPSHOT"),
                )

    def test_real_database_atomic_insert_and_replay(self):
        args = fake_command()
        self.assertEqual(apply_allowance(*args), "inserted-synthetic")
        self.assertEqual(read_state(), (1, [("SIMULATED_ALLOWANCE", 32100)], 2))
        self.assertEqual(apply_allowance(*args), "replay")
        self.assertEqual(read_state()[1], [("SIMULATED_ALLOWANCE", 32100)])

    def test_same_key_changed_payload_fails_even_with_stale_revision(self):
        args = fake_command()
        apply_allowance(*args)
        changed = fake_allocations("SYNTH-DOC")
        changed[0] = {**changed[0], "net": 19999, "tax": 1001}
        with self.assertRaises(GateError):
            apply_allowance(*args[:5], changed, True)
        with self.assertRaises(GateError):
            apply_allowance("SYNTH-DOC", "SYNTH-DIFFERENT-EVENT",
                            "SYNTH-KEY-1", 0, "SYNTHETIC-SNAPSHOT",
                            fake_allocations("SYNTH-DOC"), True)
        self.assertEqual(read_state()[0], 1)

    def test_same_key_simultaneous_threads_produce_only_one_event(self):
        barrier = threading.Barrier(2)
        args = fake_command()

        def call():
            barrier.wait(timeout=5)
            return apply_allowance(*args)

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(call) for _ in range(2)]
            results = [f.result(timeout=15) for f in futures]
        self.assertCountEqual(results, ["inserted-synthetic", "replay"])
        self.assertEqual(read_state(), (1, [("SIMULATED_ALLOWANCE", 32100)], 2))

    def test_stale_revision_concurrent_different_keys_blocks_second(self):
        barrier = threading.Barrier(2)

        def call(n):
            barrier.wait(timeout=5)
            return apply_allowance(*fake_command(event=f"SYNTH-EVENT-{n}",
                                                  op=f"SYNTH-KEY-{n}"))

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(call, i) for i in (1, 2)]
            results = []
            for future in futures:
                try:
                    results.append(future.result(timeout=15))
                except GateError:
                    results.append("CAS_REJECTED")
        self.assertCountEqual(results, ["inserted-synthetic", "CAS_REJECTED"])
        self.assertEqual(read_state()[0], 1)

    def test_cross_document_global_operation_key_uniqueness(self):
        args = fake_command()
        apply_allowance(*args)
        with self.assertRaises((GateError, UniqueViolation)):
            apply_allowance(*fake_command("SYNTH-DOC-2", "SYNTH-UNIQUE-2",
                                          "SYNTH-KEY-1"))
        self.assertEqual(read_state("SYNTH-DOC-2")[0], 0)

    def test_cross_document_simultaneous_unique_key_enforced_by_db(self):
        barrier = threading.Barrier(2)

        def call(name):
            barrier.wait(timeout=5)
            try:
                return apply_allowance(*fake_command(name, "EVENT-" + name, "ONE-GLOBAL-KEY"))
            except (GateError, UniqueViolation):
                return "CONFLICT"

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(call, n) for n in ("SYNTH-DOC-2", "SYNTH-DOC-3")]
            results = [f.result(timeout=15) for f in futures]
        self.assertCountEqual(results, ["inserted-synthetic", "CONFLICT"])

    def test_transaction_rollback_after_event_before_doc_version_update(self):
        with self.assertRaises(RuntimeError):
            with connect() as conn:
                conn.execute("SET LOCAL lock_timeout = '8s'")
                doc_snapshot(conn, "SYNTH-DOC")
                conn.execute(
                    "INSERT INTO p40_16e_lab.synthetic_events "
                    "(event_id,operation_key,document_id,revision,event_kind,"
                    "basis_snapshot,payload_sha256,gross_delta,net_delta,tax_delta,"
                    "retention_delta,receivable_delta)"
                    " VALUES ('SYNTH-CRASH','SYNTH-CRASH-KEY','SYNTH-DOC',1,"
                    "'SIMULATED_ALLOWANCE','SYNTHETIC-SNAPSHOT',%s,32100,30571,1529,0,32100)",
                    ("a" * 64,),
                )
                raise RuntimeError("Synthetic failure before document revision update")
        self.assertEqual(read_state(), (0, [], 0))

    def test_immutable_event_history_and_source_allocations(self):
        apply_allowance(*fake_command())
        for sql in (
            "UPDATE p40_16e_lab.synthetic_events SET gross_delta=1 "
            "WHERE event_id='SYNTH-EVENT-1'",
            "DELETE FROM p40_16e_lab.synthetic_events WHERE event_id='SYNTH-EVENT-1'",
            "UPDATE p40_16e_lab.synthetic_event_allocations SET gross_delta=1 "
            "WHERE event_id='SYNTH-EVENT-1'",
            "DELETE FROM p40_16e_lab.synthetic_event_allocations "
            "WHERE event_id='SYNTH-EVENT-1'",
        ):
            with self.assertRaises(psycopg.Error):
                with connect() as conn:
                    conn.execute(sql)
        self.assertEqual(read_state(), (1, [("SIMULATED_ALLOWANCE", 32100)], 2))

    def test_reversal_once_and_exact_replay(self):
        apply_allowance(*fake_command())
        rev = ("SYNTH-DOC", "SYNTH-EVENT-1", "SYNTH-REV-EVENT", "SYNTH-REV-KEY",
               1, "SYNTHETIC-SNAPSHOT", "Synthetic authorized cancellation")
        self.assertEqual(apply_reversal(*rev), "reversed-synthetic")
        self.assertEqual(apply_reversal(*rev), "replay")
        current, events, allocations = read_state()
        self.assertEqual(current, 2)
        self.assertEqual(events, [("SIMULATED_ALLOWANCE", 32100),
                                  ("SIMULATED_REVERSAL", 32100)])
        self.assertEqual(allocations, 2)
        net = sum(gross if kind == "SIMULATED_ALLOWANCE" else -gross
                  for kind, gross in events)
        self.assertEqual(net, 0)
        with self.assertRaises(GateError):
            apply_reversal("SYNTH-DOC", "SYNTH-EVENT-1", "SYNTH-REV-NEW",
                           "SYNTH-REV-KEY-2", 2, "SYNTHETIC-SNAPSHOT",
                           "Try second reversal")

    def test_competing_reversals_allow_only_one_compensation(self):
        apply_allowance(*fake_command())
        barrier = threading.Barrier(2)

        def attempt(n):
            barrier.wait(timeout=5)
            try:
                return apply_reversal("SYNTH-DOC", "SYNTH-EVENT-1",
                                      f"SYNTH-REV-EVT-{n}", f"SYNTH-REV-KEY-{n}",
                                      1, "SYNTHETIC-SNAPSHOT", "Synthetic cancellation")
            except (GateError, UniqueViolation):
                return "REJECTED"

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(attempt, n) for n in (1, 2)]
            results = [f.result(timeout=15) for f in futures]
        self.assertCountEqual(results, ["reversed-synthetic", "REJECTED"])
        self.assertEqual(read_state()[0], 2)

    def test_source_snapshot_conflict_and_cross_doc_reversal(self):
        apply_allowance(*fake_command())
        with connect() as conn:
            conn.execute(
                "UPDATE p40_16e_lab.synthetic_documents SET snapshot_token='CHANGED-SNAPSHOT'"
                " WHERE document_id='SYNTH-DOC'"
            )
        with self.assertRaises(GateError):
            apply_reversal("SYNTH-DOC", "SYNTH-EVENT-1", "SYNTH-REV-C",
                           "SYNTH-REV-C-KEY", 1, "SYNTHETIC-SNAPSHOT", "Check stale")
        with self.assertRaises(GateError):
            apply_reversal("SYNTH-DOC-2", "SYNTH-EVENT-1", "SYNTH-REV-CROSS",
                           "SYNTH-REV-CROSS-KEY", 0, "SYNTHETIC-SNAPSHOT",
                           "Cross doc not allowed")

    def test_bad_allocation_rejected_before_any_sql_write(self):
        bad = fake_allocations("SYNTH-DOC")
        bad[0]["tax"] = 1001
        with self.assertRaises(GateError):
            apply_allowance("SYNTH-DOC", "SYNTH-BAD", "SYNTH-BAD-KEY",
                            0, "SYNTHETIC-SNAPSHOT", bad, True)
        self.assertEqual(read_state(), (0, [], 0))

    def test_schema_has_no_invoice_bank_payroll_tables(self):
        with connect() as conn:
            rows = conn.execute(
                "SELECT tablename FROM pg_tables WHERE schemaname='p40_16e_lab'"
            ).fetchall()
        self.assertCountEqual(
            [r[0] for r in rows],
            ["synthetic_documents", "synthetic_events", "synthetic_event_allocations"],
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
