import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import build_offline_vector_maps as maps


class VectorPackages(unittest.TestCase):
    def test_index_hashes_bounded_blocks_and_rejects_other_formats(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'region.pmtiles'
            file.write_bytes(b'PMTiles\x03' + b'x' * (maps.BLOCK + 12))
            index = maps.index_file(file)
            self.assertEqual(index['bytes'], maps.BLOCK + 20)
            self.assertEqual([v[1] for v in index['entries'].values()], [maps.BLOCK, 20])
            with file.open('rb') as stream:
                for offset, size, digest in index['entries'].values():
                    stream.seek(offset)
                    self.assertEqual(hashlib.sha256(stream.read(size)).hexdigest(), digest)
            file.write_bytes(b'not a PMTiles file')
            with self.assertRaises(ValueError):
                maps.index_file(file)

    def test_catalog_keeps_routing_versions_independent_and_all_presets(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            reuse = root / 'source'
            reuse.mkdir()
            routing = {'version': 'offline-20261115034348', 'regions': []}
            for ident, name, bounds in maps.REGIONS:
                (reuse / f'{ident}-maps.pmtiles').write_bytes(b'PMTiles\x03test')
                routing['regions'].append({'id': ident, 'components': {'routing': {'file': ident + '-routing.bin', 'bytes': 12, 'entries': {}}}})
            catalog = maps.build(root / 'output', routing, 'must-not-run', reuse=reuse)
            self.assertEqual(catalog['schema'], 2)
            self.assertEqual(len(catalog['regions']), 5)
            for region in catalog['regions']:
                self.assertEqual(region['components']['maps']['format'], 'pmtiles')
                self.assertEqual(region['components']['routing']['version'], routing['version'])
            self.assertEqual(json.loads((root / 'output/catalog-v2.json').read_text()), catalog)


if __name__ == '__main__':
    unittest.main()
