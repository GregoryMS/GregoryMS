#!/usr/bin/env python3
"""Prepare a compact, locally searched GeoNames city/town index (CC BY 4.0)."""
import argparse
import gzip
import io
import json
from pathlib import Path
import zipfile


def build(cities, admin, output):
    regions = {}
    for line in admin.read_text().splitlines():
        values = line.split('\t')
        if len(values) >= 2:
            regions[values[0]] = values[1]
    rows = []
    with zipfile.ZipFile(cities) as archive:
        with archive.open('cities1000.txt') as source:
            for line in io.TextIOWrapper(source, encoding='utf-8'):
                p = line.rstrip('\n').split('\t')
                if len(p) < 19 or p[6] != 'P' or not (p[7] in {'PPL', 'PPLC', 'PPLG'} or p[7].startswith('PPLA')) or not p[17]:
                    continue
                lat, lon = float(p[4]), float(p[5])
                if not -90 <= lat <= 90 or not -180 <= lon <= 180:
                    continue
                rows.append([int(p[0]), p[1][:160], lat, lon, p[8], regions.get(p[8]+'.'+p[10], ''), p[17]])
    if len(rows) < 10000:
        raise ValueError('Incomplete city index')
    rows.sort(key=lambda row: row[0])
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(rows, ensure_ascii=False, separators=(',', ':')).encode()
    output.write_bytes(gzip.compress(payload, compresslevel=9, mtime=0))
    print(f'{len(rows):,} cities and towns, {output.stat().st_size:,} compressed bytes')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cities', type=Path, required=True)
    parser.add_argument('--admin', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('data/map-weather-cities.json.gz'))
    args = parser.parse_args()
    build(args.cities, args.admin, args.output)
