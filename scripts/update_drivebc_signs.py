"""Publish the public DriveBC message-sign feed for same-origin browser access."""
import argparse
import datetime as dt
import json
import math
import urllib.request
from pathlib import Path

FEED_URL = 'https://www.drivebc.ca/api/dms/'
UTC = dt.timezone.utc


def build(data, now=None):
    now = now or dt.datetime.now(UTC)
    if not isinstance(data, list) or not data or len(data) > 2000:
        raise ValueError('Invalid DriveBC message sign feed')
    signs, seen = [], set()
    fields = ('name', 'description', 'roadway_name', 'roadway_direction', 'status',
              'message_display_1', 'message_display_2', 'message_display_3', 'message_text',
              'updated_datetime_utc', 'message_expiry_datetime_utc', 'cache_datetime_utc')
    for item in data:
        if not isinstance(item, dict):
            continue
        sign_id = str(item.get('id') or '').strip()[:128]
        location = item.get('location') or {}
        coordinates = location.get('coordinates')
        if not sign_id or sign_id in seen or location.get('type') != 'Point' or not isinstance(coordinates, list) or len(coordinates) < 2:
            continue
        lng, lat = coordinates[:2]
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (lng, lat)) or not (48 <= lat <= 60.1 and -139.1 <= lng <= -114):
            continue
        sign = {key: item[key].strip()[:4000] for key in fields if isinstance(item.get(key), str)}
        sign.update(id=sign_id, location={'type': 'Point', 'coordinates': [lng, lat]}, is_on=item.get('is_on') is not False)
        signs.append(sign)
        seen.add(sign_id)
    if not signs:
        raise ValueError('No valid message signs; keeping previous snapshot')
    signs.sort(key=lambda item: item['id'])
    return {'source': FEED_URL, 'fetchedAt': now.isoformat(), 'signs': signs}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path, help='Saved public feed for offline checks')
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'data' / 'drivebc-signs.json')
    args = parser.parse_args()
    if args.input:
        raw = args.input.read_bytes()
    else:
        request = urllib.request.Request(FEED_URL, headers={'Accept': 'application/json', 'User-Agent': 'GregleMaps/1.0 (+https://gregle.uk/maps.html)'})
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read(2_000_001)
    if len(raw) > 2_000_000:
        raise ValueError('Unexpectedly large message-sign feed')
    snapshot = build(json.loads(raw))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix('.tmp')
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    temporary.replace(args.output)
    print(f'DriveBC: {len(snapshot["signs"])} message signs checked {snapshot["fetchedAt"]}')


if __name__ == '__main__':
    main()
