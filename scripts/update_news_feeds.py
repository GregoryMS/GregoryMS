"""Fetch public default RSS feeds for Gregle's same-origin News reader."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import json
from pathlib import Path
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

SOURCES = {
    'bbc': 'https://feeds.bbci.co.uk/news/rss.xml',
    'svt': 'https://www.svt.se/nyheter/rss.xml',
    'nrk': 'https://www.nrk.no/toppsaker.rss',
    'reuters': 'https://news.google.com/rss/search?q=site%3Areuters.com&hl=en-CA&gl=CA&ceid=CA%3Aen',
    'cbc': 'https://www.cbc.ca/webfeed/rss/rss-topstories',
    'dw': 'https://rss.dw.com/xml/rss-de-all',
}
MAX_BYTES = 500_000


def validate(raw):
    if len(raw) > MAX_BYTES:
        raise ValueError('Feed exceeds the size limit')
    text = raw.decode('utf-8-sig')
    if '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():
        raise ValueError('Unsupported XML declarations')
    channel = ET.fromstring(text).find('channel')
    if channel is None:
        raise ValueError('Missing RSS channel')
    items = channel.findall('item')
    if not any((item.findtext('title') or '').strip() and
               urllib.parse.urlsplit(item.findtext('link') or '').scheme == 'https'
               for item in items):
        raise ValueError('No usable articles; keeping the previous feed')
    return text


def fetch_feed(slug, url):
    request = urllib.request.Request(url, headers={
        'Accept': 'application/rss+xml, application/xml, text/xml',
        'User-Agent': 'GregleNews/1.0 (+https://gregle.uk/news.html)',
    })
    with urllib.request.urlopen(request, timeout=25) as response:
        return response.read(MAX_BYTES + 1)


def update(previous, fetch=fetch_feed, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    existing = {feed['url']: feed for feed in previous.get('feeds', [])}
    errors = []

    def one(item):
        slug, url = item
        try:
            return {'url': url, 'fetchedAt': now.isoformat(), 'xml': validate(fetch(slug, url))}, None
        except Exception as error:
            return existing.get(url), f'{slug}: {error}'

    feeds = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        for feed, error in pool.map(one, SOURCES.items()):
            if feed:
                feeds.append(feed)
            if error:
                errors.append(error)
    return {'version': 1, 'feeds': feeds}, errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input-dir', type=Path, help='Read <source>-feed.xml fixtures instead of fetching')
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'data' / 'news-feeds.json')
    args = parser.parse_args()
    previous = json.loads(args.output.read_text(encoding='utf-8')) if args.output.exists() else {}
    fetch = (lambda slug, url: (args.input_dir / f'{slug}-feed.xml').read_bytes()) if args.input_dir else fetch_feed
    snapshot, errors = update(previous, fetch)
    if snapshot['feeds']:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix('.tmp')
        temporary.write_text(json.dumps(snapshot, ensure_ascii=False) + '\n', encoding='utf-8')
        temporary.replace(args.output)
    print(f'News: {len(snapshot["feeds"])} feed snapshots; {len(errors)} errors')
    for error in errors:
        print(error)
    if errors:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
