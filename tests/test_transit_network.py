import datetime as dt
import importlib.util
import io
from pathlib import Path
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('transit_network', Path(__file__).resolve().parents[1]/'scripts/update_transit_network.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TransitNetworkTest(unittest.TestCase):
    def test_exceptions_override_calendar_and_future_services_are_excluded(self):
        source = io.BytesIO()
        with zipfile.ZipFile(source, 'w') as z:
            z.writestr('calendar.txt', 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nweek,1,1,1,1,1,1,1,20261101,20261130\nfuture,1,1,1,1,1,1,1,20261201,20261231\n')
            z.writestr('calendar_dates.txt', 'service_id,date,exception_type\nextra,20261115,1\nfuture,20261202,1\n'+''.join(f'week,202611{day},2\n' for day in range(14,22)))
        source.seek(0)
        with zipfile.ZipFile(source) as z:
            self.assertEqual(module.active_services(z, dt.date(2026,11,14)), {'extra'})

    def test_simplification_keeps_endpoints_and_road_bends(self):
        points = [[48.4,-123.4],[48.401,-123.4],[48.402,-123.4],[48.402,-123.399]]
        self.assertEqual(module.simplify(points), [points[0],points[2],points[3]])


if __name__ == '__main__':
    unittest.main()
