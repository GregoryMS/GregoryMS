import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('update_xkcd_index', Path(__file__).resolve().parents[1] / 'scripts/update_xkcd_index.py')
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


def archive(latest=1002):
    return ''.join(f'<a href="/{i}/" title="2026-9-1">Title &amp; {i}</a><br>' for i in range(1, latest + 1) if i != 404)


class IndexTests(unittest.TestCase):
    def test_complete_archive_decodes_entities_and_sorts(self):
        comics = updater.parse_archive(archive(), 1002)
        self.assertEqual(len(comics), 1001)
        self.assertEqual(comics[0], {'id': 1002, 'title': 'Title & 1002', 'date': '2026-09-01'})
        self.assertEqual(comics[-1]['id'], 1)

    def test_error_or_partial_pages_are_rejected(self):
        for content in ['Access denied', archive().replace('href="/12/"', 'href="/404/"'), archive(1001)]:
            with self.assertRaises(ValueError):
                updater.parse_archive(content, 1002)

    def test_navigation_links_do_not_replace_comic_titles(self):
        comics = updater.parse_archive(archive() + '<a href="/1002/">Latest</a>', 1002)
        self.assertEqual(comics[0]['title'], 'Title & 1002')


if __name__ == '__main__':
    unittest.main()
