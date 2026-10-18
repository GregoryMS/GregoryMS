import datetime as dt
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'update_drivebc_ferries.py'
spec = importlib.util.spec_from_file_location('ferries', SCRIPT)
ferries = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ferries)
NOW = dt.datetime(2026, 10, 18, 2, 30, tzinfo=dt.timezone.utc)
INLAND = {'id': 1, 'route_name': 'Test crossing', 'location': {'type': 'Point', 'coordinates': [-119.67, 50.95]}, 'vessels': [{'name': 'Test boat', 'crossing_time_min': 6, 'vehicle_capacity': 10, 'schedule_detail': '<p>Service hours</p><ul><li>5:00 am &ndash; 3:00 am</li><li>12:05 pm</li></ul><script>alert(1)</script>'}], 'url': 'https://www2.gov.bc.ca/ferry', 'contact_phone': '2502652105'}
COASTAL = {'id': 2, 'name': 'Swartz Bay', 'location': {'type': 'Point', 'coordinates': [-123.41, 48.69]}, 'routes': [{'name': 'Victoria – Vancouver', 'url': 'https://www.bcferries.com/schedule'}]}


class DriveBCFerryTests(unittest.TestCase):
    def test_builds_coastal_and_inland_snapshot_with_plain_24_hour_schedules(self):
        data = ferries.build([INLAND, INLAND], [COASTAL], NOW)
        self.assertEqual(len(data['ferries']), 2)
        boat = next(item for item in data['ferries'] if item['kind'] == 'inland')
        self.assertEqual(boat['point'], [50.95, -119.67])
        self.assertEqual(boat['vessels'][0]['schedule'], 'Service hours\n05:00 – 03:00\n12:05')
        self.assertEqual(boat['vessels'][0]['crossing_time_min'], 6)
        self.assertEqual(ferries.hours24('12 am, 12 pm, 1:15 PM'), '00:00, 12:00, 13:15')
        self.assertEqual(data['fetchedAt'], NOW.isoformat())

    def test_rejects_bad_links_and_invalid_locations_without_inventing_routes(self):
        for url in ['javascript:alert(1)', 'https://www.bcferries.com.evil.test/', 'https://user@www.bcferries.com/', 'https://www.bcferries.com:bad/']:
            self.assertIsNone(ferries.link(url))
        self.assertIsNotNone(ferries.link('https://www.bcferries.com/routes-fares/schedules'))
        with self.assertRaises(ValueError):
            ferries.build([{**INLAND, 'location': {'type': 'Point', 'coordinates': [0, 0]}}], [COASTAL], NOW)

    def test_failed_or_partial_source_preserves_previous_snapshot(self):
        with self.assertRaises(ValueError):
            ferries.build([INLAND], [], NOW)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'inland.json').write_text(json.dumps([INLAND]))
            (root / 'coastal.json').write_text('{}')
            (root / 'output.json').write_text('previous snapshot')
            result = subprocess.run([sys.executable, str(SCRIPT), '--inland-input', str(root / 'inland.json'), '--coastal-input', str(root / 'coastal.json'), '--output', str(root / 'output.json')], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((root / 'output.json').read_text(), 'previous snapshot')


if __name__ == '__main__':
    unittest.main()
