# Upgrading the Sails SDK baseline

This starter intentionally pins exact Sails package versions so a clean clone
remains reproducible.

Current baseline:

- `@satsails/p2p-trading-sdk@0.2.0`
- `@satsails/sdk-react@0.2.0`
- `@satsails/p2p-schemas@0.2.0` transitively

## Upgrade procedure

1. Confirm the new package release is published and registry-verified.
2. Update the direct package versions in `package.json`.
3. Regenerate the lockfile from the public npm registry.
4. Verify the resolved SDK, React binding and schema package versions.
5. Run:
   ```bash
   npm ci
   npm test -- --runInBand
   npm run typecheck
   npm run build
   ```
6. Re-run the standalone examples against a compatible Sails node.
7. Reconcile README/docs with any changed public behavior before merge.

Do not point this starter at workspace-local package paths to make an upgrade
pass. The repository exists specifically to prove external registry
consumption.

A green monorepo build does not prove a published package is consumable.
