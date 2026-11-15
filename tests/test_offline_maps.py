import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('offline_builder', Path(__file__).resolve().parents[1] / 'scripts/build_offline_maps.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

class OfflineMapsTests(unittest.TestCase):
    def test_access_profiles_are_conservative_and_specific(self):
        self.assertEqual(builder.profiles({'highway':'motorway'})[:2], (True, False))
        self.assertEqual(builder.profiles({'highway':'footway'})[:2], (False, True))
        self.assertEqual(builder.profiles({'highway':'residential','access':'private'})[:2], (False, False))
        self.assertEqual(builder.profiles({'highway':'residential','motor_vehicle':'no','foot':'yes'})[:2], (False, True))
        self.assertFalse(builder.profiles({'highway':'residential','motor_vehicle:conditional':'no @ (winter)'})[0])
        self.assertAlmostEqual(builder.profiles({'highway':'primary','maxspeed':'30 mph'})[2], 48.28032)
        self.assertEqual(builder.direction({'junction':'roundabout'}), 1)
        self.assertEqual(builder.direction({'oneway':'-1'}), -1)

    def test_real_package_builder_preserves_routable_geometry_and_hashes(self):
        try:
            import osmium
        except ImportError:
            self.skipTest('Pyosmium is installed by the package-build workflow')
        xml='''<osm version="0.6"><node id="1" lat="48.42" lon="-123.37"/><node id="2" lat="48.42" lon="-123.365"/><node id="3" lat="48.42" lon="-123.36"/><node id="4" lat="48.43" lon="-123.36"/>
        <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="residential"/><tag k="oneway" v="yes"/><tag k="name" v="Test Street"/></way>
        <way id="20"><nd ref="3"/><nd ref="4"/><tag k="highway" v="residential"/></way>
        <relation id="30"><member type="way" ref="10" role="from"/><member type="node" ref="3" role="via"/><member type="way" ref="20" role="to"/><tag k="type" v="restriction"/><tag k="restriction" v="no_left_turn"/></relation></osm>'''
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'fixture.osm';source.write_text(xml)
            original=builder.REGIONS;builder.REGIONS=original[:1]
            try: builder.build(source, root/'out', 'offline-20261115000000')
            finally: builder.REGIONS=original
            catalog=json.loads((root/'out/catalog.json').read_text())
            component=catalog['regions'][0]['components']['routing']
            archive=(root/'out'/component['file']).read_bytes();nodes={}
            for offset, length, digest in component['entries'].values():
                packed=archive[offset:offset+length]
                self.assertEqual(hashlib.sha256(packed).hexdigest(),digest)
                nodes.update(json.loads(gzip.decompress(packed)))
            self.assertNotIn('2',nodes, 'shape nodes are compressed, preserving geometry')
            edge=next(e for e in nodes['1'][2] if e[0]==3)
            self.assertEqual(len(edge[5]),3)
            reverse=next(e for e in nodes['3'][2] if e[0]==1)
            self.assertEqual(reverse[3],0);self.assertGreater(reverse[4],0)
            self.assertEqual(nodes['3'][3],[[10,[20],False,False]])
