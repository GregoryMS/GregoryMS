import datetime as dt
import importlib.util
import contextlib
import io
from pathlib import Path
import re
import tempfile
import unittest
import urllib.error
import urllib.parse
from unittest.mock import patch, MagicMock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('news_feeds', ROOT / 'scripts' / 'update_news_feeds.py')
news = importlib.util.module_from_spec(spec)
spec.loader.exec_module(news)
XML = '<rss><channel><title>Nyheter</title><item><title>Nyheter på svenska: ä ö å</title><link>https://example.com/story</link></item></channel></rss>'.encode()


class NewsFeedsTests(unittest.TestCase):
    def test_default_urls_match_the_browser(self):
        source = (ROOT / 'assets' / 'news-defaults.js').read_text()
        urls = re.findall(r"url:'([^']+)'", source)
        self.assertEqual(urls, list(news.SOURCES.values()))

    def test_snapshot_retains_original_language_and_source_identity(self):
        now = dt.datetime(2026, 10, 19, tzinfo=dt.timezone.utc)
        result, errors = news.update({}, lambda slug, url: XML, now)
        self.assertEqual(errors, [])
        self.assertEqual(len(result['feeds']), 6)
        self.assertIn('ä ö å', result['feeds'][0]['xml'])
        self.assertEqual(result['feeds'][0]['fetchedAt'], now.isoformat())

    def test_failed_sources_preserve_their_previous_snapshot_and_age(self):
        previous = {'url': news.SOURCES['cbc'], 'fetchedAt': '2026-10-18T00:00:00+00:00', 'xml': XML.decode()}
        def fetch(slug, url):
            if slug == 'cbc':
                raise OSError('Feed unavailable')
            return XML
        result, errors = news.update({'feeds': [previous]}, fetch)
        self.assertEqual(len(errors), 1)
        self.assertEqual(next(feed for feed in result['feeds'] if feed['url'] == previous['url']), previous)
        self.assertEqual(len(result['feeds']), 6)

    def test_rejects_error_pages_empty_feeds_entities_and_oversized_responses(self):
        for raw in [b'<html>Error</html>', b'<rss><channel/></rss>', b'<!DOCTYPE rss><rss/>', b'x' * (news.MAX_BYTES + 1)]:
            with self.subTest(raw=raw[:40]), self.assertRaises(ValueError):
                news.validate(raw)

    def test_cbc_retries_then_uses_its_alternate_publisher_feed(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = XML
        with patch.object(news.time, 'sleep') as sleep, patch.object(
                news.urllib.request, 'urlopen', side_effect=[TimeoutError()] * 3 + [response]) as request:
            self.assertEqual(news.fetch_feed('cbc', news.SOURCES['cbc']), XML)
        first, *_, last = request.call_args_list
        self.assertEqual(first.args[0].full_url, news.SOURCES['cbc'])
        self.assertEqual(last.args[0].full_url, 'https://www.cbc.ca/cmlink/rss-topstories')
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [1, 2])

    def test_cbc_keeps_its_google_index_as_a_last_resort_without_retrying_404s(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = XML
        missing = urllib.error.HTTPError(news.SOURCES['cbc'], 404, 'Not Found', {}, None)
        with patch.object(news.time, 'sleep') as sleep, patch.object(
                news.urllib.request, 'urlopen', side_effect=[missing, missing, response]) as request:
            self.assertEqual(news.fetch_feed('cbc', news.SOURCES['cbc']), XML)
        sleep.assert_not_called()
        fallback = request.call_args_list[-1].args[0].full_url
        self.assertEqual(urllib.parse.parse_qs(urllib.parse.urlsplit(fallback).query)['q'], ['site:cbc.ca/news'])

    def test_retries_temporary_http_failures_and_stops_after_three_attempts(self):
        url = news.SOURCES['reuters']
        error = urllib.error.HTTPError(url, 503, 'Service Unavailable', {}, None)
        response = MagicMock()
        response.__enter__.return_value.read.return_value = XML
        with patch.object(news.time, 'sleep'), patch.object(
                news.urllib.request, 'urlopen', side_effect=[error, response]) as request:
            self.assertEqual(news.fetch_feed('reuters', url), XML)
            self.assertEqual(request.call_count, 2)
        with patch.object(news.time, 'sleep'), patch.object(
                news.urllib.request, 'urlopen', side_effect=error) as request:
            with self.assertRaises(urllib.error.HTTPError):
                news.fetch_feed('reuters', url)
            self.assertEqual(request.call_count, 3)

    def test_snapshot_availability_matches_browser_age_and_requires_usable_xml(self):
        now = dt.datetime(2026, 11, 1, tzinfo=dt.timezone.utc)
        snapshot, _ = news.update({}, lambda slug, url: XML, now)
        self.assertEqual(news.unavailable_sources(snapshot, now + dt.timedelta(hours=2)), [])
        for change in [
                {'fetchedAt': (now - dt.timedelta(hours=2, seconds=1)).isoformat()},
                {'fetchedAt': (now + dt.timedelta(minutes=5, seconds=1)).isoformat()},
                {'fetchedAt': 'invalid'}, {'fetchedAt': '2026-11-01T00:00:00'},
                {'xml': '<rss><channel/></rss>'}]:
            with self.subTest(change=change):
                changed = {'feeds': [{**feed, **change} if feed['url'] == news.SOURCES['cbc'] else feed
                                     for feed in snapshot['feeds']]}
                self.assertEqual(news.unavailable_sources(changed, now), ['cbc'])
        self.assertEqual(news.unavailable_sources({'feeds': []}, now), list(news.SOURCES))

    def test_command_warns_for_a_fresh_cached_feed_but_fails_when_it_is_stale_or_missing(self):
        now = dt.datetime.now(dt.timezone.utc)
        snapshot, _ = news.update({}, lambda slug, url: XML, now)
        for age, expected_failure in [(dt.timedelta(minutes=30), False),
                                      (dt.timedelta(hours=3), True), (None, True)]:
            with self.subTest(age=age), tempfile.TemporaryDirectory() as directory:
                feeds = [dict(feed) for feed in snapshot['feeds']]
                cbc = next(feed for feed in feeds if feed['url'] == news.SOURCES['cbc'])
                if age is None:
                    feeds.remove(cbc)
                else:
                    cbc['fetchedAt'] = (now - age).isoformat()
                output = io.StringIO()
                with patch('sys.argv', ['update_news_feeds.py', '--output', str(Path(directory) / 'feeds.json')]), \
                        patch.object(news, 'update', return_value=({'version': 1, 'feeds': feeds}, ['cbc: HTTP 503'])), \
                        contextlib.redirect_stdout(output):
                    if expected_failure:
                        with self.assertRaises(SystemExit) as result:
                            news.main()
                        self.assertEqual(result.exception.code, 1)
                        self.assertIn('::error::No usable feed snapshot for: cbc', output.getvalue())
                    else:
                        news.main()
                    self.assertIn('::warning::cbc: HTTP 503', output.getvalue())


if __name__ == '__main__':
    unittest.main()
