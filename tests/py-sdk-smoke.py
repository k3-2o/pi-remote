"""Python SDK smoke test — verifies connect, events, and chat."""
import asyncio, sys, os, time
import urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "examples"))

from pi_remote_ws import PiRemoteWS
from subprocess import Popen, DEVNULL
from pathlib import Path

PORT = "8094"
PID_FILE = Path.home() / ".pi" / "pi-server.pid"
ROOT = Path(__file__).parent.parent
passed = 0
failed = 0

def check(name, condition, detail=""):
    global passed, failed
    if condition:
        print(f"  OK  {name}{' (' + detail + ')' if detail else ''}")
        passed += 1
    else:
        print(f"  FAIL {name}")
        failed += 1

async def main():
    global passed, failed

    # Clean up
    try: PID_FILE.unlink()
    except: pass

    # Start server
    print("Starting pi-remote on port", PORT, "...")
    env = os.environ.copy()
    env["PI_SERVER_PORT"] = PORT
    server = Popen(
        ["node", str(ROOT / "dist" / "cli.js"), "start", "--port", PORT],
        env=env,
        stdout=DEVNULL,
        stderr=DEVNULL,
    )

    # Wait with retries
    ready = False
    for i in range(10):
        await asyncio.sleep(1)
        try:
            r = urllib.request.urlopen(f"http://127.0.0.1:{PORT}/v1/health")
            if r.status == 200:
                ready = True
                break
        except:
            pass
    if not ready:
        print("FATAL: server did not start")
        failed += 1
        server.kill()
        return

    try:
        client = PiRemoteWS(f"ws://localhost:{PORT}")
        await client.connect()
        print(f"Connected. Session: {client.session_id}\n")

        # Health check
        health = await client.health()
        check("health returns ok", health.get("status") == "ok",
              f"sessions={health.get('sessions')}")

        # List sessions
        sessions = await client.list_sessions()
        check("list_sessions returns list", isinstance(sessions, list),
              f"{len(sessions)} session(s)")
        check("own session in list",
              any(s["sessionId"] == client.session_id for s in sessions))

        # Chat with events
        events = {"tokens": [], "tool_starts": [], "tool_ends": [], "agent_end": 0}
        client.on("token", lambda t: events["tokens"].append(t))
        client.on("tool_start", lambda t: events["tool_starts"].append(t))
        client.on("tool_end", lambda t: events["tool_ends"].append(t))
        client.on("agent_end", lambda e: events.__setitem__("agent_end", events["agent_end"] + 1))

        print("Sending: 'run ls in the current directory'")
        result = await client.chat("run ls in the current directory")

        check("tokens received", len(events["tokens"]) > 0,
              f"{len(events['tokens'])} tokens")
        check("text accumulated", len(result["text"]) > 0,
              f"{len(result['text'])} chars")
        check("tool_start fired", len(events["tool_starts"]) > 0,
              f"{len(events['tool_starts'])} tool(s)")
        check("tool_end fired", len(events["tool_ends"]) > 0,
              f"{len(events['tool_ends'])} tool(s)")
        check("agent_end fired", events["agent_end"] > 0)
        check("session_id returned", bool(result.get("session_id")))

        # Raw commands
        state = await client.send_command({"type": "get_state"})
        check("raw send_command works", isinstance(state, dict))

        await client.close()
        check("close ok", True)

    except Exception as e:
        print(f"FATAL: {e}")
        import traceback; traceback.print_exc()
        failed += 1
    finally:
        server.kill()
        await asyncio.sleep(0.5)
        try: PID_FILE.unlink()
        except: pass

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed > 0 else 0)

asyncio.run(main())
