# Fork: private/CGNAT web bind hosts

This directory holds everything needed to publish this fork to npm under a
separate scope, independent of the upstream `@deepseek-ai/*` packages. It is
self-contained and additive: nothing here touches the rest of the tree, so it
merges cleanly against upstream.

## What this fork changes

`dsh web` upstream only accepts loopback (`127.0.0.1`) and wildcard (`0.0.0.0`)
bind hosts. This fork additionally accepts private and CGNAT IPv4 literals
(`10.x`, `172.16–31.x`, `192.168.x`, `100.64–127.x`) so `dsh web` can serve on a
specific LAN or overlay address. Wildcard remains rejected — it would expose
remote code execution — and public IPs remain rejected.

Two source files carry the change:

- `packages/host/webserver/src/index.ts` — widens the `SUPPORTED_BIND_HOST`
  regex that gates the `host` config schema.
- `packages/bundle/web-app/src/startup.ts` — routes the `--host` flag through
  that check.

(`packages/host/directory-picker-auto` also differs, but only a JSDoc comment,
so it is not republished.)

## Why four packages

The harness composes profiles by package name, so a leaf change must propagate
through every place that names it. Publishing just the four below, with every
other dependency pinned to the already-published `@deepseek-ai/*@0.1.0-rc.6`
versions, avoids mirroring the whole ~200-package monorepo:

| Fork package (`@preambient/…`) | Source | Role |
|---|---|---|
| `dsh-host-webserver` | `packages/host/webserver` | the bind-host change |
| `dsh-web-app` | `packages/bundle/web-app` | its `cordis.patch.yml` mounts the webserver by name |
| `dsh-app-boot` | `packages/boot/app-boot` | its `src/profile.ts` hardcodes the `web` profile's bundle list |
| `dsh` | `apps/cli` | the CLI entry; depends on the three above |

## Build

`fork/build.mjs` reproduces the tarballs from a committed ref. It stages a
detached git worktree (the working tree is never modified), renames the four
packages and every workspace reference to them, rebuilds, rewrites the
publication manifests, and packs into `fork/artifacts/`.

```sh
node fork/build.mjs                  # defaults: --scope @preambient --version 0.1.0-rc.6 --ref HEAD
node fork/build.mjs --scope @acme    # your org, if different
node fork/build.mjs --keep           # keep the staging worktree for inspection
```

Output lands in `fork/artifacts/<suffix>/<scope-without-@>-<suffix>-<version>.tgz`
and the script prints the exact publish commands.

## Verify before publishing

A clean-consumer install is the real proof. Install the four tarballs and probe:

```sh
cd "$(mktemp -d)" && npm init -y >/dev/null
npm install \
  /path/to/artifacts/dsh-host-webserver/*.tgz \
  /path/to/artifacts/dsh-app-boot/*.tgz \
  /path/to/artifacts/dsh-web-app/*.tgz \
  /path/to/artifacts/dsh/*.tgz
./node_modules/.bin/dsh --version
node -e 'import(".../node_modules/@preambient/dsh-host-webserver/lib/index.js").then(m => console.log(m.isSupportedBindHost("192.168.1.5")))'  # true
```

`dsh web --host 127.0.0.1 --port 0` should print a ready URL. A full `dsh web`
boot also needs the `node-pty` native module: with npm, approve its install
script first (`npm install-scripts approve node-pty` then `npm rebuild node-pty`),
because npm blocks it by default.

## Publish

```sh
cd fork/artifacts
npm publish ./dsh-host-webserver/preambient-dsh-host-webserver-0.1.0-rc.6.tgz --tag next
npm publish ./dsh-app-boot/preambient-dsh-app-boot-0.1.0-rc.6.tgz --tag next
npm publish ./dsh-web-app/preambient-dsh-web-app-0.1.0-rc.6.tgz --tag next
npm publish ./dsh/preambient-dsh-0.1.0-rc.6.tgz --tag next
```

Notes:

- The `./` prefix is required — npm reads `owner/repo` as a GitHub shorthand.
- `--tag next` is required because `0.1.0-rc.6` is a prerelease; npm refuses to
  assign `latest` to it. Consumers then install with `@preambient/dsh@next` or
  the explicit version.
- `--access public` is unnecessary; every manifest carries
  `publishConfig.access: "public"`.

## Maintenance

- **Upstream version bump**: pass the new `--version` (the fork packages and
  their `@deepseek-ai/dsh-*` ranges are pinned to it), and refresh the
  `VENDORED` map in `build.mjs` if upstream republished the vendored Cordis
  packages at new versions.
- **New fork behavior**: if the fork changes a different package, add it to
  `FORK_PACKAGES` and `SRC_REPLACE`/`SRC_REPLACE_EXACT` in `build.mjs`, then
  trace its name-mounts the same way (bundle patches, `PROFILE_TEMPLATES`).
- `repository.url` in the manifests still points at upstream; repoint it in
  `build.mjs` if npm OIDC provenance is ever adopted.
