"""Existing bridge behavior; real TCP byte transport, no API fixtures."""
import asyncio
import ipaddress
import unittest
from unittest.mock import patch

import vane_bridge_proxy as bridge


class ScopeEdgeTests(unittest.TestCase):
    def test_rejects_malformed_ipv6_and_neighbor_network(self):
        for peer in ('127.0.0.1', '172.23.0.2', '::1', '::ffff:172.22.0.2', 'invalid'):
            with self.subTest(peer=peer):
                self.assertFalse(bridge.allowed_peer(peer))


class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_relays_bytes_and_half_close(self):
        async def echo(reader, writer):
            writer.write(await reader.read())
            await writer.drain()
            writer.close()
            await writer.wait_closed()

        upstream = await asyncio.start_server(echo, '127.0.0.1', 0)
        port = upstream.sockets[0].getsockname()[1]
        # Only the test allows loopback, without changing production policy.
        with patch.object(bridge, 'NETWORK', ipaddress.ip_network('127.0.0.0/8')), patch.object(bridge, 'UPSTREAM_PORT', port):
            server = await asyncio.start_server(bridge.handle, '127.0.0.1', 0)
            async with upstream, server:
                reader, writer = await asyncio.open_connection('127.0.0.1', server.sockets[0].getsockname()[1])
                payload = bytes(range(256)) * 1024
                writer.write(payload)
                await writer.drain()
                writer.write_eof()
                self.assertEqual(await asyncio.wait_for(reader.read(), 5), payload)
                writer.close()
                await writer.wait_closed()
                await asyncio.sleep(0)

    async def test_rejected_peer_is_closed(self):
        server = await asyncio.start_server(bridge.handle, '127.0.0.1', 0)
        async with server:
            reader, writer = await asyncio.open_connection('127.0.0.1', server.sockets[0].getsockname()[1])
            self.assertEqual(await asyncio.wait_for(reader.read(), 5), b'')
            writer.close()
            await writer.wait_closed()


if __name__ == '__main__':
    unittest.main()
