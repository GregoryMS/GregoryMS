"""Publish compact country-specific FotMob TV listings for Gregle's followed teams.

Fetches public, credential-free listings. Does not infer league rights holders.
The source has no browser CORS header, so GitHub Pages serves the verified snapshot.
"""
import argparse
import concurrent.futures
import datetime as dt
import json
from html.parser import HTMLParser
import re
import unicodedata
import urllib.request
from pathlib import Path

UTC = dt.timezone.utc
COUNTRIES = ('GB', 'CA', 'NO', 'SE', 'DE')
FOLLOWED = {'brighton', 'bayernmunchen', 'vancouverwhitecaps', 'arsenal', 'manchestercity', 'chelsea', 'hullcity', 'newcastleunited', 'canada', 'norway', 'scotland', 'sweden', 'england'}
ALIASES = {'brightonhovealbion': 'brighton', 'brightonandhovealbion': 'brighton', 'bayernmunich': 'bayernmunchen', 'fcbayernmunchen': 'bayernmunchen', 'mancity': 'manchestercity', 'vancouverwhitecapsfc': 'vancouverwhitecaps', 'hull': 'hullcity', 'newcastle': 'newcastleunited'}


def team_key(name):
    name = re.sub(r"\(w\)|\bwomen(?:'s)?\b|\bladies\b", '', name, flags=re.I)
    name = unicodedata.normalize('NFD', name)
    key = re.sub('[^a-z0-9]', '', name.lower())
    return ALIASES.get(key, key)


class GuideParser(HTMLParser):
    """Read the public guide's embedded data without relying on hashed JS assets."""
    def __init__(self):
        super().__init__()
        self.inside = False
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == 'script' and dict(attrs).get('id') == '__NEXT_DATA__':
            self.inside = True

    def handle_data(self, data):
        if self.inside:
            self.parts.append(data)

    def handle_endtag(self, tag):
        if tag == 'script':
            self.inside = False


def parse_guide(html, code):
    parser = GuideParser()
    parser.feed(html)
    data = json.loads(''.join(parser.parts))
    groups = data['props']['pageProps']['fallback']['tvguide-groups:' + code.lower()]
    if not isinstance(groups, dict):
        raise ValueError('Unexpected TV guide response')
    return groups


def normalise(payload, now):
    if not isinstance(payload, dict) or any(not re.fullmatch(r'\d{8}', day) or not isinstance(groups, list)
                                            for day, groups in payload.items()):
        raise ValueError('Unexpected TV listings response')
    fixtures = {}
    for groups in payload.values():
        for group in groups:
            if not isinstance(group, dict) or not isinstance(group.get('matches'), list):
                raise ValueError('Unexpected TV guide group')
            for row in group['matches']:
                if not isinstance(row, dict):
                    continue
                home, away = row.get('home', {}).get('name'), row.get('away', {}).get('name')
                if not isinstance(home, str) or not isinstance(away, str) or not ({team_key(home), team_key(away)} & FOLLOWED):
                    continue
                try:
                    start = dt.datetime.fromisoformat(row.get('utcTime', '').replace('Z', '+00:00'))
                    if start.tzinfo is None:
                        continue
                    start = start.astimezone(UTC)
                except (ValueError, TypeError, AttributeError):
                    continue
                if not now - dt.timedelta(days=1) <= start <= now + dt.timedelta(days=10):
                    continue
                # isLive describes the match status; upcoming matches also have confirmed channels.
                channels = {c['name'].strip() for c in row.get('channels', [])
                            if isinstance(c, dict) and isinstance(c.get('name'), str) and c['name'].strip()}
                if not channels:
                    continue
                key = (home, away, start.isoformat())
                fixture = fixtures.setdefault(key, {'home': home, 'away': away, 'start': start.isoformat(), 'channels': set()})
                fixture['channels'].update(channels)
    return sorted(({**f, 'channels': sorted(f['channels'])} for f in fixtures.values()),
                  key=lambda f: (f['start'], f['home'], f['away']))


def fetch_country(code):
    request = urllib.request.Request('https://www.fotmob.com/tv-guide/' + code.lower(),
                                    headers={'Accept': 'text/html', 'User-Agent': 'GregleSportsTracker/1.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return parse_guide(response.read().decode('utf-8'), code)


def build(previous=None, fetch=fetch_country, now=None):
    now = now or dt.datetime.now(UTC)
    previous = previous or {}
    countries = {}
    def load(code):
        try:
            return code, {'checkedAt': now.isoformat(), 'listings': normalise(fetch(code), now), 'error': False}
        except Exception as error:
            print(f'{code}: TV feed refresh failed ({type(error).__name__})')
            return code, {**previous.get('countries', {}).get(code, {}), 'error': True}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        countries.update(pool.map(load, COUNTRIES))
    if all(c.get('error') for c in countries.values()):
        raise RuntimeError('All TV feeds failed; keeping the previous snapshot without claiming a successful refresh')
    return {'version': 1, 'source': 'FotMob', 'countries': countries}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'data' / 'sports-tv.json')
    args = parser.parse_args()
    previous = json.loads(args.output.read_text()) if args.output.exists() else None
    snapshot = build(previous)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix('.tmp')
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(args.output)
    print('TV listings:', ', '.join(f'{code}: {len(c.get("listings", []))}' for code, c in snapshot['countries'].items()))


if __name__ == '__main__':
    main()
