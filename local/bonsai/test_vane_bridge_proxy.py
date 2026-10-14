import unittest
import importlib.util
from pathlib import Path


class NetworkScopeTests(unittest.TestCase):
    def test_rejects_clients_outside_vane_docker_network(self):
        path = Path(__file__).with_name('vane_bridge_proxy.py')
        self.assertTrue(path.exists(), 'Docker bridge proxy is missing')
        spec = importlib.util.spec_from_file_location('vane_bridge_proxy', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertTrue(module.allowed_peer('172.22.0.2'))
        self.assertFalse(module.allowed_peer('100.94.95.76'))
        self.assertFalse(module.allowed_peer('8.8.8.8'))


if __name__ == '__main__':
    unittest.main()
