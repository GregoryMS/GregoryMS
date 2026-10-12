"""Publish compact country-specific FotMob TV listings for Gregle's followed teams.

Fetches public, credential-free listings. Does not infer league rights holders.
The source has no browser CORS header, so GitHub Pages serves the verified snapshot.
"""
import argparse
import concurrent.futures
import datetime as dt
import json
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


def normalise(payload, now):
    if not isinstance(payload, dict) or any(not isinstance(rows, list) for rows in payload.values()):
        raise ValueError('Unexpected TV listings response')
    fixtures = {}
    for rows in payload.values():
        for row in rows:
            if not isinstance(row, dict):
                continue
            flags = {str(x).lower() for x in (row.get('qualifiers') or []) + (row.get('tags') or [])}
            if 'live' not in flags or flags.intersection({'repeat', 'replay', 'delayed'}):
                continue
            teams = row.get('program', {}).get('teams') or []
            home = next((t.get('name') for t in teams if t.get('isHome') is True), None)
            away = next((t.get('name') for t in teams if t.get('isHome') is False), None)
            if not isinstance(home, str) or not isinstance(away, str) or not ({team_key(home), team_key(away)} & FOLLOWED):
                continue
            raw_time = re.fullmatch(r'/Date\((\d+)\)/', str(row.get('startTime', '')))
            if not raw_time:
                continue
            try:
                start = dt.datetime.fromtimestamp(int(raw_time[1]) / 1000, UTC)
            except (ValueError, OverflowError, OSError):
                continue
            if not now - dt.timedelta(days=1) <= start <= now + dt.timedelta(days=10):
                continue
            channel = row.get('station', {}).get('name') or row.get('station', {}).get('callSign')
            if not isinstance(channel, str) or not channel.strip():
                continue
            key = (home, away, start.isoformat())
            fixture = fixtures.setdefault(key, {'home': home, 'away': away, 'start': start.isoformat(), 'channels': set()})
            fixture['channels'].add(channel.strip())
    result = []
    for fixture in fixtures.values():
        fixture['channels'] = sorted(fixture['channels'])
        result.append(fixture)
    return sorted(result, key=lambda f: (f['start'], f['home'], f['away']))


def fetch_country(code):
    request = urllib.request.Request('https://www.fotmob.com/api/data/tvlistings?countryCode=' + code,
                                    headers={'Accept': 'application/json', 'User-Agent': 'GregleSportsTracker/1.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


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
    if all(c.get('error') for c in countries.values()) and not any(c.get('listings') for c in countries.values()):
        raise RuntimeError('No usable TV listings; refusing to publish an empty failed snapshot')
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
