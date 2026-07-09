# Version Bump Checklist

When bumping the version, only two layers need manual updates:

## 1. Source of truth

```
package.json    → "version": "X.Y.Z"
```

That's it. `src/version.ts` reads from `package.json` at startup. All server endpoints, CLI, and WebSocket welcome
automatically report the new version.

## 2. Docs (example output)

These show the old version in example command output. They don't affect behavior, just keep them realistic.

```
docs/getting-started.md           4 occurrences
docs/tutorials/deploy-to-vps.md   5 occurrences
docs/tutorials/your-first-chat.md 3 occurrences
docs/reference/cli.md             2 occurrences
docs/reference/protocol.md        1 occurrence
```

## One-liner (from project root)

```bash
OLD="0.2.1" NEW="0.2.2"
sed -i "s/$OLD/$NEW/g" docs/getting-started.md docs/tutorials/deploy-to-vps.md \
  docs/tutorials/your-first-chat.md docs/reference/cli.md docs/reference/protocol.md
```

Then verify:

```bash
rg -rn "$OLD" src/ docs/ --include="*.md" --include="*.ts" | grep -v node_modules
```

```bash
node build.mjs && node dist/cli.js --version   # should print new version
```
