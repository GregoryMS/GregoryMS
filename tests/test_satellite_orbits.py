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
