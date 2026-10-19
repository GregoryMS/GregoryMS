import datetime as dt
import importlib.util
from pathlib import Path
import re
import unittest
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

    def test_cbc_falls_back_to_its_own_google_news_index_after_a_timeout(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = XML
        with patch.object(news.urllib.request, 'urlopen', side_effect=[TimeoutError(), response]) as request:
            self.assertEqual(news.fetch_feed('cbc', news.SOURCES['cbc']), XML)
        first, second = request.call_args_list
        self.assertEqual(first.args[0].full_url, news.SOURCES['cbc'])
        self.assertEqual(second.args[0].full_url, news.FALLBACKS['cbc'])
        self.assertEqual(urllib.parse.parse_qs(urllib.parse.urlsplit(news.FALLBACKS['cbc']).query)['q'], ['site:cbc.ca/news'])


if __name__ == '__main__':
    unittest.main()
