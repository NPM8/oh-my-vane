"""Docker-network-only TCP bridge to the loopback Bonsai inference server."""
import asyncio
import ipaddress

BIND_HOST = '172.22.0.1'
BIND_PORT = 8084
UPSTREAM_HOST = '127.0.0.1'
UPSTREAM_PORT = 8080
NETWORK = ipaddress.ip_network('172.22.0.0/16')


def allowed_peer(address):
    try:
        return ipaddress.ip_address(address) in NETWORK
    except ValueError:
        return False


async def pipe(reader, writer):
    while data := await reader.read(65536):
        writer.write(data)
        await writer.drain()
    if writer.can_write_eof():
        writer.write_eof()


async def handle(reader, writer):
    peer = writer.get_extra_info('peername')
    upstream = None
    try:
        if not peer or not allowed_peer(peer[0]):
            return
        upstream_reader, upstream = await asyncio.wait_for(
            asyncio.open_connection(UPSTREAM_HOST, UPSTREAM_PORT), timeout=10
        )
        await asyncio.wait_for(asyncio.gather(
            pipe(reader, upstream), pipe(upstream_reader, writer)
        ), timeout=3600)
    except (OSError, asyncio.TimeoutError, ConnectionError):
        pass
    finally:
        writer.close()
        if upstream:
            upstream.close()


async def main():
    server = await asyncio.start_server(handle, BIND_HOST, BIND_PORT, limit=131072)
    print(f'Vane bridge {BIND_HOST}:{BIND_PORT} -> {UPSTREAM_HOST}:{UPSTREAM_PORT}; peers restricted to {NETWORK}', flush=True)
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    asyncio.run(main())
