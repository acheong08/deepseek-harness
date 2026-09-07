import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  nextAvailableForkVersion,
  parsePublishedVersions,
  publicationDependencyRange,
  resolveUpstreamDependencyVersion,
  resolveForkVersion,
  upstreamDependencyDistTag,
} from './versioning.mjs'

test('uses the checked-out upstream version when every fork package is free', () => {
  assert.equal(nextAvailableForkVersion('0.1.0-rc.7', ['0.1.0-rc.6']), '0.1.0-rc.7')
})

test('advances past every prerelease version found in the registry union', () => {
  const published = ['0.1.0-rc.6', '0.1.0-rc.7', '0.1.0-rc.8']
  assert.equal(nextAvailableForkVersion('0.1.0-rc.7', published), '0.1.0-rc.9')
})

test('treats one package owning a candidate as a collision', () => {
  const versionsByPackage = [
    ['0.1.0-rc.6', '0.1.0-rc.7'],
    ['0.1.0-rc.6'],
    ['0.1.0-rc.6'],
    ['0.1.0-rc.6'],
  ]
  assert.equal(nextAvailableForkVersion('0.1.0-rc.7', versionsByPackage.flat()), '0.1.0-rc.8')
})

test('requires an explicit version when an occupied source version cannot be incremented', () => {
  assert.throws(
    () => nextAvailableForkVersion('0.1.0', ['0.1.0']),
    /pass --version explicitly/,
  )
  assert.throws(
    () => nextAvailableForkVersion('0.1.0-rc.beta', ['0.1.0-rc.beta']),
    /pass --version explicitly/,
  )
})

test('parses npm version JSON arrays, scalars, and empty output', () => {
  assert.deepEqual(parsePublishedVersions('["0.1.0-rc.6", "0.1.0-rc.7"]'), ['0.1.0-rc.6', '0.1.0-rc.7'])
  assert.deepEqual(parsePublishedVersions('"0.1.0-rc.6"'), ['0.1.0-rc.6'])
  assert.deepEqual(parsePublishedVersions(''), [])
})

test('rejects malformed npm version output', () => {
  assert.throws(() => parsePublishedVersions('{'), /invalid npm registry response/)
  assert.throws(() => parsePublishedVersions('{"version":"0.1.0"}'), /invalid npm registry response/)
  assert.throws(() => parsePublishedVersions('["0.1.0", 7]'), /invalid npm registry response/)
})

test('an explicit version bypasses registry reads', () => {
  const version = resolveForkVersion({
    explicitVersion: '0.1.0-custom.1',
    upstreamVersion: '0.1.0-rc.7',
    packageNames: ['@preambient/dsh'],
    readPublishedVersions: () => assert.fail('registry must not be read'),
  })
  assert.equal(version, '0.1.0-custom.1')
})

test('automatic selection unions versions from every fork package', () => {
  const published = new Map([
    ['@preambient/dsh-host-webserver', ['0.1.0-rc.6', '0.1.0-rc.7']],
    ['@preambient/dsh', ['0.1.0-rc.6', '0.1.0-rc.8']],
  ])
  const version = resolveForkVersion({
    upstreamVersion: '0.1.0-rc.7',
    packageNames: [...published.keys()],
    readPublishedVersions: name => published.get(name),
  })
  assert.equal(version, '0.1.0-rc.9')
})

test('dependency ranges distinguish fork packages from untouched upstream packages', () => {
  const forkNames = new Set(['@preambient/dsh-web-app'])
  assert.equal(
    publicationDependencyRange('@preambient/dsh-web-app', 'workspace:^', forkNames, '0.1.0-rc.8', '0.1.0-rc.7'),
    '^0.1.0-rc.8',
  )
  assert.equal(
    publicationDependencyRange('@deepseek-ai/dsh-base', 'workspace:^', forkNames, '0.1.0-rc.8', '0.1.0-rc.7'),
    '^0.1.0-rc.7',
  )
  assert.equal(
    publicationDependencyRange('chalk', '^5.0.0', forkNames, '0.1.0-rc.8', '0.1.0-rc.7'),
    '^5.0.0',
  )
})

test('upstream dependencies follow the published release channel instead of the source version', () => {
  assert.equal(upstreamDependencyDistTag('0.1.3-alpha.1'), 'alpha')
  assert.equal(upstreamDependencyDistTag('0.1.3-canary.1'), 'canary')
  assert.equal(upstreamDependencyDistTag('0.1.3-rc.1'), 'next')
  assert.equal(upstreamDependencyDistTag('0.1.3'), 'latest')
  assert.equal(
    resolveUpstreamDependencyVersion('0.1.3-alpha.1', tag => {
      assert.equal(tag, 'alpha')
      return ['0.1.2-alpha.5']
    }),
    '0.1.2-alpha.5',
  )
})
