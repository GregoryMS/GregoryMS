import datetime as dt
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'update_bbc_news.py'
spec = importlib.util.spec_from_file_location('bbc_news', SCRIPT)
news = importlib.util.module_from_spec(spec)
spec.loader.exec_module(news)
NOW = dt.datetime(2026, 10, 15, 2, 30, tzinfo=dt.timezone.utc)


def feed(items, date='Thu, 15 Oct 2026 02:25:00 GMT'):
    return f'<rss><channel><lastBuildDate>{date}</lastBuildDate>{items}</channel></rss>'


def item(title='Headline &amp; details', link='https://www.bbc.co.uk/news/articles/example'):
    return f'<item><title>{title}</title><link>{link}</link></item>'


class BBCNewsTests(unittest.TestCase):
    def test_extracts_titles_links_and_feed_date(self):
        data = news.build(feed(item()), NOW)
        self.assertEqual(data['items'][0]['title'], 'Headline & details')
        self.assertEqual(data['feedUpdatedAt'], '2026-10-15T02:25:00+00:00')

    def test_filters_untrusted_links_empty_titles_and_duplicates(self):
        xml = feed(item() + item() + item(link='javascript:alert(1)') +
                   item(link='https://bbc.com.evil.test/story') +
                   item(link='https://user@www.bbc.com/news/story') + item(title=' ') +
                   item('Other', 'https://www.bbc.com/news/articles/other'))
        self.assertEqual(len(news.build(xml, NOW)['items']), 2)

    def test_limits_to_ten_headlines(self):
        xml = feed(''.join(item(str(i), f'https://www.bbc.com/news/articles/{i}') for i in range(20)))
        self.assertEqual(len(news.build(xml, NOW)['items']), 10)

    def test_rejects_stale_future_empty_and_malformed_feeds(self):
        for xml in [feed(item(), 'Wed, 14 Oct 2026 01:00:00 GMT'),
                    feed(item(), 'Fri, 16 Oct 2026 01:00:00 GMT'),
                    feed(''), '<html>error</html>', '<rss', feed(item(), 'invalid')]:
            with self.subTest(xml=xml), self.assertRaises(Exception):
                news.build(xml, NOW)

    def test_failed_refresh_preserves_existing_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'bbc-news.json'
            source = Path(directory) / 'bad.xml'
            output.write_text('last good data')
            source.write_text('<html>Service unavailable</html>')
            result = subprocess.run([sys.executable, str(SCRIPT), '--input', str(source), '--output', str(output)], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(output.read_text(), 'last good data')


if __name__ == '__main__':
    unittest.main()
