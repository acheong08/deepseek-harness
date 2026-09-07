import { describe, expect, it } from 'vitest'
import {
  ALIASED_FORK_SUFFIXES, applyReplacements, FORK_PACKAGES, PACKAGE_IDENTITY_FILES, PUBLISH_ORDER, SRC_REPLACE,
} from './build.mjs'

describe('fork build package identities', () => {
  it('closes the package set over both changed leaves', () => {
    expect(FORK_PACKAGES.map(pkg => pkg.suffix)).toEqual([
      'dsh-attachment',
      'dsh-llm',
      'dsh-host-webserver',
      'dsh-client-connection',
      'dsh-client-file-upload',
      'dsh-http-proxy',
      'dsh-llm-pi-ai',
      'dsh-base',
      'dsh-app-boot',
      'dsh-web-app',
      'dsh',
    ])
    expect(PUBLISH_ORDER).toEqual([
      'dsh-attachment',
      'dsh-llm',
      'dsh-host-webserver',
      'dsh-client-connection',
      'dsh-client-file-upload',
      'dsh-http-proxy',
      'dsh-llm-pi-ai',
      'dsh-base',
      'dsh-app-boot',
      'dsh-web-app',
      'dsh',
    ])
  })

  it('keeps replacement service imports on their upstream module identities', () => {
    expect([...ALIASED_FORK_SUFFIXES]).toEqual(['dsh-attachment', 'dsh-llm'])
    expect(SRC_REPLACE['packages/llm/llm-pi-ai']).not.toContainEqual([
      '@deepseek-ai/dsh-llm',
      'dsh-llm',
    ])
  })

  it('replaces upstream packages that do not exist on the current npm alpha channel', () => {
    expect(applyReplacements(
      "name: '@deepseek-ai/dsh-client-file-upload'",
      '@preambient',
      SRC_REPLACE['packages/bundle/web-app'],
    )).toBe("name: '@preambient/dsh-client-file-upload'")
    expect(applyReplacements(
      "import '@deepseek-ai/dsh-http-proxy'",
      '@preambient',
      SRC_REPLACE['apps/cli'],
    )).toBe("import '@preambient/dsh-http-proxy'")
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
