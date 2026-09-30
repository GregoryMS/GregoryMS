#!/usr/bin/env python3
"""Refresh the factual chart-site directory from the user-selected Clear Sky Chart map."""
import datetime
import json
import math
from pathlib import Path
import re
import subprocess
import sys

SOURCE = 'https://test.cleardarksky.com/browse/map.html'

def parse_directory(html):
    match = re.search(r'var\s+locations\s*=\s*(\[.*?\]);', html, re.S)
    if not match:
        raise ValueError('Chart directory format changed')
    records = json.loads(match.group(1))
    sites, seen = [], set()
    for r in records:
        key, name, lat, lon = r['key'], r['name'], r['lat'], r['lon']
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', key) or key in seen or not isinstance(name, str) or not name.strip():
            raise ValueError('Invalid or duplicate site')
        if not all(isinstance(n, (int, float)) and math.isfinite(n) for n in (lat, lon)) or abs(lat) > 90 or abs(lon) > 180:
            raise ValueError('Invalid coordinates')
        if not re.fullmatch(r'#[0-9a-fA-F]{6}', r['lp_color']):
            raise ValueError('Invalid map colour')
        seen.add(key)
        sites.append([key, name, lat, lon, r.get('lp_bortle', ''), r['lp_color']])
    if len(sites) < 5000:
        raise ValueError('Unexpectedly incomplete site directory')
    return sites

if __name__ == '__main__':
    html = Path(sys.argv[1]).read_text() if len(sys.argv) > 1 else subprocess.check_output(['curl', '--fail', '--location', '--max-time', '30', SOURCE], text=True)
    sites = parse_directory(html)
    payload = {'version': 1, 'updated': datetime.datetime.now(datetime.timezone.utc).date().isoformat(), 'source': SOURCE, 'sites': sites}
    out = Path(__file__).resolve().parents[1] / 'data' / 'astro-sites.json'
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f'Wrote {len(sites)} chart sites to {out}')
