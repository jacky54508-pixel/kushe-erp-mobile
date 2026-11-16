"""P40-16L — real headless Chromium IndexedDB/localStorage storage test.

All browser requests use local CI origin 127.0.0.1:8797 and a Playwright
route-backed Python in-memory CAS fake server. Never touches real KuShe ERP,
user IndexedDB, or Supabase. 'ledgerVersion' is a hypothetical future fence.
"""
from __future__ import annotations
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, Error as PlaywrightError

ORIGIN="http://127.0.0.1:8797"
FIXTURE=ORIGIN+"/.p40-16l-tests/browser_fixture.html"
assert urlparse(FIXTURE).hostname=="127.0.0.1"


def digest(data):
    return hashlib.sha256(json.dumps(data,ensure_ascii=False,separators=(",",":")).encode()).hexdigest()


def initial_data():
    return {
        "original":{"documentId":"SYNTHETIC-BILLING","untaxed":602000,
                    "tax":30100,"gross":632100,"retention":0,"receivable":632100,
                    "sourceIds":["SYNTHETIC-A","SYNTHETIC-B"]},
        "ui":{"note":"synthetic baseline"}
    }


class FakeCloud:
    def __init__(self):
        self.sync=1
        self.ledger=0
        self.data=initial_data()
        self.get_count=0
        self.offline_contexts=set()
        self.drop_next_response=False
        self.mutate_on_get=0
        self.post_count=0
        self.forbidden_financial_write=0
    def state(self):
        return {"syncVersion":self.sync,"ledgerVersion":self.ledger,
                "fingerprint":digest(self.data),"data":copy.deepcopy(self.data)}
    def ledger_event(self):
        self.ledger+=1
    def other_client_update(self,note):
        self.data["ui"]["note"]=note
        self.sync+=1
    def attach(self,context,label):
        def serve(route):
            request=route.request
            url=urlparse(request.url)
            if url.hostname not in ("localhost","127.0.0.1") or not url.path.startswith("/api/"):
                raise AssertionError("Nonlocal or unauthorized API request")
            if label in self.offline_contexts:
                route.abort("internetdisconnected")
                return
            if url.path=="/api/state" and request.method=="GET":
                self.get_count+=1
                if self.mutate_on_get==self.get_count:
                    self.ledger_event()
                    self.mutate_on_get=0
                route.fulfill(status=200,content_type="application/json",
                    body=json.dumps(self.state(),separators=(",",":")))
                return
            if url.path=="/api/cas" and request.method=="POST":
                body=json.loads(request.post_data or "{}")
                if body.get("operation")!="SYNTHETIC-UI-ONLY":
                    self.forbidden_financial_write+=1
                    route.fulfill(status=403,body='{"status":"DENIED"}',
                        content_type="application/json")
                    return
                if body.get("expectedSync")!=self.sync or body.get("expectedLedger")!=self.ledger:
                    route.fulfill(status=409,content_type="application/json",
                                  body='{"status":"CONFLICT"}')
                    return
                new=body.get("data")
                if not isinstance(new,dict) or sorted(new)!=["original","ui"] or (
                    new["original"]!=initial_data()["original"]) or (
                    sorted(new["ui"])!=["note"]) or not isinstance(new["ui"]["note"],str):
                    self.forbidden_financial_write+=1
                    route.fulfill(status=403,body='{"status":"DENIED"}',
                                  content_type="application/json")
                    return
                self.data=copy.deepcopy(new);self.sync+=1;self.post_count+=1
                response={"status":"APPLIED","syncVersion":self.sync,
                          "ledgerVersion":self.ledger}
                if self.drop_next_response:
                    self.drop_next_response=False
                    route.abort("failed")
                    return
                route.fulfill(status=200,content_type="application/json",
                    body=json.dumps(response,separators=(",",":")))
                return
            raise AssertionError("Unsupported fixture endpoint")
        context.route("**/api/**",serve)


class NativeStorageAndRecovery(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright=sync_playwright().start()
        cls.browser=cls.playwright.chromium.launch(headless=True,
                        args=["--no-sandbox","--disable-dev-shm-usage"])
    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
    def setUp(self):
        self.cloud=FakeCloud()
        self.contexts=[]
        self.pc=self.open_page("SYNTH-PC")
        self.eval(self.pc,"() => p40l.init()")
    def tearDown(self):
        for context in reversed(self.contexts):
            context.close()
    def open_page(self,label):
        ctx=self.browser.new_context(accept_downloads=True)
        self.contexts.append(ctx)
        self.cloud.attach(ctx,label)
        page=ctx.new_page()
        page.goto(FIXTURE,wait_until="load")
        page.wait_for_function("typeof window.p40l === 'object'")
        return page
    @staticmethod
    def eval(page,source,arg=None):
        return page.evaluate(source) if arg is None else page.evaluate(source,arg)
    def phone(self):
        p=self.open_page("SYNTH-PHONE")
        self.eval(p,"() => p40l.init()")
        return p
    def read_export(self,page):
        with page.expect_download() as info:
            token=self.eval(page,"() => p40l.exportBackup()")
        download=info.value
        self.assertEqual(download.suggested_filename,"P40L_SYNTHETIC_backup.json")
        with tempfile.TemporaryDirectory() as path:
            name=str(Path(path)/"snapshot.json")
            download.save_as(name)
            raw=Path(name).read_text(encoding="utf-8")
        obj=json.loads(raw)
        self.assertEqual(obj["fingerprint"],token)
        self.assertEqual(obj["schema"],"P40L_BACKUP_V1")
        self.assertEqual(digest(obj["state"]),token)
        return raw

    def test_real_idb_and_emergency_persist_after_full_page_reload(self):
        self.assertEqual(self.eval(self.pc,"() => p40l.localEdit('desktop input')"),"LOCAL_COMMITTED")
        before=self.eval(self.pc,"() => p40l.inspect()")
        self.assertEqual(before["journal"]["phase"],"COMMIT_VERIFIED")
        self.assertEqual(json.loads(before["emergency"]),before["state"])
        self.pc.reload(wait_until="load")
        self.assertEqual(self.eval(self.pc,"() => p40l.init()")["status"],"READY")
        after=self.eval(self.pc,"() => p40l.inspect()")
        self.assertEqual(after["state"]["data"]["ui"]["note"],"desktop input")
        self.assertEqual(before["token"],after["token"])
        self.assertEqual(after["state"],json.loads(after["emergency"]))

    def test_native_profile_survives_closing_chromium_and_reopening(self):
        with tempfile.TemporaryDirectory() as profile:
            ctx=self.playwright.chromium.launch_persistent_context(
                profile,headless=True,accept_downloads=True,args=["--no-sandbox"])
            self.cloud.attach(ctx,"SYNTH-PERSISTENT")
            page=ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto(FIXTURE)
            self.eval(page,"() => p40l.init()")
            self.eval(page,"() => p40l.localEdit('persistent user profile')")
            ctx.close()
            # Real Chrome process and persistent profile are reopened; no test
            # state is injected through context.add_init_script or cookies.
            ctx=self.playwright.chromium.launch_persistent_context(
                profile,headless=True,args=["--no-sandbox"])
            self.cloud.attach(ctx,"SYNTH-PERSISTENT")
            page=ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto(FIXTURE)
            self.assertEqual(self.eval(page,"() => p40l.init()")["status"],"READY")
            self.assertEqual(self.eval(page,"() => p40l.verified()")["data"]["ui"]["note"],
                "persistent user profile")
            ctx.close()

    def test_offline_changes_persist_and_upload_after_network_restored(self):
        self.cloud.offline_contexts.add("SYNTH-PC")
        self.contexts[0].set_offline(True)
        self.eval(self.pc,"() => p40l.localEdit('offline note')")
        self.assertIn(self.eval(self.pc,"() => p40l.status()")["status"],
                      ("NETWORK_ERROR_OR_UNKNOWN_COMMIT","NETWORK_ERROR"))
        with self.assertRaises(PlaywrightError):
            self.eval(self.pc,"() => p40l.upload()")
        self.contexts[0].set_offline(False)
        self.cloud.offline_contexts.remove("SYNTH-PC")
        self.assertEqual(self.eval(self.pc,"() => p40l.status()")["status"],"LOCAL_NEWER")
        self.assertEqual(self.eval(self.pc,"() => p40l.upload()"),"UPLOAD_VERIFIED")
        self.assertEqual(self.cloud.data["ui"]["note"],"offline note")
        self.assertEqual(self.eval(self.pc,"() => p40l.status()")["status"],"SYNCED")

    def test_real_isolated_profiles_compete_for_one_fake_cloud_CAS(self):
        mobile=self.phone()
        self.eval(self.pc,"() => p40l.localEdit('from PC')")
        self.eval(mobile,"() => p40l.localEdit('from phone')")
        self.assertEqual(self.eval(mobile,"() => p40l.upload()"),"UPLOAD_VERIFIED")
        with self.assertRaises(PlaywrightError):
            self.eval(self.pc,"() => p40l.upload()")
        self.assertEqual(self.eval(self.pc,"() => p40l.status()")["status"],
                         "CONFLICT_NO_AUTO_OVERWRITE")
        self.assertEqual(self.cloud.data["ui"]["note"],"from phone")
        self.assertEqual(self.eval(self.pc,"() => p40l.verified()")["data"]["ui"]["note"],
                         "from PC")

    def test_new_ledger_revision_rejects_offline_stale_browser(self):
        self.eval(self.pc,"() => p40l.localEdit('offline old')")
        self.cloud.ledger_event()
        with self.assertRaises(PlaywrightError):
            self.eval(self.pc,"() => p40l.upload()")
        self.assertEqual(self.cloud.sync,1)
        self.assertEqual(self.cloud.ledger,1)
        self.assertEqual(self.eval(self.pc,"() => p40l.status()")["status"],
                         "CONFLICT_NO_AUTO_OVERWRITE")

    def test_network_response_lost_after_server_commit_requires_reverification(self):
        self.eval(self.pc,"() => p40l.localEdit('committed but response lost')")
        self.cloud.drop_next_response=True
        with self.assertRaises(PlaywrightError):
            self.eval(self.pc,"() => p40l.upload()")
        self.assertEqual(self.cloud.sync,2)
        self.assertTrue(self.eval(self.pc,"() => p40l.verified()")["dirty"])
        self.assertEqual(self.eval(self.pc,"() => p40l.resolveUnknownUpload()"),
                         "VERIFIED_AFTER_UNKNOWN_COMMIT")
        self.assertEqual(self.eval(self.pc,"() => p40l.status()")["status"],"SYNCED")
        self.assertEqual(self.cloud.post_count,1)

    def test_ambiguous_upload_does_not_claim_success_after_newer_other_write(self):
        self.eval(self.pc,"() => p40l.localEdit('pending')")
        self.cloud.drop_next_response=True
        with self.assertRaises(PlaywrightError):self.eval(self.pc,"() => p40l.upload()")
        self.cloud.other_client_update("newer write")
        self.assertEqual(self.eval(self.pc,"() => p40l.resolveUnknownUpload()"),
                         "CONFLICT_NO_AUTO_OVERWRITE")
        self.assertTrue(self.eval(self.pc,"() => p40l.verified()")["dirty"])

    def test_restore_requires_actual_download_and_user_armed_marker(self):
        phone=self.phone()
        self.eval(phone,"() => p40l.localEdit('newer cloud')")
        self.eval(phone,"() => p40l.upload()")
        self.assertEqual(self.eval(self.pc,"() => p40l.status()")["status"],
                         "REMOTE_NEWER_BACKUP_REQUIRED")
        with self.assertRaises(PlaywrightError):
            self.eval(self.pc,"() => p40l.restoreRemote()")
        prior=self.eval(self.pc,"() => p40l.verified()")["data"]["ui"]["note"]
        self.assertEqual(prior,"synthetic baseline")
        raw=self.read_export(self.pc)
        self.assertEqual(self.eval(self.pc,"f => p40l.armRestore(f)",raw),"BACKUP_CONFIRMED")
        self.assertEqual(self.eval(self.pc,"() => p40l.restoreRemote()"),"RESTORE_VERIFIED")
        info=self.eval(self.pc,"() => p40l.inspect()")
        self.assertEqual(info["state"]["data"]["ui"]["note"],"newer cloud")
        self.assertEqual(info["state"],json.loads(info["emergency"]))
        self.assertEqual(info["journal"]["phase"],"COMMIT_VERIFIED")
        self.assertIsNone(info["marker"])
        self.assertEqual(self.eval(self.pc,"() => p40l.status()")["status"],"SYNCED")

    def test_broken_restore_after_real_idb_write_blocks_reopen_until_explicit_backup(self):
        phone=self.phone()
        self.eval(phone,"() => p40l.localEdit('newer cloud')");self.eval(phone,"() => p40l.upload()")
        raw=self.read_export(self.pc)
        self.eval(self.pc,"f => p40l.armRestore(f)",raw)
        with self.assertRaises(PlaywrightError):
            self.eval(self.pc,"() => p40l.restoreRemote({failAt:'AFTER_IDB'})")
        self.pc.reload(wait_until="load")
        with self.assertRaises(PlaywrightError):
            self.eval(self.pc,"() => p40l.init()")
        state=self.eval(self.pc,"() => p40l.inspect()")
        self.assertEqual(state["journal"]["phase"],"PRIMARY_WRITTEN")
        self.assertEqual(state["state"]["data"]["ui"]["note"],"newer cloud")
        self.assertEqual(json.loads(state["emergency"])["data"]["ui"]["note"],
                         "synthetic baseline")
        self.assertEqual(self.eval(self.pc,"f => p40l.recoverExplicitBackup(f)",raw),
                         "EXPLICIT_SYNTHETIC_BACKUP_RECOVERED")
        self.assertEqual(self.eval(self.pc,"() => p40l.verified()")["data"]["ui"]["note"],
                         "synthetic baseline")
        self.assertEqual(self.eval(self.pc,"() => p40l.status()")["status"],
                         "REMOTE_NEWER_BACKUP_REQUIRED")

    def test_broken_restore_after_emergency_write_does_not_silently_repair(self):
        phone=self.phone()
        self.eval(phone,"() => p40l.localEdit('cloud value')");self.eval(phone,"() => p40l.upload()")
        raw=self.read_export(self.pc)
        self.eval(self.pc,"f => p40l.armRestore(f)",raw)
        with self.assertRaises(PlaywrightError):
            self.eval(self.pc,"() => p40l.restoreRemote({failAt:'AFTER_EMERGENCY'})")
        self.pc.reload()
        self.assertEqual(self.eval(self.pc,"() => p40l.status()")["status"],"STORE_JOURNAL_PENDING")
        self.assertEqual(self.eval(self.pc,"f => p40l.recoverExplicitBackup(f)",raw),
                         "EXPLICIT_SYNTHETIC_BACKUP_RECOVERED")

    def test_backups_verify_sha_and_reject_forged_modified_backup(self):
        raw=self.read_export(self.pc)
        wrong=json.loads(raw)
        wrong["state"]["data"]["original"]["gross"]=600000
        with self.assertRaises(PlaywrightError):
            self.eval(self.pc,"v => p40l.armRestore(v)",json.dumps(wrong))

    def test_backup_marker_time_binding_and_remote_ledger_update(self):
        phone=self.phone()
        self.eval(phone,"() => p40l.localEdit('cloud changed')");self.eval(phone,"() => p40l.upload()")
        raw=self.read_export(self.pc)
        self.eval(self.pc,"f => p40l.armRestore(f)",raw)
        self.cloud.ledger_event()
        with self.assertRaises(PlaywrightError):
            self.eval(self.pc,"() => p40l.restoreRemote()")
        self.cloud.ledger-=1
        self.eval(self.pc,"() => {const k='P40L_SYNTH_MARKER';let m=JSON.parse(localStorage.getItem(k));m.createdAt-=3600000;localStorage.setItem(k,JSON.stringify(m));}")
        with self.assertRaises(PlaywrightError):
            self.eval(self.pc,"() => p40l.restoreRemote()")

    def test_concurrent_change_between_two_remote_reads_blocks_restore(self):
        phone=self.phone()
        self.eval(phone,"() => p40l.localEdit('remote recent')");self.eval(phone,"() => p40l.upload()")
        raw=self.read_export(self.pc)
        self.eval(self.pc,"f => p40l.armRestore(f)",raw)
        self.cloud.mutate_on_get=self.cloud.get_count+2
        before=self.eval(self.pc,"() => p40l.verified()")
        with self.assertRaises(PlaywrightError):
            self.eval(self.pc,"() => p40l.restoreRemote()")
        self.assertEqual(self.eval(self.pc,"() => p40l.verified()"),before)

    def test_corrupted_mirror_or_token_blocks_all_writes(self):
        for layer in ("emergency","token"):
            with self.subTest(layer=layer):
                pc=self.pc if layer=="emergency" else self.open_page("SYNTH-SECOND")
                self.eval(pc,"() => p40l.init()")
                self.eval(pc,"layer => p40l.tamper(layer)",layer)
                with self.assertRaises(PlaywrightError):
                    self.eval(pc,"() => p40l.localEdit('should not write')")
                self.assertEqual(self.eval(pc,"() => p40l.status()")["status"],
                                 "STORE_LAYERS_DIVERGED")

    def test_dirty_editor_refuses_export_or_upload(self):
        self.eval(self.pc,"() => p40l.localEdit('saved locally')")
        self.eval(self.pc,"() => p40l.setEditorDirty(true)")
        with self.assertRaises(PlaywrightError):
            self.eval(self.pc,"() => p40l.upload()")
        with self.assertRaises(PlaywrightError):
            self.eval(self.pc,"() => p40l.exportBackup()")
        self.assertEqual(self.eval(self.pc,"() => p40l.status()")["status"],"EDITOR_DIRTY")

    def test_temporary_device_cloud_only_and_no_local_idb_records(self):
        tmp=self.open_page("SYNTH-TEMP")
        self.eval(tmp,"() => p40l.init({temporary:true})")
        self.assertEqual(self.eval(tmp,"() => p40l.status()")["status"],
                         "TEMPORARY_CLOUD_ONLY")
        with self.assertRaises(PlaywrightError):
            self.eval(tmp,"() => p40l.localEdit('not durable')")
        info=self.eval(tmp,"() => p40l.inspect()")
        self.assertIsNone(info["state"])
        self.assertIsNone(info["emergency"])
        self.assertIsNone(info["token"])

    def test_synthetic_financial_original_unchanged_and_no_production_post(self):
        phone=self.phone()
        self.eval(phone,"() => p40l.localEdit('nonfinancial note')")
        self.eval(phone,"() => p40l.upload()")
        self.assertEqual(self.cloud.data["original"],initial_data()["original"])
        self.assertEqual(self.cloud.forbidden_financial_write,0)
        self.assertEqual(self.cloud.post_count,1)
        self.assertEqual(self.cloud.ledger,0)


if __name__=="__main__":
    unittest.main(verbosity=2)
