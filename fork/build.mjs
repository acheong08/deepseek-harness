#!/usr/bin/env node
/**
 * Build the publishable fork tarballs.
 *
 * The fork relaxes the `dsh web` bind host and lets its reverse-proxied browser
 * use Host-only APIs (see fork/README.md). Publishing those changes
 * without mirroring the whole ~200-package monorepo means republishing just
 * seven packages under a new scope, with every other dependency pinned to the
 * published upstream `@deepseek-ai/*` versions.
 *
 * This script reproduces that from a committed ref: it stages a detached
 * worktree (the working tree is never modified), renames the seven fork
 * packages and every workspace reference to them, rebuilds, rewrites their
 * manifests for publication, and packs tarballs into `fork/artifacts/`.
 *
 * Usage:
 *   node fork/build.mjs [--scope @preambient] [--version 0.1.0-rc.7]
 *                       [--ref HEAD] [--out fork/artifacts] [--keep]
 */

import { cpSync, existsSync, globSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync, execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  parsePublishedVersions,
  publicationDependencyRange,
  resolveForkVersion,
  resolveUpstreamDependencyVersion,
} from './versioning.mjs'

const DEFAULTS = {
  scope: '@preambient',
  ref: 'HEAD',
  out: 'fork/artifacts',
}

// The seven packages this fork republishes. `suffix` is the unscoped npm name.
export const FORK_PACKAGES = [
  { dir: 'packages/host/webserver', suffix: 'dsh-host-webserver' },
  { dir: 'packages/client/connection', suffix: 'dsh-client-connection' },
  { dir: 'packages/llm/llm-pi-ai', suffix: 'dsh-llm-pi-ai' },
  { dir: 'packages/bundle/base', suffix: 'dsh-base' },
  { dir: 'packages/boot/app-boot', suffix: 'dsh-app-boot' },
  { dir: 'packages/bundle/web-app', suffix: 'dsh-web-app' },
  { dir: 'apps/cli', suffix: 'dsh' },
]

// Old -> suffix source replacements, applied to each package's src/ tree and
// its cordis.patch.yml. Full-name strings only; never a prefix, so a name like
// `@deepseek-ai/dsh-cmdline` (not forked) is never touched.
export const SRC_REPLACE = {
  'packages/host/webserver': [['@deepseek-ai/dsh-host-webserver', 'dsh-host-webserver']],
  'packages/client/connection': [
    ['@deepseek-ai/dsh-client-connection', 'dsh-client-connection'],
    ['@deepseek-ai/dsh-host-webserver', 'dsh-host-webserver'],
  ],
  'packages/llm/llm-pi-ai': [
    ['@deepseek-ai/dsh-llm-pi-ai', 'dsh-llm-pi-ai'],
  ],
  'packages/bundle/base': [
    ['@deepseek-ai/dsh-base', 'dsh-base'],
    ['@deepseek-ai/dsh-llm-pi-ai', 'dsh-llm-pi-ai'],
  ],
  'packages/boot/app-boot': [
    ['@deepseek-ai/dsh-app-boot', 'dsh-app-boot'],
    ['@deepseek-ai/dsh-base', 'dsh-base'],
    ['@deepseek-ai/dsh-web-app', 'dsh-web-app'],
  ],
  'packages/bundle/web-app': [
    ['@deepseek-ai/dsh-web-app', 'dsh-web-app'],
    ['@deepseek-ai/dsh-client-connection', 'dsh-client-connection'],
    ['@deepseek-ai/dsh-host-webserver', 'dsh-host-webserver'],
    ['@deepseek-ai/dsh-app-boot', 'dsh-app-boot'],
  ],
  'apps/cli': [['@deepseek-ai/dsh-app-boot', 'dsh-app-boot']],
}

// Names that are a prefix of other package names and therefore need an
// exact-name match (the CLI's own `@deepseek-ai/dsh` must not match `dsh-*`).
const SRC_REPLACE_EXACT = {
  'apps/cli': [['@deepseek-ai/dsh', 'dsh']],
}

// Vendored upstream packages the seven fork packages depend on, at the ranges
// upstream published. Update here if a future release republishes vendor.
const VENDORED = {
  '@deepseek-ai/cordis': '^4.0.1',
  '@deepseek-ai/cosmokit': '^1.8.2',
  '@deepseek-ai/schemastery': '^3.18.1',
  '@deepseek-ai/cordis-plugin-hmr': '^1.0.16',
  '@deepseek-ai/cordis-plugin-timer': '^1.1.3',
  '@deepseek-ai/cordis-plugin-loader': '^1.0.2',
  '@deepseek-ai/cordis-plugin-include': '^1.0.6',
  '@deepseek-ai/cordis-plugin-group': '^1.0.1',
  '@deepseek-ai/cordis-plugin-logger-console': '^1.0.1',
}

const DEP_SECTIONS = ['dependencies', 'peerDependencies', 'optionalDependencies']

// The workspace rename must also fix devDependencies, because `apps/cli`
// declares the fork webserver there; pnpm fails to resolve it otherwise.
const RENAME_SECTIONS = [...DEP_SECTIONS, 'devDependencies']
const MANIFEST_GLOBS = [
  'package.json',
  'packages/*/*/package.json',
  'apps/*/package.json',
  'vendor/*/package.json',
  'native/landlock-run/package.json',
  'native/landlock-run/packages/*/package.json',
  'examples/package.json',
  'website/package.json',
  'python/sdk-runtime/package.json',
]

const TEST_SOURCE_GLOBS = [
  'packages/*/*/tests/**/*',
]

/** Package-local build and composition files that can stamp package identities. */
export const PACKAGE_IDENTITY_FILES = ['cordis.patch.yml', 'tsdown.config.ts']

/** Dependency-first order for publishing every fork tarball. */
export const PUBLISH_ORDER = [
  'dsh-host-webserver',
  'dsh-client-connection',
  'dsh-llm-pi-ai',
  'dsh-base',
  'dsh-app-boot',
  'dsh-web-app',
  'dsh',
]

/** Run a command in `cwd`, printing its output and failing on non-zero exit. */
function run(cmd, args, cwd) {
  execSync([cmd, ...args].map(quote).join(' '), { cwd, stdio: 'inherit' })
}

function quote(value) {
  return /^[\w./:@=+^-]+$/.test(value) ? value : JSON.stringify(value)
}

/** Apply a list of [from, to] replacements to a file's text. */
export function applyReplacements(text, scope, replacements) {
  let out = text
  for (const [from, suffix] of replacements) {
    out = out.split(from).join(`${scope}/${suffix}`)
  }
  return out
}

/** Apply exact-name (non-prefix) replacements, one per [literal, suffix]. */
function applyExactReplacements(text, scope, replacements) {
  let out = text
  for (const [from, suffix] of replacements) {
    const pattern = new RegExp(`${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![-a-z0-9])`, 'g')
    out = out.replace(pattern, `${scope}/${suffix}`)
  }
  return out
}

/**
 * Read every published version of one fork package, treating an absent package as empty.
 * @param {string} name - Full scoped package name.
 * @returns {string[]} Published versions in registry order.
 */
function readRegistryVersions(name) {
  try {
    const output = execFileSync('npm', ['view', name, 'versions', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return parsePublishedVersions(output)
  } catch (error) {
    const stderr = error !== null && typeof error === 'object' && 'stderr' in error
      ? String(error.stderr)
      : ''
    if (stderr.includes('E404') || stderr.includes('404 Not Found')) return []
    throw new Error(`npm registry lookup failed for ${name}`)
  }
}

/** Read one package's version for an npm dist-tag. */
function readRegistryTagVersions(name, tag) {
  try {
    const output = execFileSync('npm', ['view', name, `dist-tags.${tag}`, '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return parsePublishedVersions(output)
  } catch {
    throw new Error(`npm registry tag lookup failed for ${name}@${tag}`)
  }
}

function main() {
  const { values } = parseArgs({
    options: {
      scope: { type: 'string', default: DEFAULTS.scope },
      version: { type: 'string' },
      ref: { type: 'string', default: DEFAULTS.ref },
      out: { type: 'string', default: DEFAULTS.out },
      keep: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  })
  const scope = values.scope

  const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()
  const oldNew = new Map(FORK_PACKAGES.map(p => [`@deepseek-ai/${p.suffix}`, `${scope}/${p.suffix}`]))
  const forkNames = new Set([...oldNew.values()])
  const packageNames = FORK_PACKAGES.map(pkg => `${scope}/${pkg.suffix}`)

  // Stage a detached worktree so the working tree is never modified.
  const worktree = join(tmpdir(), `dsh-fork-${Date.now()}`)
  run('git', ['worktree', 'add', '--detach', worktree, values.ref], repoRoot)

  try {
    const upstreamManifest = JSON.parse(readFileSync(join(worktree, 'apps/cli/package.json'), 'utf8'))
    const upstreamVersion = upstreamManifest.version
    const upstreamDependencyVersion = resolveUpstreamDependencyVersion(
      upstreamVersion,
      tag => readRegistryTagVersions('@deepseek-ai/dsh', tag),
    )
    const version = resolveForkVersion({
      explicitVersion: values.version,
      upstreamVersion,
      packageNames,
      readPublishedVersions: readRegistryVersions,
    })
    console.log(`fork build: upstream source ${upstreamVersion}; upstream npm dependencies ${upstreamDependencyVersion}; publishing ${version}`)

    // 1. Rename the seven packages' `name` fields and every workspace reference
    //    to them (dependency keys), across all workspace manifests.
    let manifests = 0
    for (const glob of MANIFEST_GLOBS) {
      for (const rel of globSync(glob, { cwd: worktree })) {
        const path = join(worktree, rel)
        const manifest = JSON.parse(readFileSync(path, 'utf8'))
        let changed = false
        if (oldNew.has(manifest.name)) { manifest.name = oldNew.get(manifest.name); changed = true }
        for (const section of RENAME_SECTIONS) {
          const deps = manifest[section]
          if (!deps || typeof deps !== 'object' || Array.isArray(deps)) continue
          for (const key of Object.keys(deps)) {
            if (oldNew.has(key)) { deps[oldNew.get(key)] = deps[key]; delete deps[key]; changed = true }
          }
        }
        if (changed) { writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`); manifests += 1 }
      }
    }
    console.log(`fork build: renamed ${manifests} manifests`)

    // 2. Rewrite source self-references, client bundle ids, and bundle patch mounts.
    for (const pkg of FORK_PACKAGES) {
      let files = 0
      const base = join(worktree, pkg.dir)
      for (const rel of globSync(`${pkg.dir}/src/**/*`, { cwd: worktree })) {
        const path = join(worktree, rel)
        if (!statSync(path).isFile()) continue
        const text = readFileSync(path, 'utf8')
        let out = applyReplacements(text, scope, SRC_REPLACE[pkg.dir] ?? [])
        out = applyExactReplacements(out, scope, SRC_REPLACE_EXACT[pkg.dir] ?? [])
        if (out !== text) { writeFileSync(path, out); files += 1 }
      }
      for (const extra of PACKAGE_IDENTITY_FILES) {
        const path = join(base, extra)
        if (!existsSync(path)) continue
        const text = readFileSync(path, 'utf8')
        const out = applyReplacements(text, scope, SRC_REPLACE[pkg.dir] ?? [])
        if (out !== text) { writeFileSync(path, out); files += 1 }
      }
      console.log(`fork build: rewrote ${files} file(s) under ${pkg.dir}`)
    }

    // Workspace tests can import package-private source subpaths that tsconfig
    // paths do not cover. Keep those imports aligned with the temporary
    // manifest renames so the repository build can typecheck them.
    const workspaceReplacements = FORK_PACKAGES.map(pkg => [
      `@deepseek-ai/${pkg.suffix}`,
      pkg.suffix,
    ])
    let testFiles = 0
    for (const glob of TEST_SOURCE_GLOBS) {
      for (const rel of globSync(glob, { cwd: worktree })) {
        const path = join(worktree, rel)
        if (!statSync(path).isFile()) continue
        const text = readFileSync(path, 'utf8')
        const out = applyExactReplacements(text, scope, workspaceReplacements)
        if (out !== text) { writeFileSync(path, out); testFiles += 1 }
      }
    }
    console.log(`fork build: rewrote ${testFiles} workspace test file(s)`)

    // 3. Install and build the library output.
    run('pnpm', ['install'], worktree)
    run('pnpm', ['run', 'build:lib'], worktree)

    // 4. Pack the seven packages with publication manifests.
    const outDir = resolve(repoRoot, values.out)
    rmSync(outDir, { recursive: true, force: true })
    mkdirSync(outDir, { recursive: true })
    const tarballs = []
    for (const pkg of FORK_PACKAGES) {
      const stage = join(outDir, pkg.suffix)
      cpSync(join(worktree, pkg.dir), stage, {
        recursive: true,
        filter: src => !src.includes('/node_modules/') && !src.includes('/tests/'),
      })
      const manifestPath = join(stage, 'package.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      manifest.version = version
      delete manifest.private
      delete manifest.devDependencies
      for (const section of DEP_SECTIONS) {
        const deps = manifest[section]
        if (!deps || typeof deps !== 'object') continue
        for (const key of Object.keys(deps)) {
          deps[key] = VENDORED[key]
            ?? publicationDependencyRange(key, deps[key], forkNames, version, upstreamDependencyVersion)
        }
      }
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
      const name = execSync('npm pack --silent', { cwd: stage, encoding: 'utf8' }).trim()
      tarballs.push(`${scope}/${pkg.suffix}`)
      console.log(`fork build: packed ${name}`)
    }

    console.log(`\nfork build: ${tarballs.length} tarball(s) in ${outDir}`)
    console.log('publish (deps before dependents; prerelease needs --tag):')
    for (const suffix of PUBLISH_ORDER) {
      const file = `${scope.replace('@', '').replace('/', '-')}-${suffix}-${version}.tgz`
      console.log(`  npm publish ./${suffix}/${file} --tag next`)
    }
  } finally {
    if (!values.keep) {
      run('git', ['worktree', 'remove', '--force', worktree], repoRoot)
      rmSync(worktree, { recursive: true, force: true })
    } else {
      console.log(`fork build: kept worktree at ${worktree}`)
    }
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(`fork build: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
