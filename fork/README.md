# Fork: private/CGNAT web bind hosts

English | [中文](README.zh.md)

This directory holds everything needed to publish this fork to npm under a separate scope, independent of the upstream `@deepseek-ai/*` packages. It is self-contained and additive: nothing here changes the upstream package names.

## What this fork changes

The upstream webserver accepts loopback (`127.0.0.1`) and wildcard (`0.0.0.0`) bind hosts, while the `dsh web` CLI rejects wildcard binds. This fork additionally accepts private and CGNAT IPv4 literals (`10.x`, `172.16–31.x`, `192.168.x`, `100.64–127.x`) so `dsh web` can serve on a specific LAN or overlay address. Wildcard CLI binds and public IPs remain rejected.

Two source files carry the functional change:

- `packages/host/webserver/src/index.ts` widens the `SUPPORTED_BIND_HOST` regex that validates the `host` config.
- `packages/bundle/web-app/src/startup.ts` routes the `--host` flag through that validation.

`packages/host/directory-picker-auto` also differs, but only in JSDoc, so it is not republished.

## Why seven packages

The harness composes profiles by package name, so each changed package must propagate through every package that names it. The seven fork packages share one automatically selected fork version. The build resolves the `alpha` npm dist-tag once, then pins every untouched `@deepseek-ai/dsh-*` dependency to that exact version so npm and Bun cannot assemble different upstream generations.

| Fork package (`@preambient/…`) | Source | Role |
|---|---|---|
| `dsh-host-webserver` | `packages/host/webserver` | the bind-host change |
| `dsh-client-connection` | `packages/client/connection` | enables Host-only APIs behind a reverse proxy |
| `dsh-llm-pi-ai` | `packages/llm/llm-pi-ai` | adds per-session provider routing headers |
| `dsh-base` | `packages/bundle/base` | mounts the forked pi-ai provider |
| `dsh-web-app` | `packages/bundle/web-app` | mounts the forked webserver and connection packages |
| `dsh-app-boot` | `packages/boot/app-boot` | defines the profile bundle lists |
| `dsh` | `apps/cli` | installs the forked bundles and shared upstream packages |

## Build

`fork/build.mjs` reproduces the tarballs from a committed ref. It resolves the upstream `@alpha` release, stages that tagged source in a detached git worktree, applies the fork patches, renames the seven fork packages and their workspace references, rebuilds, rewrites their publication manifests, and packs the result into `fork/artifacts/`. The caller's working tree is not modified.

```sh
node fork/build.mjs                  # defaults: --scope @preambient --ref HEAD
node fork/build.mjs --scope @acme    # publish under a different organization
node fork/build.mjs --version 1.2.3  # bypass automatic version selection
node fork/build.mjs --keep           # keep the staging worktree for inspection
```

Without `--version`, the script reads the CLI version from `--ref` and queries all seven scoped package names on npm. It uses the source version when available; when any package already owns that version, it increments the final numeric prerelease identifier until the candidate is unused by all seven packages. A registry failure stops the build, and a used version without a numeric prerelease suffix requires an explicit `--version`.

Output lands in `fork/artifacts/<suffix>/<scope-without-@>-<suffix>-<version>.tgz`. The script prints the selected source and fork versions and the exact publish commands.

## Verify before publishing

A clean-consumer install verifies the package set:

```sh
cd "$(mktemp -d)" && npm init -y >/dev/null
npm install \
  /path/to/artifacts/dsh-host-webserver/*.tgz \
  /path/to/artifacts/dsh-client-connection/*.tgz \
  /path/to/artifacts/dsh-llm-pi-ai/*.tgz \
  /path/to/artifacts/dsh-base/*.tgz \
  /path/to/artifacts/dsh-app-boot/*.tgz \
  /path/to/artifacts/dsh-web-app/*.tgz \
  /path/to/artifacts/dsh/*.tgz
./node_modules/.bin/dsh --version
node -e 'import(".../node_modules/@preambient/dsh-host-webserver/lib/index.js").then(m => console.log(m.isSupportedBindHost("192.168.1.5")))'  # true
```

`dsh web --host 127.0.0.1 --port 0` should print a ready URL. A full `dsh web` boot also needs the `node-pty` native module. With npm, approve its install script first (`npm install-scripts approve node-pty`, then `npm rebuild node-pty`) because npm blocks it by default.

## Publish

Use the dependency-first commands printed by `fork/build.mjs`. From `fork/artifacts`, their stable form is:

```sh
cd fork/artifacts
npm publish ./dsh-host-webserver/*.tgz --tag next
npm publish ./dsh-client-connection/*.tgz --tag next
npm publish ./dsh-llm-pi-ai/*.tgz --tag next
npm publish ./dsh-base/*.tgz --tag next
npm publish ./dsh-app-boot/*.tgz --tag next
npm publish ./dsh-web-app/*.tgz --tag next
npm publish ./dsh/*.tgz --tag next
```

Notes:

- The `./` prefix is required because npm reads `owner/repo` as a GitHub shorthand.
- `--tag next` is required for prerelease versions. Consumers install with `@preambient/dsh@next` or an explicit version.
- `--access public` is unnecessary because every manifest carries `publishConfig.access: "public"`.
- npm versions are immutable. Rebuilding an already published version requires a new version rather than another publish attempt.

## Update an existing installation

Profiles are durable user state under `$DSH_HOME/profiles` (`~/.dsh/profiles` when `DSH_HOME` is unset); installing a newer fork package does not replace a profile's manifest or user patch. Back up the Harness home, then update only the fork-owned bundle name in `profiles/web/package.json`:

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@preambient/dsh-web-app"
      ]
    }
  }
}
```

Keep the existing `dependencies`, other manifest fields, `profiles/web/cordis.patch.yml`, and the home-level configuration files unchanged. For a non-default build scope, replace `@preambient` with that scope. Do not add the fork web-app with `dsh plugin add`: the web-app bundle ships with the forked CLI, and adding it as a profile dependency can leave the upstream and fork layers in the same bundle list.

Verify the stored layer and composed configuration before starting the server:

```sh
grep -A4 '"bundles"' "${DSH_HOME:-$HOME/.dsh}/profiles/web/package.json"
dsh --profile web --dump-default-config | grep '@preambient/dsh-web-app'
dsh web --host 192.168.1.5 --port 0
```

The first command should show one fork-scoped web-app bundle and no `@deepseek-ai/dsh-web-app`. The config dump must label the fork bundle before the server test. If the profile has intentional custom bundle layers, preserve their order and replace only the upstream web-app entry.

## Maintenance

- **Upstream release:** rebase on `upstream/master`, then build from the rebased ref. Automatic selection uses the `alpha` dist-tag for untouched upstream dependencies and chooses a free fork version.
- **New fork behavior:** if the fork changes another package, add it to `FORK_PACKAGES` and `SRC_REPLACE` or `SRC_REPLACE_EXACT` in `build.mjs`, then trace every bundle patch and profile that names it.
- **Vendored dependency release:** refresh `VENDORED` in `build.mjs` when upstream republishes a vendored Cordis package at another version.
- **OIDC provenance:** `repository.url` still points at upstream; rewrite it in `build.mjs` before adopting npm provenance.
