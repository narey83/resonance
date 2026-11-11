import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


MODULE = Path(__file__).with_name('enhanced-bundle.py')
spec = importlib.util.spec_from_file_location('enhanced_bundle', MODULE)
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class EnhancedBundleTests(unittest.TestCase):
    def test_config_rewrite_keeps_every_resource_inside_bundle(self):
        sources = [(Path('/source/models'), Path('models')),
                   (Path('/source/env'), Path('envs/enhanced'))]
        result = bundle.rewrite_config({'checkpoint': '/source/models/beat/model.pt',
                                        'python': '/source/env/bin/python'}, sources)
        self.assertEqual(result['checkpoint'], '@BUNDLE@/models/beat/model.pt')
        self.assertEqual(result['python'], '@BUNDLE@/envs/enhanced/bin/python')
        with self.assertRaises(ValueError):
            bundle.rewrite_config('/outside/private/model.pt', sources)

    def test_model_lock_rejects_missing_mismatched_and_traversal_assets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            models = root / 'models'
            models.mkdir()
            lock = root / 'lock.json'
            row = {'file': 'model.bin', 'bytes': 3,
                   'sha256': hashlib.sha256(b'abc').hexdigest()}
            lock.write_text(json.dumps({'files': [row]}))
            with self.assertRaises(ValueError):
                bundle.verify_models(models, lock)
            (models / 'model.bin').write_bytes(b'abc')
            bundle.verify_models(models, lock)
            (models / 'model.bin').write_bytes(b'xyz')
            with self.assertRaises(ValueError):
                bundle.verify_models(models, lock)
            row['file'] = '../escape'
            lock.write_text(json.dumps({'files': [row]}))
            with self.assertRaises(ValueError):
                bundle.verify_models(models, lock)


if __name__ == '__main__':
    unittest.main()
