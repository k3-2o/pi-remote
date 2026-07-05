# pi-server — command runner
# see https://just.systems/man/en/

set positional-arguments := true

# Format all source files
fmt:
    npx prettier --write 'src/' 'tests/' '*.mjs'

# Check formatting only
fmt-check:
    npx prettier --check 'src/' 'tests/' '*.mjs'

# Type-check without emitting
types:
    npx tsc --noEmit

# Security audit
audit:
    npm audit --audit-level=high

# All static analysis
check: fmt-check types audit

# Run tests
test:
    npx vitest run

# Run tests with coverage
test-cov:
    npx vitest run --coverage

# Run tests in watch mode
test-watch:
    npx vitest --watch

# Build for production
build:
    node build.mjs
    npx tsc --emitDeclarationOnly

# Clean build artifacts
clean:
    rm -rf dist/

# Full CI pipeline
ci: check test build

# Smoke test (verify binary runs)
smoke:
    node dist/cli.js --version

# List outdated dependencies
outdated:
    npm outdated

# Update all dependencies
update:
    npx taze latest --write
    npm install
