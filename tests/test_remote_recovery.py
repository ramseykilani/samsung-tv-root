import asyncio
import base64
from types import SimpleNamespace

from samsung_tv_root.config import parse_configuration
from samsung_tv_root.remote import RemoteInputCoordinator, RemoteInputSession

from samsung_tv_root.remote import RemoteInputServer
from samsung_tv_root.root_agent import encode_authenticated_frame


def test_remote_server_closes_connected_agent_without_waiting_for_peer():
    async def exercise():
        secret = b"s" * 32
        server = RemoteInputServer("127.0.0.1", frozenset({"127.0.0.1"}), secret)
        await server.start()
        reader, writer = await asyncio.open_connection("127.0.0.1", server.port)
        connection = None
        try:
            greeting = (await reader.readline()).decode().strip().split("\t")
            fields = [base64.b64encode(s.encode()).decode() for s in
                      ("Smart Control", "/dev/input/event5", "bluetooth", "unknown")]
            writer.write(encode_authenticated_frame(
                secret, bytes.fromhex(greeting[1]),
                "\t".join(("AUTH", "123", "0", "0", *fields, "filter")),
            ))
            await writer.drain()
            connection = await server.wait(1)
            await asyncio.wait_for(server.close(), 2)
            assert await asyncio.wait_for(reader.read(), 1) == b""
        finally:
            if connection is not None:
                await connection.close()
            writer.close()
            await writer.wait_closed()
            await server.close()

    asyncio.run(exercise())


def test_new_root_replaces_live_remote_and_recovers_after_disconnect():
    async def exercise():
        configuration = parse_configuration({
            "version": 1,
            "televisions": {"frame": {
                "model": "ls03d", "host": "127.0.0.1",
                "remote": {"enabled": True, "devices": [
                    {"name": "Smart Control", "transport": "bluetooth", "model": "unknown"}
                ]},
            }},
        })
        events = []
        peers = []
        coordinator = RemoteInputCoordinator(
            configuration.televisions[0], lambda topic, data: events.append(data),
            None, (0.01,),
        )

        async def launch(root, host, device):
            secret = b"s" * 32
            server = RemoteInputServer(host, frozenset({host}), secret)
            await server.start()
            reader, writer = await asyncio.open_connection(host, server.port)
            peers.append((reader, writer))
            greeting = (await reader.readline()).decode().strip().split("\t")
            fields = [base64.b64encode(s.encode()).decode() for s in
                      (device.name, "/dev/input/event5", "bluetooth", "unknown")]
            writer.write(encode_authenticated_frame(
                secret, bytes.fromhex(greeting[1]),
                "\t".join(("AUTH", "123", "0", "0", *fields, "filter")),
            ))
            await writer.drain()
            connection = await server.wait(1)
            task = asyncio.create_task(coordinator._read_events(device, connection, ()))
            return RemoteInputSession(device, connection, server, task)

        coordinator._launch = launch
        try:
            await coordinator.reconcile(SimpleNamespace(closed=False), "127.0.0.1")
            assert coordinator.snapshot()["active"]
            await asyncio.wait_for(coordinator.reconcile(
                SimpleNamespace(closed=False), "127.0.0.1"), 2)
            assert await asyncio.wait_for(peers[0][0].read(), 1) == b""
            assert coordinator.snapshot()["active"]
            peers[-1][1].close()
            await peers[-1][1].wait_closed()
            async with asyncio.timeout(2):
                while len(peers) < 3 or not coordinator.snapshot()["active"]:
                    await asyncio.sleep(0.01)
            assert any(e.get("event") == "disconnected" for e in events)
            assert coordinator.error is None
        finally:
            # Close peers first so cleanup also works against the unfixed code.
            for _, writer in peers:
                writer.close()
                await writer.wait_closed()
            await asyncio.wait_for(coordinator.close(), 2)

    asyncio.run(exercise())
