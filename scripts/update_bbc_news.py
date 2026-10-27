"""Fetch BBC's official RSS feed for the same-origin Gregle headlines ticker."""
import argparse
import datetime as dt
import email.utils
import json
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

FEED_URL = 'https://feeds.bbci.co.uk/news/rss.xml'
SPORT_FEED_URL = 'https://feeds.bbci.co.uk/sport/rss.xml'
UTC = dt.timezone.utc


def build(xml, now=None, feed_url=FEED_URL):
    now = now or dt.datetime.now(UTC)
    channel = ET.fromstring(xml).find('channel')
    if channel is None:
        raise ValueError('Missing RSS channel')
    updated = email.utils.parsedate_to_datetime(channel.findtext('lastBuildDate', ''))
    if updated.tzinfo is None:
        raise ValueError('Missing feed timezone')
    if not -dt.timedelta(minutes=5) <= now - updated <= dt.timedelta(hours=6):
        raise ValueError('BBC feed is stale or future-dated')
    items, seen = [], set()
    for item in channel.findall('item'):
        title = (item.findtext('title') or '').strip()
        link = (item.findtext('link') or '').strip()
        url = urllib.parse.urlsplit(link)
        host = url.hostname or ''
        if (not title or url.scheme != 'https' or url.username or url.password or
                not any(host == domain or host.endswith('.' + domain)
                        for domain in ('bbc.co.uk', 'bbc.com')) or link in seen):
            continue
        seen.add(link)
        items.append({'title': title, 'link': link})
        if len(items) == 10:
            break
    if not items:
        raise ValueError('No usable BBC headlines; keeping the previous snapshot')
    return {'source': feed_url, 'feedUpdatedAt': updated.astimezone(UTC).isoformat(),
            'fetchedAt': now.isoformat(), 'items': items}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--feed', choices=['news', 'sport'], default='news')
    parser.add_argument('--input', type=Path, help='Optional saved RSS file for offline checks')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    feed_url = SPORT_FEED_URL if args.feed == 'sport' else FEED_URL
    args.output = args.output or Path(__file__).resolve().parents[1] / 'data' / ('bbc-sport.json' if args.feed == 'sport' else 'bbc-news.json')
    if args.input:
        xml = args.input.read_bytes()
    else:
        request = urllib.request.Request(feed_url, headers={
            'Accept': 'application/rss+xml, application/xml, text/xml',
            'User-Agent': 'GregleHeadlines/1.0 (+https://gregle.uk/)'
        })
        with urllib.request.urlopen(request, timeout=30) as response:
            xml = response.read(2_000_001)
        if len(xml) > 2_000_000:
            raise ValueError('Unexpectedly large RSS feed')
    snapshot = build(xml, feed_url=feed_url)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix('.tmp')
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(args.output)
    print(f'BBC headlines: {len(snapshot["items"])}; feed updated {snapshot["feedUpdatedAt"]}')


if __name__ == '__main__':
    main()
