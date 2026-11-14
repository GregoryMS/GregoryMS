#!/usr/bin/env python3
"""Publish small, route-specific Victoria/TransLink GTFS map snapshots."""
import argparse
import collections
import csv
import datetime as dt
import hashlib
import io
import json
import math
from pathlib import Path
import tempfile
import urllib.request
import zipfile
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    'victoria': ('https://bct.tmix.se/Tmix.Cap.TdExport.WebApi/gtfs/?operatorIds=48', 'ca-bc-Victoria-Transit_', 'BC Transit'),
    'vancouver': ('https://gtfs-static.translink.ca/gtfs/google_transit.zip', 'ca-bc-TransLink_', 'TransLink'),
}
MODES = {'0': 'TRAM', '1': 'SUBWAY', '2': 'RAIL', '3': 'BUS', '4': 'FERRY'}


def rows(archive, name):
    if name not in archive.namelist():
        return iter(())
    return csv.DictReader(io.TextIOWrapper(archive.open(name), encoding='utf-8-sig'))


def active_services(archive, today):
    days = [today + dt.timedelta(days=n) for n in range(8)]
    services = collections.defaultdict(set)
    for row in rows(archive, 'calendar.txt'):
        for day in days:
            date = day.strftime('%Y%m%d')
            if row['start_date'] <= date <= row['end_date'] and row[day.strftime('%A').lower()] == '1':
                services[row['service_id']].add(date)
    for row in rows(archive, 'calendar_dates.txt'):
        if today.strftime('%Y%m%d') <= row['date'] <= days[-1].strftime('%Y%m%d'):
            if row['exception_type'] == '1':
                services[row['service_id']].add(row['date'])
            else:
                services[row['service_id']].discard(row['date'])
    return {key for key, dates in services.items() if dates}


def simplify(points, tolerance=.000025):
    """Ramer-Douglas-Peucker, roughly 2 m, preserving actual street geometry."""
    if len(points) < 3:
        return points
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        a, b = points[start], points[end]
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = dx * dx + dy * dy
        distance, index = 0, None
        for i in range(start + 1, end):
            p = points[i]
            ratio = max(0, min(1, ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / length)) if length else 0
            d = (p[0]-a[0]-ratio*dx)**2 + (p[1]-a[1]-ratio*dy)**2
            if d > distance:
                distance, index = d, i
        if distance > tolerance*tolerance:
            keep.add(index)
            stack.extend([(start, index), (index, end)])
    return [points[i] for i in sorted(keep)]


def build(city, source, today):
    url, prefix, operator = SOURCES[city]
    archive = zipfile.ZipFile(source)
    if sum(info.file_size for info in archive.infolist()) > 500_000_000:
        raise ValueError('GTFS archive exceeds size limit')
    info = next(rows(archive, 'feed_info.txt'), {})
    if info.get('feed_end_date', '') < today.strftime('%Y%m%d'):
        raise ValueError('GTFS feed expired')
    active = active_services(archive, today)
    routes = {r['route_id']: r for r in rows(archive, 'routes.txt')}
    patterns, trip_pattern = {}, {}
    for trip in rows(archive, 'trips.txt'):
        if trip['service_id'] not in active or trip['route_id'] not in routes or not trip.get('shape_id'):
            continue
        key = (trip['route_id'], trip.get('direction_id', ''), trip['shape_id'], trip.get('trip_headsign', ''))
        if key not in patterns:
            patterns[key] = {'trip': trip['trip_id'], 'stops': [], 'count': 0}
            trip_pattern[trip['trip_id']] = key
        patterns[key]['count'] += 1
    for row in rows(archive, 'stop_times.txt'):
        if row['trip_id'] in trip_pattern:
            patterns[trip_pattern[row['trip_id']]]['stops'].append((int(row['stop_sequence']), row['stop_id']))
    shapes = collections.defaultdict(list)
    wanted = {key[2] for key in patterns}
    for row in rows(archive, 'shapes.txt'):
        if row['shape_id'] in wanted:
            lat, lng = float(row['shape_pt_lat']), float(row['shape_pt_lon'])
            if not (48 <= lat <= 51 and -125 <= lng <= -120):
                raise ValueError('Out-of-region shape')
            shapes[row['shape_id']].append((int(row['shape_pt_sequence']), [round(lat, 5), round(lng, 5)]))
    shapes = {key: simplify([p for _, p in sorted(value)]) for key, value in shapes.items()}
    raw_stops = {s['stop_id']: s for s in rows(archive, 'stops.txt')}
    stop_modes, stop_routes = collections.defaultdict(set), collections.defaultdict(set)
    route_files, catalog, rapid = {}, [], []
    for route_id, raw in routes.items():
        selected = [(key, value) for key, value in patterns.items() if key[0] == route_id]
        if not selected:
            continue
        mode = MODES.get(raw['route_type'], 'BUS')
        number = raw.get('route_short_name') or raw['route_long_name']
        if number.isdigit():
            number = str(int(number))
        name = raw['route_long_name']
        is_rapid = mode != 'BUS' or (city == 'vancouver' and number.startswith('R') and number[1:].isdigit()) or (city == 'victoria' and number == '95')
        colour = raw.get('route_color', '')
        colour = '#'+colour if len(colour) == 6 and all(c in '0123456789abcdefABCDEF' for c in colour) else '#7637cc'
        colour = {'Expo Line': '#0068b5', 'Millennium Line': '#b99500', 'Canada Line': '#0096ad', 'West Coast Express': '#772583', 'SeaBus': '#008578'}.get(name, '#18734a' if is_rapid and mode == 'BUS' else colour)
        variants, seen = [], set()
        for key, value in sorted(selected, key=lambda item: -item[1]['count']):
            ids = [stop_id for _, stop_id in sorted(value['stops']) if stop_id in raw_stops]
            signature = (key[1], key[2], tuple(ids))
            if signature in seen or len(shapes.get(key[2], [])) < 2 or len(ids) < 2:
                continue
            seen.add(signature)
            for stop_id in ids:
                parent = raw_stops[stop_id].get('parent_station')
                for sid in [stop_id] + ([parent] if parent in raw_stops else []):
                    stop_modes[sid].add(mode)
                    stop_routes[sid].add(route_id)
            variants.append({'direction': key[1], 'headsign': key[3] or name, 'points': shapes[key[2]], 'stops': ids})
        if not variants:
            # Demand-responsive HandyDART has no fixed route/stop sequence.
            if route_id == 'HD':
                continue
            raise ValueError('Route has no usable geometry: '+route_id)
        route = {'id': route_id, 'routeId': prefix+route_id, 'number': number, 'name': name, 'mode': mode, 'rapid': is_rapid, 'color': colour}
        payload = {**route, 'variants': variants}
        content = json.dumps(payload, separators=(',', ':'), ensure_ascii=False)
        filename = hashlib.sha256(content.encode()).hexdigest()[:16]+'.json'
        route['file'] = filename
        route_files[filename] = content
        catalog.append(route)
        if is_rapid:
            rapid.append({**route, 'variants': variants})
    stops = []
    for stop_id in stop_modes:
        raw = raw_stops[stop_id]
        lat, lng = float(raw['stop_lat']), float(raw['stop_lon'])
        if not all(map(math.isfinite, (lat, lng))):
            raise ValueError('Invalid stop coordinate')
        stops.append({'key': stop_id, 'id': prefix+stop_id, 'name': raw['stop_name'], 'lat': round(lat, 5), 'lng': round(lng, 5), 'code': raw.get('stop_code', ''), 'parent': prefix+raw['parent_station'] if raw.get('parent_station') else '', 'modes': sorted(stop_modes[stop_id]), 'routes': sorted(stop_routes[stop_id]), 'scope': 'bc', 'zone': 'America/Vancouver'})
    if len(catalog) < 20 or len(stops) < 500:
        raise ValueError('Unexpectedly incomplete transit feed')
    return {'schema': 1, 'city': city, 'updated': today.isoformat(), 'feedVersion': info.get('feed_version'), 'validUntil': info.get('feed_end_date'), 'source': url, 'operator': operator, 'routes': catalog, 'stops': stops, 'rapid': rapid}, route_files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache-dir', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT/'data/transit')
    args = parser.parse_args()
    today = dt.datetime.now(ZoneInfo('America/Vancouver')).date()
    results = {}
    for city, (url, _, _) in SOURCES.items():
        if args.cache_dir:
            source = args.cache_dir/(city+'.zip')
        else:
            request = urllib.request.Request(url, headers={'User-Agent': 'GregleMaps/1.0 transit-map-updater'})
            with urllib.request.urlopen(request, timeout=120) as response:
                body = response.read(50_000_001)
            if len(body) > 50_000_000:
                raise ValueError('GTFS download exceeds size limit')
            source = io.BytesIO(body)
        results[city] = build(city, source, today)
    # Validate both regions before replacing either snapshot. Hashed route files
    # keep open pages consistent across refreshes; retain prior route versions.
    for city, (index, files) in results.items():
        directory = args.output/city
        directory.mkdir(parents=True, exist_ok=True)
        for filename, content in files.items():
            (directory/filename).write_text(content+'\n')
        with tempfile.NamedTemporaryFile(mode='w', dir=directory, delete=False) as tmp:
            json.dump(index, tmp, separators=(',', ':'), ensure_ascii=False)
            tmp.write('\n')
        Path(tmp.name).replace(directory/'index.json')
        print(city, len(index['routes']), 'routes,', len(index['stops']), 'stops,', len(index['rapid']), 'rapid services')


if __name__ == '__main__':
    main()
