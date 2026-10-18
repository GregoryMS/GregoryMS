import datetime as dt
import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'update_drivebc_signs.py'
spec = importlib.util.spec_from_file_location('drivebc_signs', SCRIPT)
signs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signs)
NOW = dt.datetime(2026, 10, 18, 2, 10, tzinfo=dt.timezone.utc)


class DriveBCSignsTests(unittest.TestCase):
    def test_snapshot_validates_locations_deduplicates_and_preserves_plain_text(self):
        good = {'id': 'DMS_1', 'name': '<img onerror=alert(1)>', 'message_display_1': 'ROAD\nWORK', 'location': {'type': 'Point', 'coordinates': [-123.3, 49.1]}, 'is_on': False}
        data = signs.build([good, good, {'id': 'bad', 'location': {'type': 'Point', 'coordinates': [0, 0]}}], NOW)
        self.assertEqual(len(data['signs']), 1)
        self.assertEqual(data['signs'][0]['name'], good['name'])
        self.assertFalse(data['signs'][0]['is_on'])
        self.assertEqual(data['fetchedAt'], NOW.isoformat())
        self.assertEqual(data['source'], 'https://www.drivebc.ca/api/dms/')

    def test_rejects_invalid_or_empty_feed_without_replacing_previous_snapshot(self):
        for data in [None, {}, [], [{'id': 'broken'}]]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                signs.build(data, NOW)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'signs.json'
            source = Path(directory) / 'bad.json'
            output.write_text('previous data')
            source.write_text('{}')
            result = subprocess.run([sys.executable, str(SCRIPT), '--input', str(source), '--output', str(output)], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(output.read_text(), 'previous data')


if __name__ == '__main__':
    unittest.main()
