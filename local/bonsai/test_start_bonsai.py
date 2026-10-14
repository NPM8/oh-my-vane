"""Launcher contract checks: temporary capture script, no inference/downloads."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class LauncherTests(unittest.TestCase):
    def test_portable_profile_uses_selected_checkout(self):
        launcher = Path(__file__).with_name('start-bonsai.sh')
        self.assertTrue(launcher.is_file(), 'portable launcher is missing')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for custom in (False, True):
                with self.subTest(custom_checkout=custom):
                    checkout = root / ('custom checkout' if custom else 'projects/Bonsai-demo')
                    scripts = checkout / 'scripts'
                    scripts.mkdir(parents=True)
                    capture = scripts / 'start_llama_server.sh'
                    capture.write_text('#!/usr/bin/env python3\nimport os, sys, json\nprint(json.dumps({"env": dict(os.environ), "args": sys.argv[1:]}))\n')
                    capture.chmod(0o755)
                    env = dict(os.environ, HOME=str(root), LD_LIBRARY_PATH='/existing/libs')
                    env.pop('BONSAI_DIR', None)
                    if custom:
                        env['BONSAI_DIR'] = str(checkout)
                    result = subprocess.run(['sh', str(launcher), '--test-marker', 'two words'], env=env, text=True, capture_output=True, check=True)
                    actual = json.loads(result.stdout)
                    expected = {'BONSAI_FAMILY': 'bonsai2', 'BONSAI_MODEL': '27B', 'BONSAI_HOST': '127.0.0.1', 'PORT': '8080', 'BONSAI_NGL': '999', 'BONSAI_CTX': '262144', 'BONSAI_KV4': '0', 'BONSAI_MMPROJ_CPU': '1', 'BONSAI_LLAMA_BIN': str(checkout / 'bin/cuda'), 'LD_LIBRARY_PATH': str(checkout / '.venv/lib/python3.11/site-packages/nvidia/cu13/lib') + ':/existing/libs'}
                    for key, value in expected.items():
                        self.assertEqual(actual['env'][key], value, key)
                    self.assertEqual(actual['args'], ['--alias', 'bonsai-2-27b', '--parallel', '1', '--cache-type-k', 'f16', '--cache-type-v', 'q8_0', '--n-predict', '32768', '--reasoning-budget', '8192', '--chat-template-kwargs', '{"reasoning_effort":"medium"}', '--test-marker', 'two words'])


if __name__ == '__main__':
    unittest.main()
