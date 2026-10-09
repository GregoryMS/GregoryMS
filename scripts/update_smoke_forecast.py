"""Create Gregle's smoke overlays from BlueSky Canada's raw data (not its map images).

FireSmoke permits new public products using its data: https://firesmoke.ca/faq/
The output is atomic: metadata and our PNGs travel together in one JSON file.
"""
import argparse
import base64
import datetime as dt
import io
import json
from pathlib import Path
import tempfile
import urllib.request

import numpy as np
from PIL import Image
from scipy.io import netcdf_file

SOURCE = 'https://firesmoke.ca/forecasts/current/dispersion.nc'
# Custom Gregle palette, with concentration thresholds in micrograms/m3.
THRESHOLDS = [1, 10, 28, 60, 120, 250]
PALETTE = [(0, 0, 0, 0), (250, 222, 143, 155), (246, 185, 79, 170),
           (230, 130, 48, 185), (200, 78, 43, 200), (151, 48, 68, 215), (92, 36, 89, 230)]
UTC = dt.timezone.utc


def forecast_time(flag):
    day, clock = map(int, flag)
    parsed = dt.datetime.strptime(f'{day:07d}{clock:06d}', '%Y%j%H%M%S').replace(tzinfo=UTC)
    # NetCDF flags are hour END; label the hour START, matching FireSmoke's FAQ.
    return parsed - dt.timedelta(hours=1)


def rgba_grid(values):
    categories = np.digitize(values, THRESHOLDS)
    pixels = np.array(PALETTE, dtype=np.uint8)[categories]
    pixels[~np.isfinite(values) | (values < 0)] = (0, 0, 0, 0)
    return pixels


def build(path, now=None):
    now = now or dt.datetime.now(UTC)
    with netcdf_file(path, mmap=False) as nc:
        if int(nc.GDTYP) != 1 or int(nc.NLAYS) != 1:
            raise ValueError('Unsupported smoke grid projection or vertical layers')
        variable = nc.variables['PM25']
        if variable.units.strip() != b'ug/m^3':
            raise ValueError('Unexpected concentration units')
        values = variable.data[:, 0, :, :].copy()
        flags = nc.variables['TFLAG'].data[:, 0, :].copy()
        west, south, dx, dy = map(float, (nc.XORIG, nc.YORIG, nc.XCELL, nc.YCELL))
        rows, cols = values.shape[1:]
    if not (2 <= rows <= 3000 and 2 <= cols <= 4000 and dx > 0 and dy > 0):
        raise ValueError('Invalid smoke grid')
    # HYSPLIT output coordinates are grid points; half a cell encloses edge samples.
    bounds = [[south-dy/2, west-dx/2], [south+(rows-.5)*dy, west+(cols-.5)*dx]]
    if not (-85 < bounds[0][0] < bounds[1][0] < 85 and -180 <= bounds[0][1] < bounds[1][1] <= 180):
        raise ValueError('Invalid geographical bounds')
    times = [forecast_time(flag) for flag in flags]
    if len(times) < 2 or any(b-a != dt.timedelta(hours=1) for a,b in zip(times,times[1:])):
        raise ValueError('Expected contiguous hourly forecast')
    if times[0] > now+dt.timedelta(hours=6) or times[0] < now-dt.timedelta(hours=36) or times[-1] <= now:
        raise ValueError('Forecast is stale or future-dated')
    # Leaflet stretches images in Web Mercator. Resample latitude into Mercator
    # before encoding so northern smoke is not misplaced by linear stretching.
    mercator = lambda lat: np.log(np.tan(np.pi/4 + np.radians(lat)/2))
    height = 700
    edges = np.linspace(mercator(bounds[1][0]), mercator(bounds[0][0]), height+1)
    latitude = np.degrees(2*np.arctan(np.exp((edges[:-1]+edges[1:])/2))-np.pi/2)
    source_rows = np.clip(np.rint((latitude-south)/dy).astype(int), 0, rows-1)
    indices = list(range(0, len(times), 3))
    if indices[-1] != len(times)-1:
        indices.append(len(times)-1)
    frames = []
    for index in indices:
        grid = values[index]
        if not np.isfinite(grid).all() or np.any(grid < 0) or np.any(grid > 1e6):
            raise ValueError('Missing or invalid concentration data')
        image = Image.fromarray(rgba_grid(grid[source_rows]), 'RGBA')
        buffer = io.BytesIO()
        image.save(buffer, format='PNG', optimize=True)
        frames.append({'time': times[index].isoformat().replace('+00:00','Z'),
                       'image': 'data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode()})
    return {'source': SOURCE, 'credit': 'BlueSky Canada / FireSmoke.ca',
            'start': times[0].isoformat().replace('+00:00','Z'), 'bounds': bounds,
            'thresholds': THRESHOLDS, 'frames': frames}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as temporary:
        path = args.input or Path(temporary)/'dispersion.nc'
        if args.input is None:
            request = urllib.request.Request(SOURCE, headers={'User-Agent':'Gregle-Weather/1.0'})
            with urllib.request.urlopen(request, timeout=90) as response, path.open('wb') as output:
                size = 0
                while block := response.read(1024*1024):
                    size += len(block)
                    if size > 250*1024*1024:
                        raise ValueError('Forecast download exceeds size limit')
                    output.write(block)
        result = build(path)
    target = Path(__file__).resolve().parent.parent/'data'/'smoke-forecast.json'
    content = json.dumps(result, separators=(',',':'))+'\n'
    if target.exists() and target.read_text() == content:
        print('Smoke forecast unchanged')
        return
    staged = target.with_suffix('.tmp')
    staged.write_text(content)
    staged.replace(target)
    print(f'Updated {len(result["frames"])} smoke forecast frames ({len(content):,} bytes)')


if __name__ == '__main__':
    main()
