"""Fetch public RSS feeds for Gregle's same-origin News reader and homepage ticker."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import json
from pathlib import Path
import time
import urllib.error
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
    'chek': 'https://cheknews.ca/feed/',
    'radio-canada': 'https://ici.radio-canada.ca/info/rss/info/en-continu',
}
# Ticker sources share the snapshot without changing News reader subscriptions.
TICKER_SOURCES = {
    'universe-today': 'https://www.universetoday.com/feed',
}
ALL_SOURCES = {**SOURCES, **TICKER_SOURCES}
MAX_BYTES = 500_000
MAX_ATTEMPTS = 3
MAX_SNAPSHOT_AGE = dt.timedelta(hours=2)
FALLBACKS = {
    'cbc': [
        'https://www.cbc.ca/cmlink/rss-topstories',
        'https://news.google.com/rss/search?q=site%3Acbc.ca%2Fnews&hl=en-CA&gl=CA&ceid=CA%3Aen',
    ],
}


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
    sources = [url] + FALLBACKS.get(slug, [])
    for source in sources:
        request = urllib.request.Request(source, headers={
            'Accept': 'application/rss+xml, application/xml, text/xml',
            'User-Agent': 'GregleNews/1.0 (+https://gregle.uk/news.html)',
        })
        for attempt in range(MAX_ATTEMPTS):
            try:
                with urllib.request.urlopen(request, timeout=10 if source != sources[-1] else 25) as response:
                    raw = response.read(MAX_BYTES + 1)
                validate(raw)
                return raw
            except (OSError, ValueError, ET.ParseError) as error:
                transient = (isinstance(error, OSError) and
                             (not isinstance(error, urllib.error.HTTPError) or
                              error.code in (408, 429, 500, 502, 503, 504)))
                if transient and attempt + 1 < MAX_ATTEMPTS:
                    time.sleep(2 ** attempt)
                    continue
                if source == sources[-1]:
                    raise
                break


def unavailable_sources(snapshot, now):
    """Match the browser's two-hour cache window without renewing failed feeds."""
    available = set()
    for feed in snapshot.get('feeds', []):
        try:
            fetched = dt.datetime.fromisoformat(feed['fetchedAt'].replace('Z', '+00:00'))
            age = now - fetched
            validate(feed['xml'].encode('utf-8'))
            if -dt.timedelta(minutes=5) <= age <= MAX_SNAPSHOT_AGE:
                available.add(feed['url'])
        except (KeyError, TypeError, ValueError, AttributeError, ET.ParseError):
            continue
    return [slug for slug, url in ALL_SOURCES.items() if url not in available]


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
        for feed, error in pool.map(one, ALL_SOURCES.items()):
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
    now = dt.datetime.now(dt.timezone.utc)
    snapshot, errors = update(previous, fetch, now)
    if snapshot['feeds']:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix('.tmp')
        temporary.write_text(json.dumps(snapshot, ensure_ascii=False) + '\n', encoding='utf-8')
        temporary.replace(args.output)
    print(f'News: {len(snapshot["feeds"])} feed snapshots; {len(errors)} errors')
    for error in errors:
        print(f'::warning::{error}')
    unavailable = unavailable_sources(snapshot, now)
    if unavailable:
        print(f'::error::No usable feed snapshot for: {", ".join(unavailable)}')
        raise SystemExit(1)


if __name__ == '__main__':
    main()
