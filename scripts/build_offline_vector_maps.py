#!/usr/bin/env python3
"""Extract self-hosted Shortbread PMTiles; preserve separately versioned routing."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import urllib.request
from build_offline_maps import REGIONS

BLOCK = 4 * 1024 * 1024
SOURCE = 'https://download.versatiles.org/osm-vector/osm-vector.20261027.versatiles'


def index_file(path):
    entries, offset = {}, 0
    with path.open('rb') as stream:
        if stream.read(8) != b'PMTiles\x03':
            raise ValueError('Expected PMTiles version 3: ' + str(path))
        stream.seek(0)
        while data := stream.read(BLOCK):
            entries[f'chunk-{len(entries)}'] = [offset, len(data), hashlib.sha256(data).hexdigest()]
            offset += len(data)
    if not 0 < offset < 2 * 1024 ** 3:
        raise ValueError('Package must fit a GitHub release asset; split the region: ' + str(path))
    return {'format': 'pmtiles', 'schema': 'shortbread', 'file': path.name,
            'bytes': offset, 'minZoom': 0, 'maxZoom': 14, 'entries': entries}


def build(output, routing_catalog, executable, source=SOURCE, reuse=None):
    output.mkdir(parents=True, exist_ok=True)
    version = 'offline-' + datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
    catalog = {'schema': 2, 'version': version, 'source': source,
               'attribution': '© OpenStreetMap contributors · ODbL 1.0 · tiles prepared by VersaTiles',
               'builtAt': datetime.now(timezone.utc).isoformat(), 'regions': []}
    for ident, name, bounds in REGIONS:
        path = output / f'{ident}-maps.pmtiles'
        if reuse and (reuse / path.name).is_file():
            shutil.copyfile(reuse / path.name, path)
        else:
            subprocess.run([executable, 'convert', '--bbox', ','.join(map(str, bounds)),
                            '--bbox-border', '1', '--min-zoom', '0', '--max-zoom', '14', '--compress', 'gzip',
                            source, str(path)], check=True)
        routing_region = next(r for r in routing_catalog['regions'] if r['id'] == ident)
        routing = dict(routing_region['components']['routing'])
        routing['version'] = routing.get('version', routing_catalog['version'])
        catalog['regions'].append({'id': ident, 'name': name, 'bounds': bounds,
                                  'components': {'maps': index_file(path), 'routing': routing}})
        print(f'{name}: {path.stat().st_size / 1048576:.1f} MiB', flush=True)
    (output / 'catalog-v2.json').write_text(json.dumps(catalog, separators=(',', ':')) + '\n')
    (output / 'SOURCE-LICENSE.txt').write_text(
        'Map tiles: VersaTiles, Shortbread schema. Source: ' + source + '\n'
        '© OpenStreetMap contributors, https://www.openstreetmap.org/copyright\n'
        'Open Database License 1.0: https://opendatacommons.org/licenses/odbl/1-0/\n'
        'Regional extraction: scripts/build_offline_vector_maps.py in GregoryMS/GregoryMS.\n'
        'Routing remains separately versioned and downloaded.\n')
    return catalog


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('work/offline-vector-packages'))
    parser.add_argument('--routing-catalog', default='https://github.com/GregoryMS/GregoryMS/releases/download/offline-current/catalog.json')
    parser.add_argument('--versatiles', default='versatiles')
    parser.add_argument('--source', default='latest')
    parser.add_argument('--reuse', type=Path)
    args = parser.parse_args()
    if args.routing_catalog.startswith('https://'):
        with urllib.request.urlopen(args.routing_catalog, timeout=60) as response:
            routing = json.load(response)
    else:
        routing = json.loads(Path(args.routing_catalog).read_text())
    source = args.source
    if source == 'latest':
        import re
        with urllib.request.urlopen('https://download.versatiles.org/', timeout=60) as response:
            page = response.read().decode()
        snapshots = re.findall(r'osm-vector\.(\d{8})\.versatiles', page)
        if not snapshots:
            raise ValueError('No dated VersaTiles snapshot is available.')
        source = 'https://download.versatiles.org/osm-vector/osm-vector.' + max(snapshots) + '.versatiles'
    build(args.output, routing, args.versatiles, source, args.reuse)


if __name__ == '__main__':
    main()
