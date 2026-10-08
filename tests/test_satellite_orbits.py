import datetime as dt
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

SPEC = importlib.util.spec_from_file_location("satellite_updater", Path(__file__).resolve().parent.parent / "scripts/update_satellite_orbits.py")
UPDATER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(UPDATER)
SNAPSHOT = json.loads((Path(__file__).resolve().parent.parent / "data/satellite-orbits.json").read_text())

class RefreshTests(unittest.TestCase):
    def recent_snapshot(self, now):
        return dict(SNAPSHOT, retrieved_at=(now - dt.timedelta(hours=6)).isoformat(),
                    satellites=[dict(row, EPOCH=(now - dt.timedelta(hours=12)).replace(tzinfo=None).isoformat())
                                for row in SNAPSHOT["satellites"]])

    def response(self, row):
        response = io.StringIO(json.dumps([row]))
        response.status = 200
        return response

    def test_transient_outage_preserves_recent_snapshot_and_stops_requests(self):
        errors = [urllib.error.HTTPError("url", code, "Unavailable", None, None)
                  for code in (500, 502, 503, 504)]
        errors += [urllib.error.URLError("Connection reset"), TimeoutError("Timed out")]
        for error in errors:
            with self.subTest(error=error), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                (root / "data").mkdir()
                target = root / "data/satellite-orbits.json"
                snapshot = self.recent_snapshot(dt.datetime.now(dt.timezone.utc))
                original = json.dumps(snapshot)
                target.write_text(original)
                # A newer first record must not be published as a partial refresh.
                first = dict(snapshot["satellites"][0], MEAN_ANOMALY=100)
                with patch.object(UPDATER, "__file__", str(root / "scripts/update.py")), \
                     patch.object(UPDATER.time, "sleep"), \
                     patch.object(UPDATER.urllib.request, "build_opener") as opener, \
                     patch("sys.stdout", new_callable=io.StringIO) as output:
                    opener.return_value.open.side_effect = [self.response(first), error]
                    UPDATER.main()
                    self.assertEqual(opener.return_value.open.call_count, 2)
                    self.assertIn("::warning::", output.getvalue())
                self.assertEqual(target.read_text(), original)
                self.assertFalse(target.with_suffix(".tmp").exists())

    def test_permanent_errors_and_invalid_responses_still_fail_with_recent_snapshot(self):
        errors = [urllib.error.HTTPError("url", code, "Rejected", None, None)
                  for code in (301, 403, 404, 429)]
        errors += [ValueError("Provider redirected the request"),
                   json.JSONDecodeError("Invalid JSON", "html", 0)]
        for error in errors:
            with self.subTest(error=error), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                (root / "data").mkdir()
                target = root / "data/satellite-orbits.json"
                original = json.dumps(self.recent_snapshot(dt.datetime.now(dt.timezone.utc)))
                target.write_text(original)
                with patch.object(UPDATER, "__file__", str(root / "scripts/update.py")), \
                     patch.object(UPDATER.urllib.request, "build_opener") as opener:
                    opener.return_value.open.side_effect = error
                    with self.assertRaises(type(error)):
                        UPDATER.main()
                    self.assertEqual(opener.return_value.open.call_count, 1)
                self.assertEqual(target.read_text(), original)

    def test_unusable_cache_does_not_hide_provider_failure(self):
        now = dt.datetime.now(dt.timezone.utc)
        fresh = self.recent_snapshot(now)
        bad_rows = [[], fresh["satellites"][:-1], [fresh["satellites"][0]] * 5]
        for changes in ({"EPOCH": (now - dt.timedelta(hours=49)).isoformat()},
                        {"MEAN_MOTION": "invalid"}, {"ECCENTRICITY": 2}, {"EPOCH": "invalid"}):
            bad_rows.append([dict(fresh["satellites"][0], **changes), *fresh["satellites"][1:]])
        snapshots = [None, "invalid JSON", "null", "{}"]
        snapshots += [json.dumps(dict(fresh, satellites=rows)) for rows in bad_rows]
        snapshots += [json.dumps(dict(fresh, retrieved_at=value)) for value in (
            (now - dt.timedelta(hours=49)).isoformat(), (now + dt.timedelta(hours=1)).isoformat(),
            now.replace(tzinfo=None).isoformat(), "invalid")]
        for snapshot in snapshots:
            with self.subTest(snapshot=snapshot), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                (root / "data").mkdir()
                target = root / "data/satellite-orbits.json"
                if snapshot is not None:
                    target.write_text(snapshot)
                with patch.object(UPDATER, "__file__", str(root / "scripts/update.py")), \
                     patch.object(UPDATER.urllib.request, "build_opener") as opener:
                    opener.return_value.open.side_effect = urllib.error.HTTPError("url", 500, "Unavailable", None, None)
                    with self.assertRaises(urllib.error.HTTPError):
                        UPDATER.main()
                    self.assertEqual(opener.return_value.open.call_count, 1)
                self.assertEqual(target.read_text() if target.exists() else None, snapshot)

    def test_success_publishes_all_five_records_and_unchanged_records_keep_timestamp(self):
        snapshot = self.recent_snapshot(dt.datetime.now(dt.timezone.utc))
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "data").mkdir()
            target = root / "data/satellite-orbits.json"
            with patch.object(UPDATER, "__file__", str(root / "scripts/update.py")), \
                 patch.object(UPDATER.time, "sleep"), \
                 patch.object(UPDATER.urllib.request, "build_opener") as opener:
                opener.return_value.open.side_effect = [self.response(row) for row in snapshot["satellites"]]
                UPDATER.main()
                original = target.read_text()
                self.assertEqual(json.loads(original)["satellites"], snapshot["satellites"])
                opener.return_value.open.side_effect = [self.response(row) for row in snapshot["satellites"]]
                UPDATER.main()
                self.assertEqual(target.read_text(), original)

    def test_provider_failure_stops_requests_and_preserves_the_published_file(self):
        now = dt.datetime.now(dt.timezone.utc)
        row = dict(SNAPSHOT["satellites"][0], EPOCH=now.replace(tzinfo=None).isoformat())
        response = io.StringIO(json.dumps([row]))
        response.status = 200
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "data").mkdir()
            target = root / "data/satellite-orbits.json"
            target.write_text("previous orbit snapshot")
            with patch.object(UPDATER, "__file__", str(root / "scripts/update.py")), \
                 patch.object(UPDATER.time, "sleep"), \
                 patch.object(UPDATER.urllib.request, "build_opener") as opener:
                opener.return_value.open.side_effect = [response, urllib.error.HTTPError("url", 503, "Unavailable", None, None)]
                with self.assertRaises(urllib.error.HTTPError):
                    UPDATER.main()
                self.assertEqual(opener.return_value.open.call_count, 2)
            self.assertEqual(target.read_text(), "previous orbit snapshot")

    def test_redirects_stop_instead_of_following_outdated_feed_urls(self):
        with self.assertRaises(ValueError):
            UPDATER.NoRedirect().redirect_request(None, None, 301, "Moved", None, "https://example.com")

if __name__ == "__main__":
    unittest.main()
