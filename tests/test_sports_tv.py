import datetime as dt
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import tempfile

spec = importlib.util.spec_from_file_location('sports_tv', Path(__file__).resolve().parents[1] / 'scripts' / 'update_sports_tv.py')
tv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tv)
NOW = dt.datetime(2026, 10, 12, 19, 15, tzinfo=dt.timezone.utc)


def row(home='Arsenal', away='Manchester City', channel='Sky Sports', live=False):
    return {'utcTime': NOW.isoformat().replace('+00:00', 'Z'), 'isLive': live,
            'channels': [{'name': channel}], 'home': {'name': home}, 'away': {'name': away}}


def guide(*rows):
    return {'20261012': [{'leagueName': 'Premier League', 'matches': list(rows)}]}


class TVTests(unittest.TestCase):
    def test_public_guide_data_is_country_specific_and_required(self):
        groups = guide(row())
        data = {'props': {'pageProps': {'fallback': {'tvguide-groups:gb': groups}}}}
        html = '<html><script src="app.js"></script><script id="__NEXT_DATA__" type="application/json">' + json.dumps(data) + '</script></html>'
        self.assertEqual(tv.parse_guide(html, 'GB'), groups)
        with self.assertRaises(KeyError): tv.parse_guide(html, 'CA')
        with self.assertRaises(ValueError): tv.parse_guide('<html>Unavailable</html>', 'GB')

    def test_upcoming_and_live_channels_preserve_gender_and_deduplicate(self):
        data = guide(row(), row(), row(channel='NOW'), row(live=True),
                     row(home='Everton', away='Liverpool'), row(home='Arsenal (W)', away='Manchester City (W)'),
                     row(home='Hull', away='Everton'), row(home='Liverpool', away='Newcastle'))
        results = tv.normalise(data, NOW)
        self.assertEqual(len(results), 4)
        men = next(r for r in results if r['home'] == 'Arsenal')
        self.assertEqual(men['channels'], ['NOW', 'Sky Sports'])
        self.assertTrue(any(r['home'] == 'Arsenal (W)' for r in results))
        self.assertEqual(men['start'], NOW.isoformat())

    def test_dates_bad_payloads_and_missing_fields(self):
        bad = row(); bad['utcTime'] = '2020-01-01T00:00:00Z'
        naive = row(); naive['utcTime'] = '2026-10-12T19:15:00'
        empty = row(); empty['channels'] = [None, {}, {'name': ' '}]
        self.assertEqual(tv.normalise(guide(bad, naive, empty, {}, None), NOW), [])
        for invalid in ({'error': 'blocked'}, {'20261012': [{}]}, {'old-api': []}):
            with self.assertRaises(ValueError): tv.normalise(invalid, NOW)
        self.assertEqual(tv.normalise({'20261012': []}, NOW), [])
        self.assertEqual(tv.team_key('Bayern München (W)'), 'bayernmunchen')

    def test_failed_country_keeps_its_original_check_time(self):
        previous = {'countries': {'GB': {'checkedAt': '2026-10-12T10:00:00+00:00', 'listings': [{'home': 'Old'}]}}}
        def fetch(code):
            if code == 'GB': raise OSError('Unavailable')
            return guide(row(channel=code))
        result = tv.build(previous, fetch, NOW)
        self.assertTrue(result['countries']['GB']['error'])
        self.assertEqual(result['countries']['GB']['checkedAt'], previous['countries']['GB']['checkedAt'])
        self.assertEqual(result['countries']['CA']['listings'][0]['channels'], ['CA'])
        self.assertEqual(set(result['countries']), set(tv.COUNTRIES))

    def test_complete_failure_is_reported_even_with_an_old_snapshot(self):
        def fail(code): raise OSError('Unavailable')
        for previous in (None, {'countries': {'GB': {'checkedAt': NOW.isoformat(), 'listings': [{'home': 'Old'}]}}}):
            with self.assertRaises(RuntimeError): tv.build(previous, fetch=fail, now=NOW)

    def test_main_leaves_published_snapshot_untouched_on_total_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'sports-tv.json'
            original = json.dumps({'countries': {'GB': {'listings': [{'home': 'Old'}]}}})
            output.write_text(original)
            with patch('sys.argv', ['update_sports_tv.py', '--output', str(output)]), patch.object(tv, 'build', side_effect=RuntimeError('All TV feeds failed')):
                with self.assertRaises(RuntimeError): tv.main()
            self.assertEqual(output.read_text(), original)


if __name__ == '__main__': unittest.main()
