"""Publish DriveBC inland crossings and coastal terminals for same-origin maps."""
import argparse
import datetime as dt
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import re
import urllib.parse
import urllib.request

SOURCES = {'inland': 'https://www.drivebc.ca/api/ferries/', 'coastal': 'https://www.drivebc.ca/api/ferries/coastal/'}
UTC = dt.timezone.utc


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.hidden += 1
        if not self.hidden and tag in ('p', 'div', 'li', 'br', 'ul', 'ol'):
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self.hidden:
            self.hidden -= 1
        elif not self.hidden and tag in ('p', 'div', 'li', 'ul', 'ol'):
            self.parts.append('\n')

    def handle_data(self, value):
        if not self.hidden:
            self.parts.append(value)


def plain(value):
    parser = PlainText()
    parser.feed(value[:40000] if isinstance(value, str) else '')
    return '\n'.join(re.sub(r'\s+', ' ', line).strip() for line in ''.join(parser.parts).splitlines() if line.strip())[:12000]


def hours24(value):
    def replace(match):
        hour = int(match[1]) % 12 + (12 if match[3].lower().startswith('p') else 0)
        return f'{hour:02}:{match[2] or "00"}'
    return re.sub(r'\b(1[0-2]|[1-9])(?::([0-5]\d))?\s*([ap]\.?m\.?)\b', replace, value, flags=re.I)


def link(value):
    if not isinstance(value, str) or len(value) > 2000:
        return None
    try:
        url = urllib.parse.urlsplit(value.strip())
        return value.strip() if url.scheme == 'https' and url.hostname in ('www2.gov.bc.ca', 'www.bcferries.com', 'bcferries.com', 'www.drivebc.ca') and not url.username and not url.password and url.port in (None, 443) else None
    except ValueError:
        return None


def build(inland, coastal, now=None):
    now = now or dt.datetime.now(UTC)
    ferries = []
    for kind, items in [('inland', inland), ('coastal', coastal)]:
        if not isinstance(items, list) or not 0 < len(items) <= 1000:
            raise ValueError(f'Invalid {kind} ferry feed')
        seen = set()
        for item in items:
            if not isinstance(item, dict):
                continue
            raw_id = item.get('id')
            if isinstance(raw_id, bool) or not re.fullmatch(r'[1-9]\d{0,15}', str(raw_id)):
                continue
            identifier = f'{kind}/{raw_id}'
            location = item.get('location') or {}
            if not isinstance(location, dict):
                continue
            point = location.get('coordinates')
            if identifier in seen or location.get('type') != 'Point' or not isinstance(point, list) or len(point) < 2:
                continue
            lng, lat = point[:2]
            if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (lat, lng)) or not (48 <= lat <= 60.1 and -139.1 <= lng <= -114):
                continue
            name = plain(item.get('route_name') if kind == 'inland' else item.get('name'))[:240]
            if not name:
                continue
            ferry = {'id': identifier, 'kind': kind, 'name': name, 'point': [lat, lng], 'description': plain(item.get('route_description')), 'url': link(item.get('url')), 'operator': plain(item.get('contact_org'))[:240], 'phone': plain(item.get('contact_phone'))[:80], 'updated': item.get('feed_modified_at') if isinstance(item.get('feed_modified_at'), str) else None, 'routes': [], 'vessels': []}
            for route in (item.get('routes') or [])[:100]:
                if isinstance(route, dict) and plain(route.get('name')):
                    ferry['routes'].append({'name': plain(route.get('name'))[:240], 'url': link(route.get('url'))})
            for vessel in (item.get('vessels') or [])[:10]:
                if not isinstance(vessel, dict):
                    continue
                entry = {'name': plain(vessel.get('name'))[:240], 'schedule': hours24(plain(vessel.get('schedule_detail'))), 'restriction': plain(vessel.get('special_restriction'))}
                for key in ('vehicle_capacity', 'passenger_capacity', 'crossing_time_min'):
                    value = vessel.get(key)
                    if type(value) in (int, float) and math.isfinite(value) and 0 < value < 100000:
                        entry[key] = value
                ferry['vessels'].append(entry)
            ferries.append(ferry)
            seen.add(identifier)
        if not seen:
            raise ValueError(f'No valid {kind} ferries; retaining previous snapshot')
    ferries.sort(key=lambda item: item['id'])
    return {'sources': SOURCES, 'fetchedAt': now.isoformat(), 'ferries': ferries}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--inland-input', type=Path)
    parser.add_argument('--coastal-input', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'data' / 'drivebc-ferries.json')
    args = parser.parse_args()
    if bool(args.inland_input) != bool(args.coastal_input):
        parser.error('Provide both input files or neither')
    data = {}
    for kind, url in SOURCES.items():
        path = getattr(args, f'{kind}_input')
        if path:
            raw = path.read_bytes()
        else:
            request = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'GregleMaps/1.0 (+https://gregle.uk/maps.html)'})
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError('Unexpectedly large ferry feed')
        data[kind] = json.loads(raw)
    snapshot = build(data['inland'], data['coastal'])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix('.tmp')
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    temporary.replace(args.output)
    print(f'DriveBC: {len(snapshot["ferries"])} ferry crossings and terminals checked {snapshot["fetchedAt"]}')


if __name__ == '__main__':
    main()
