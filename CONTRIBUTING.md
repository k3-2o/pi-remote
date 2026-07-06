# Contributing to pi-remote

pi-remote has a focused scope: a thin server runtime that wraps Pi's RPC mode behind WebSocket + HTTP. It is not a general-purpose platform or framework.

**Before writing code:**
- Open an issue describing what you want to do and why
- Wait for a response — the scope is narrow and not everything fits

**Pull requests:**
- PRs without a prior issue discussion will be closed
- Keep changes minimal and focused
- Run `just ci` before submitting — all tests must pass
- Follow the existing code style (Prettier, already configured)

**What fits:**
- Bug fixes
- Performance improvements
- Protocol compatibility with Pi updates
- Tests for untested paths

**What doesn't fit:**
- New transports (gRPC, MCP, etc.)
- Dashboard/UI features (that's the `attach` TUI, a separate project)
- Platform-specific integrations (Discord, Telegram — those are user glue code)
- Database backends, persistence layers
