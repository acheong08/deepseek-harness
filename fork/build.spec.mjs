import { describe, expect, it } from 'vitest'
import {
  applyReplacements, FORK_PACKAGES, FORK_PATCHES, PACKAGE_IDENTITY_FILES, PINNED_UPSTREAM_ROOTS, PUBLISH_ORDER, SRC_REPLACE,
} from './build.mjs'

describe('fork build package identities', () => {
  it('closes the package set over both changed leaves', () => {
    expect(FORK_PACKAGES.map(pkg => pkg.suffix)).toEqual([
      'dsh-host-webserver',
      'dsh-client-connection',
      'dsh-llm-pi-ai',
      'dsh-base',
      'dsh-app-boot',
      'dsh-web-app',
      'dsh',
    ])
    expect(PUBLISH_ORDER).toEqual([
      'dsh-host-webserver',
      'dsh-client-connection',
      'dsh-llm-pi-ai',
      'dsh-base',
      'dsh-app-boot',
      'dsh-web-app',
      'dsh',
    ])
  })

  it('applies only the private changes over the published source baseline', () => {
    expect(FORK_PATCHES).toEqual([
      'fork/patches/0001-feat-allow-internal-web-bind-hosts.patch',
      'fork/patches/always-loopback.patch',
      'fork/patches/0001-feat-llm-pi-ai-add-sessionHeader-config-for-per-sess.patch',
    ])
  })

  it('pins shared upstream Service Definitions at the installation root', () => {
    expect(PINNED_UPSTREAM_ROOTS).toEqual([
      '@deepseek-ai/dsh-attachment',
      '@deepseek-ai/dsh-llm',
    ])
  })

  it('mounts the forked pi-ai provider from the forked base bundle', () => {
    expect(applyReplacements(
      "name: '@deepseek-ai/dsh-llm-pi-ai'",
      '@preambient',
      SRC_REPLACE['packages/bundle/base'],
    )).toBe("name: '@preambient/dsh-llm-pi-ai'")
    expect(applyReplacements(
      "bundles: ['@deepseek-ai/dsh-base']",
      '@preambient',
      SRC_REPLACE['packages/boot/app-boot'],
    )).toBe("bundles: ['@preambient/dsh-base']")
  })

  it('mounts both changed fork packages from the Web bundle', () => {
    const source = [
      "name: '@deepseek-ai/dsh-host-webserver'",
      "name: '@deepseek-ai/dsh-client-connection'",
    ].join('\n')
    expect(applyReplacements(source, '@preambient', SRC_REPLACE['packages/bundle/web-app'])).toBe([
      "name: '@preambient/dsh-host-webserver'",
      "name: '@preambient/dsh-client-connection'",
    ].join('\n'))
  })

  it('rewrites the connection host import and generated client id', () => {
    const replacements = SRC_REPLACE['packages/client/connection']
    expect(applyReplacements(
      "import type {} from '@deepseek-ai/dsh-host-webserver'",
      '@preambient',
      replacements,
    )).toBe("import type {} from '@preambient/dsh-host-webserver'")
    expect(applyReplacements(
      "clientBundle('@deepseek-ai/dsh-client-connection', [])",
      '@preambient',
      replacements,
    )).toBe("clientBundle('@preambient/dsh-client-connection', [])")
    expect(PACKAGE_IDENTITY_FILES).toContain('tsdown.config.ts')
  })
})
