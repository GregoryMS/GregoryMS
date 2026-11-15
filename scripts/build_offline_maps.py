#!/usr/bin/env python3
"""Build browser-readable, sharded ODbL street maps and road graphs from OSM PBF.

No third-party tiles or online route responses are copied. Package members are
individually compressed and indexed, so a browser never parses a province-sized
JSON document. Temporary geometry lives in SQLite rather than Python objects.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3
import tempfile

REGIONS = [
    ('victoria', 'Victoria', [-123.43, 48.38, -123.30, 48.47]),
    ('greater-victoria', 'Greater Victoria', [-123.85, 48.28, -123.25, 48.75]),
    ('vancouver-island', 'Vancouver Island', [-128.6, 48.25, -123.2, 51.1]),
    ('greater-vancouver', 'Greater Vancouver', [-123.55, 48.95, -122.35, 49.6]),
    ('british-columbia', 'British Columbia', [-139.1, 48.25, -114.0, 60.01]),
]
SOURCE = 'https://download.geofabrik.de/north-america/canada/british-columbia.html'
ROAD_SPEED = {'motorway': 100, 'trunk': 80, 'primary': 60, 'secondary': 50,
              'tertiary': 50, 'unclassified': 40, 'residential': 30,
              'living_street': 10, 'service': 15}
DENIED = {'no', 'private', 'destination', 'customers', 'delivery', 'agricultural', 'forestry'}
WALK_ROADS = set(ROAD_SPEED) | {'footway', 'path', 'pedestrian', 'steps', 'track',
                             'cycleway', 'bridleway'}


def tile(lat, lng):
    return f'{math.floor(lng * 4)}_{math.floor(lat * 4)}'


def inside(lat, lng, bounds):
    return bounds[0] <= lng <= bounds[2] and bounds[1] <= lat <= bounds[3]


def intersects(a, b):
    return a[0] <= b[2] and a[2] >= b[0] and a[1] <= b[3] and a[3] >= b[1]


def bounds_of(points):
    return [min(p[1] for p in points), min(p[0] for p in points),
            max(p[1] for p in points), max(p[0] for p in points)]


def distance(a, b):
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(math.radians(b[1]-a[1])/2)**2
    return 12742000 * math.asin(min(1, math.sqrt(h)))


def access(tags, profile):
    # Unknown conditional restrictions are conservatively excluded; local
    # opening hours and seasonal gates cannot be resolved without a rule engine.
    keys = ['access', 'vehicle', 'motor_vehicle', 'motorcar'] if profile == 'driving' else ['access', 'foot']
    if any(tags.get(k + ':conditional') for k in keys) or profile == 'driving' and tags.get('oneway:conditional'):
        return False
    value = next((tags[k] for k in reversed(keys) if k in tags), 'yes')
    return value not in DENIED


def profiles(tags):
    highway = tags.get('highway', '')
    ferry = tags.get('route') == 'ferry'
    base = highway.removesuffix('_link')
    drive = (base in ROAD_SPEED or highway == 'track' or ferry) and access(tags, 'driving')
    walk = (base in WALK_ROADS and base not in {'motorway', 'trunk'} or ferry) and access(tags, 'walking')
    if tags.get('foot') in {'yes', 'designated', 'permissive'} and access(tags, 'walking'):
        walk = True
    speed = ROAD_SPEED.get(base, 15)
    match = re.fullmatch(r'(\d+(?:\.\d+)?)\s*(mph|km/h|kmh|kph)?', tags.get('maxspeed', ''))
    if match:
        speed = min(130, max(5, float(match[1]) * (1.609344 if match[2] == 'mph' else 1)))
    return drive, walk, (20 if ferry else speed)


def direction(tags):
    value = tags.get('oneway', 'yes' if tags.get('junction') in {'roundabout', 'circular'} or tags.get('highway') == 'motorway' else '')
    return -1 if value == '-1' else 1 if value in {'yes', '1', 'true'} else 0


def dumps(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False)


def build(source, output, version):
    import osmium
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='gregle-offline-') as temp:
        db = sqlite3.connect(Path(temp) / 'geometry.sqlite')
        db.executescript('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; '
                         'CREATE TABLE maps (tile TEXT, data TEXT); '
                         'CREATE TABLE ways (data TEXT); '
                         'CREATE TABLE graph (tile TEXT, id INTEGER, data TEXT);')
        counts = Counter()
        barriers = {}
        restrictions = defaultdict(list)
        forced = set()
        complex_rules = defaultdict(list)

        class Handler(osmium.SimpleHandler):
            def node(self, node):
                tags = dict(node.tags)
                if 'barrier' in tags and tags['barrier'] not in {'entrance', 'cattle_grid', 'toll_booth', 'border_control'}:
                    barriers[node.id] = [not access(tags, 'driving') or tags.get('motorcar', tags.get('motor_vehicle', '')) not in {'yes', 'permissive'} , not access(tags, 'walking') or tags['barrier'] in {'wall', 'fence'}]
                if tags.get('place') in {'city', 'town', 'village', 'suburb', 'hamlet'} and tags.get('name'):
                    self.feature([node.location.lat, node.location.lon], 'place', tags['name'], False)

            def feature(self, points, kind, name='', polygon=False):
                if kind == 'place':
                    key = tile(*points)
                else:
                    # Replicate crossing features into touched cells. Map members
                    # are independently drawable at a region/chunk boundary.
                    bbox = bounds_of(points)
                    if (bbox[2]-bbox[0]) * (bbox[3]-bbox[1]) > 20:
                        return
                    keys = [f'{x}_{y}' for x in range(math.floor(bbox[0]*4), math.floor(bbox[2]*4)+1)
                            for y in range(math.floor(bbox[1]*4), math.floor(bbox[3]*4)+1)]
                    data = dumps([kind, name[:160], points, polygon])
                    db.executemany('INSERT INTO maps VALUES (?,?)', [(key, data) for key in keys])
                    return
                db.execute('INSERT INTO maps VALUES (?,?)', (key, dumps([kind, name[:160], points, False])))

            def way(self, way):
                tags = dict(way.tags)
                highway = tags.get('highway', '')
                kind = 'road' if highway and highway not in {'construction', 'proposed', 'raceway'} else ''
                if tags.get('route') == 'ferry':
                    kind = 'ferry'
                if not kind:
                    kind = 'water' if tags.get('natural') in {'water', 'coastline'} or tags.get('waterway') in {'river', 'stream', 'riverbank'} else 'park' if tags.get('leisure') in {'park', 'nature_reserve', 'golf_course'} or tags.get('landuse') in {'forest', 'grass', 'recreation_ground'} else ''
                if not kind:
                    return
                try:
                    nodes = [[n.ref, round(n.lat, 6), round(n.lon, 6)] for n in way.nodes]
                except osmium.InvalidLocationError:
                    return
                if len(nodes) < 2:
                    return
                coords = [n[1:] for n in nodes]
                polygon = nodes[0][0] == nodes[-1][0] and kind in {'water', 'park'}
                self.feature(coords, highway or kind, tags.get('name', tags.get('ref', '')), polygon)
                drive, walk, speed = profiles(tags)
                if not drive and not walk:
                    return
                counts.update(n[0] for n in nodes)
                forced.update([nodes[0][0], nodes[-1][0]])
                keep = {k: v for k, v in tags.items() if k in {'oneway', 'oneway:foot', 'junction', 'name', 'ref', 'highway', 'route'}}
                db.execute('INSERT INTO ways VALUES (?)', (dumps([way.id, nodes, keep, drive, walk, speed]),))

            def relation(self, relation):
                tags = dict(relation.tags)
                if tags.get('type') != 'restriction' or 'motorcar' in tags.get('except', '').split(';') or 'motor_vehicle' in tags.get('except', '').split(';'):
                    return
                restriction = tags.get('restriction:motorcar', tags.get('restriction:motor_vehicle', tags.get('restriction', tags.get('restriction:conditional', '').split(' @')[0])))
                if not restriction.startswith(('no_', 'only_')):
                    return
                frm = [m.ref for m in relation.members if m.role == 'from' and m.type == 'w']
                to = [m.ref for m in relation.members if m.role == 'to' and m.type == 'w']
                via_nodes = [m.ref for m in relation.members if m.role == 'via' and m.type == 'n']
                via_ways = [m.ref for m in relation.members if m.role == 'via' and m.type == 'w']
                if not frm or not to:
                    return
                if len(via_nodes) == 1:
                    for incoming in frm:
                        restrictions[via_nodes[0]].append([incoming, to, restriction.startswith('only_'), restriction == 'no_u_turn'])
                    forced.add(via_nodes[0])
                elif via_ways:
                    # Fail closed for complex via-way rules: block entry into
                    # the affected via way rather than allow an illegal turn.
                    for incoming in frm:
                        complex_rules[incoming].append(via_ways[0])

        handler = Handler()
        print('Indexing OSM locations and reading tagged map features', flush=True)
        handler.apply_file(str(source), locations=True, idx=f'sparse_file_array,{temp}/nodes.idx', filters=[
            osmium.filter.KeyFilter('barrier', 'place').enable_for(osmium.osm.NODE),
            osmium.filter.KeyFilter('highway', 'route', 'natural', 'waterway', 'leisure', 'landuse').enable_for(osmium.osm.WAY),
            osmium.filter.KeyFilter('restriction', 'restriction:conditional', 'restriction:motorcar', 'restriction:motor_vehicle').enable_for(osmium.osm.RELATION),
        ])
        db.commit()
        print('Read OSM features; compressing navigable intersections', flush=True)
        forced.update(barriers)
        forced.update(n for n, count in counts.items() if count > 1)
        del counts
        node_rows = {}
        # SQLite-backed road staging keeps the full province out of memory.
        for (raw,) in db.execute('SELECT data FROM ways'):
            way, nodes, tags, drive, walk, speed = json.loads(raw)
            start = 0
            for index in range(1, len(nodes)):
                if nodes[index][0] not in forced:
                    continue
                section = nodes[start:index+1]
                length = sum(distance(a[1:], b[1:]) for a, b in zip(section, section[1:]))
                if length <= 0:
                    start = index
                    continue
                times = [round(length / (speed/3.6), 2) if drive else 0,
                         round(length / (20/3.6 if tags.get('route') == 'ferry' else 3/3.6 if tags.get('highway') == 'steps' else 1.4), 2) if walk else 0]
                one = direction(tags)
                for reverse in (False, True):
                    points = list(reversed(section)) if reverse else section
                    a, b = points[0], points[-1]
                    costs = list(times)
                    if one == (-1 if not reverse else 1):
                        costs[0] = 0
                    foot_one = tags.get('oneway:foot')
                    if foot_one == ('-1' if not reverse else 'yes'):
                        costs[1] = 0
                    if not any(costs):
                        continue
                    record = node_rows.setdefault(a[0], [a[1], a[2], [], restrictions.get(a[0], []), barriers.get(a[0], [False, False])])
                    # to-id, shard, way, driving seconds, walking seconds,
                    # lat/lng geometry, name, road class, fail-closed via ways.
                    record[2].append([b[0], tile(*b[1:]), way, *costs, [p[1:] for p in points], tags.get('name', tags.get('ref', '')), tags.get('junction', tags.get('highway', 'ferry')), complex_rules.get(way, [])])
                    node_rows.setdefault(b[0], [b[1], b[2], [], restrictions.get(b[0], []), barriers.get(b[0], [False, False])])
                start = index
        by_via = defaultdict(list)
        for incoming, vias in complex_rules.items():
            for via in vias:
                by_via[via].append(incoming)
        for record in node_rows.values():
            for edge in record[2]:
                for incoming in by_via.get(edge[2], []):
                    record[3].append([incoming, [edge[2]], False, False])
        db.executemany('INSERT INTO graph VALUES (?,?,?)', [(tile(row[0], row[1]), ident, dumps(row)) for ident, row in node_rows.items()])
        del node_rows
        db.executescript('CREATE INDEX map_tiles ON maps(tile); CREATE INDEX graph_tiles ON graph(tile);')
        db.commit()
        catalog = {'schema': 1, 'version': version, 'source': SOURCE,
                   'attribution': '© OpenStreetMap contributors · ODbL 1.0',
                   'builtAt': datetime.now(timezone.utc).isoformat(), 'regions': []}
        for ident, name, bounds in REGIONS:
            info = {'id': ident, 'name': name, 'bounds': bounds, 'components': {}}
            for component, table in [('maps', 'maps'), ('routing', 'graph')]:
                archive = output / f'{ident}-{component}.bin'
                entries = {}
                with archive.open('wb') as file:
                    if component == 'maps':
                        overview = []
                        seen = set()
                        for (raw,) in db.execute('SELECT data FROM maps'):
                            feature = json.loads(raw)
                            kind, label, points, polygon = feature
                            if kind not in {'place', 'motorway', 'trunk', 'primary', 'secondary', 'coastline'}:
                                continue
                            if not (inside(*points, bounds) if kind == 'place' else intersects(bounds_of(points), bounds)):
                                continue
                            digest = hashlib.sha256(raw.encode()).digest()
                            if digest in seen:
                                continue
                            seen.add(digest)
                            if kind != 'place' and len(points) > 8:
                                feature[2] = points[::max(1, len(points)//8)] + [points[-1]]
                            overview.append(feature)
                        packed = gzip.compress(dumps(overview).encode(), mtime=0)
                        entries['overview'] = [0, len(packed), hashlib.sha256(packed).hexdigest()]
                        file.write(packed)
                    for (key,) in db.execute(f'SELECT DISTINCT tile FROM {table} ORDER BY tile'):
                        x, y = map(int, key.split('_'))
                        if not intersects([x/4, y/4, (x+1)/4, (y+1)/4], bounds):
                            continue
                        rows = list(db.execute(f'SELECT {"id," if table == "graph" else ""}data FROM {table} WHERE tile=?', (key,)))
                        data = {str(row[0]): json.loads(row[1]) for row in rows} if table == 'graph' else [json.loads(row[0]) for row in rows]
                        packed = gzip.compress(dumps(data).encode(), mtime=0)
                        entries[key] = [file.tell(), len(packed), hashlib.sha256(packed).hexdigest()]
                        file.write(packed)
                if not entries:
                    raise ValueError(f'No {component} data for {ident}')
                info['components'][component] = {'file': archive.name, 'bytes': archive.stat().st_size, 'entries': entries}
                print(f'{name} {component}: {archive.stat().st_size / 1048576:.1f} MiB', flush=True)
            catalog['regions'].append(info)
        (output / 'catalog.json').write_text(dumps(catalog))
        (output / 'LICENSE.txt').write_text('© OpenStreetMap contributors\nOpen Database License 1.0: https://opendatacommons.org/licenses/odbl/1-0/\nSource: ' + SOURCE + '\nDerived databases and vector map data distributed under ODbL 1.0.\n')
        db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path('work/offline-packages'))
    parser.add_argument('--version', default=datetime.now(timezone.utc).strftime('offline-%Y%m%d%H%M%S'))
    args = parser.parse_args()
    if not re.fullmatch(r'offline-\d{8,14}', args.version):
        parser.error('version must be offline- followed by 8–14 digits')
    build(args.source, args.output, args.version)
