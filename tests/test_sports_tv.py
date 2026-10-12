import datetime as dt
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('sports_tv', Path(__file__).resolve().parents[1] / 'scripts' / 'update_sports_tv.py')
tv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tv)
NOW = dt.datetime(2026, 10, 12, 19, 15, tzinfo=dt.timezone.utc)


def row(home='Arsenal', away='Manchester City', channel='Sky Sports', live=True):
    return {'startTime': f'/Date({int(NOW.timestamp() * 1000)})/', 'qualifiers': ['Live'] if live else ['Repeat'],
            'station': {'name': channel}, 'program': {'teams': [{'name': home, 'isHome': True}, {'name': away, 'isHome': False}]}}


class TVTests(unittest.TestCase):
    def test_filters_replays_unfollowed_teams_and_deduplicates_channels(self):
        data = {'1': [row(), row(), row(channel='NOW'), row(live=False, channel='Replay')],
                '2': [row(home='Everton', away='Liverpool')], '3': [row(home='Arsenal (W)', away='Manchester City (W)')],
                '4': [row(home='Hull', away='Everton')], '5': [row(home='Liverpool', away='Newcastle')]}
        results = tv.normalise(data, NOW)
        self.assertEqual(len(results), 4)
        men = next(r for r in results if r['home'] == 'Arsenal')
        self.assertEqual(men['channels'], ['NOW', 'Sky Sports'])

    def test_dates_bad_payloads_and_missing_fields(self):
        bad = row(); bad['startTime'] = '/Date(1)/'
        self.assertEqual(tv.normalise({'1': [bad, {}, None]}, NOW), [])
        with self.assertRaises(ValueError): tv.normalise({'error': 'blocked'}, NOW)
        self.assertEqual(tv.team_key('Bayern München (W)'), 'bayernmunchen')

    def test_failed_country_keeps_its_original_check_time(self):
        previous = {'countries': {'GB': {'checkedAt': '2026-10-12T10:00:00+00:00', 'listings': [{'home': 'Old'}]}}}
        def fetch(code):
            if code == 'GB': raise OSError('Unavailable')
            return {'1': [row(channel=code)]}
        result = tv.build(previous, fetch, NOW)
        self.assertTrue(result['countries']['GB']['error'])
        self.assertEqual(result['countries']['GB']['checkedAt'], previous['countries']['GB']['checkedAt'])
        self.assertEqual(result['countries']['CA']['listings'][0]['channels'], ['CA'])
        self.assertEqual(set(result['countries']), set(tv.COUNTRIES))

    def test_complete_initial_failure_does_not_replace_data_with_empty_snapshot(self):
        def fail(code): raise OSError('Unavailable')
        with self.assertRaises(RuntimeError): tv.build(fetch=fail, now=NOW)


if __name__ == '__main__': unittest.main()
