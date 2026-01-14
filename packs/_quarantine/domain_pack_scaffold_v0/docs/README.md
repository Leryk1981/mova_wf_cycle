# Domain Pack Scaffold v0

This pack provides a domain-specific agent pack scaffolder that generates role-aware agent bundles with customizable actions and policies.

## Features

- Role-based agent bundle generation (planner, executor, qa, notary)
- Configurable action definitions with driver support
- Policy enforcement with deny-by-default security model
- Pipeline-based workflow (plan → execute → verify → notarize)
- Evidence-first operational profile

## Usage

```bash
# Generate a domain pack scaffold
npm run demo:domain_pack_scaffold

# Run quality checks
npm run quality:domain_pack_scaffold
npm run quality:domain_pack_scaffold:neg
```

## Files

- `ds/` - Data schemas and request definitions
- `docs/examples/` - Sample requests for positive and negative testing
- `tools/` - Generation and quality assurance scripts
