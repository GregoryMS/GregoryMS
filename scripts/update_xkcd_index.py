#!/usr/bin/env python3
"""Refresh the same-origin title index from the official xkcd archive."""
import datetime
import json
from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_URL = 'https://xkcd.com/archive/'

class ArchiveParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.comics = {}
        self.current = None
        self.title = []

    def handle_starttag(self, tag, attrs):
        if tag != 'a':
            return
        attrs = dict(attrs)
        match = re.fullmatch(r'/(\d+)/', attrs.get('href', ''))
        date = attrs.get('title', '')
        if match and re.fullmatch(r'\d{4}-\d{1,2}-\d{1,2}', date):
            self.current = (int(match[1]), datetime.date.fromisoformat('-'.join(part.zfill(2) for part in date.split('-'))).isoformat())
            self.title = []

    def handle_data(self, value):
        if self.current:
            self.title.append(value)

    def handle_endtag(self, tag):
        if tag == 'a' and self.current:
            num, date = self.current
            title = ''.join(self.title).strip()
            if title and num > 0:
                self.comics[num] = {'id': num, 'title': title, 'date': date}
            self.current = None


def parse_archive(text, latest):
    parser = ArchiveParser()
    parser.feed(text)
    comics = sorted(parser.comics.values(), key=lambda comic: comic['id'], reverse=True)
    # 404 is intentionally absent from the official archive. Fail closed on
    # incomplete/error pages rather than replacing a working index.
    expected = set(range(1, latest + 1)) - {404}
    if latest < 1000 or set(parser.comics) != expected:
        raise ValueError('Archive is incomplete or does not match the latest comic; index was not changed.')
    return comics


def download(url):
    return subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location',
                           '--max-time', '45', '--retry', '2', url],
                          check=True, capture_output=True, text=True).stdout


def main():
    latest = json.loads(download('https://xkcd.com/info.0.json'))['num']
    comics = parse_archive(download(ARCHIVE_URL), latest)
    index = {'source': ARCHIVE_URL, 'updated': datetime.datetime.now(datetime.timezone.utc).date().isoformat(),
             'latest': latest, 'comics': comics}
    destination = ROOT / 'data/xkcd-index.json'
    destination.parent.mkdir(exist_ok=True)
    temporary = destination.with_suffix('.tmp')
    temporary.write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    temporary.replace(destination)
    print(f'Saved {len(comics)} comic titles through #{latest}.')


if __name__ == '__main__':
    main()
