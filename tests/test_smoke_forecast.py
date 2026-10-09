import datetime as dt
import importlib.util
from pathlib import Path
import tempfile
import unittest

try:
    import numpy as np
    from scipy.io import netcdf_file
    spec = importlib.util.spec_from_file_location('smoke', Path(__file__).resolve().parents[1]/'scripts'/'update_smoke_forecast.py')
    smoke = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(smoke)
except ImportError:
    raise unittest.SkipTest('Scientific dependencies are installed and tested by smoke-forecast.yml')


class SmokeTests(unittest.TestCase):
    def test_hour_end_becomes_hour_start(self):
        self.assertEqual(smoke.forecast_time([2026001, 0]), dt.datetime(2025,12,31,23,tzinfo=dt.timezone.utc))

    def test_legend_thresholds_and_missing_values(self):
        values = np.array([[0, .9, 1, 10, 28, 60, 120, 250, np.nan, -1]])
        pixels = smoke.rgba_grid(values)
        self.assertEqual(pixels[0, 0, 3], 0)
        self.assertEqual(pixels[0, 1, 3], 0)
        for index in range(2, 8):
            self.assertEqual(tuple(pixels[0,index]), smoke.PALETTE[index-1])
        self.assertEqual(pixels[0,8,3], 0)
        self.assertEqual(pixels[0,9,3], 0)

    def test_small_grid_projection_time_and_staleness(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'test.nc'
            with netcdf_file(path, 'w') as nc:
                for name,size in [('TSTEP',4),('LAY',1),('ROW',3),('COL',4),('VAR',1),('DATE-TIME',2)]: nc.createDimension(name,size)
                nc.GDTYP=1;nc.NLAYS=1;nc.XORIG=-124.;nc.YORIG=48.;nc.XCELL=.1;nc.YCELL=.1
                pm=nc.createVariable('PM25','f',('TSTEP','LAY','ROW','COL'));pm.units='ug/m^3';pm[:]=np.ones((4,1,3,4))*30
                flags=nc.createVariable('TFLAG','i',('TSTEP','VAR','DATE-TIME'));flags[:]=[[[2026282,t]] for t in [90000,100000,110000,120000]]
            now=dt.datetime(2026,10,9,10,tzinfo=dt.timezone.utc)
            result=smoke.build(path,now)
            self.assertEqual(len(result['frames']),2)
            self.assertEqual(result['frames'][0]['time'],'2026-10-09T08:00:00Z')
            self.assertTrue(result['frames'][0]['image'].startswith('data:image/png;base64,iVBOR'))
            self.assertAlmostEqual(result['bounds'][0][0],47.95)
            with self.assertRaises(ValueError):smoke.build(path,now+dt.timedelta(days=3))

if __name__ == '__main__':
    unittest.main()
