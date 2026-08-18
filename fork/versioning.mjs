const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function validateVersion(version, label) {
  if (!VERSION_PATTERN.test(version)) throw new Error(`invalid ${label} ${JSON.stringify(version)}`)
}

/**
 * Select the first fork version unused by every package in the publish set.
 * @param {string} upstreamVersion - Version read from the checked-out CLI manifest.
 * @param {Iterable<string>} publishedVersions - Union of versions published by the fork packages.
 * @returns {string} The version to write into fork package manifests.
 */
export function nextAvailableForkVersion(upstreamVersion, publishedVersions) {
  validateVersion(upstreamVersion, 'upstream version')
  const published = new Set(publishedVersions)
  if (!published.has(upstreamVersion)) return upstreamVersion

  const [core, ...prereleaseParts] = upstreamVersion.split('-')
  const identifiers = prereleaseParts.join('-').split('.')
  const finalIdentifier = identifiers.at(-1)
  if (finalIdentifier === undefined || !/^\d+$/.test(finalIdentifier)) {
    throw new Error(`cannot auto-increment occupied version ${upstreamVersion}; pass --version explicitly`)
  }

  const prefix = identifiers.slice(0, -1)
  let next = Number(finalIdentifier) + 1
  while (true) {
    const prerelease = [...prefix, String(next)].join('.')
    const candidate = `${core}-${prerelease}`
    if (!published.has(candidate)) return candidate
    next += 1
  }
}

/**
 * Resolve an explicit or registry-derived fork version.
 * @param {object} input - Version inputs and registry reader.
 * @param {string | undefined} input.explicitVersion - Command-line override, when supplied.
 * @param {string} input.upstreamVersion - Version read from the checked-out CLI manifest.
 * @param {readonly string[]} input.packageNames - Full fork package names.
 * @param {(name: string) => string[]} input.readPublishedVersions - Registry lookup for one package.
 * @returns {string} The version shared by the fork publish set.
 */
export function resolveForkVersion({ explicitVersion, upstreamVersion, packageNames, readPublishedVersions }) {
  if (explicitVersion !== undefined) {
    validateVersion(explicitVersion, '--version')
    return explicitVersion
  }
  const published = packageNames.flatMap(name => readPublishedVersions(name))
  return nextAvailableForkVersion(upstreamVersion, published)
}

/**
 * Rewrite a publication dependency without coupling upstream and fork versions.
 * @param {string} name - Dependency package name.
 * @param {string} currentRange - Source manifest range.
 * @param {ReadonlySet<string>} forkNames - Renamed packages in this publish set.
 * @param {string} forkVersion - Version assigned to republished packages.
 * @param {string} upstreamVersion - Version of untouched upstream packages.
 * @returns {string} Publication-ready dependency range.
 */
export function publicationDependencyRange(name, currentRange, forkNames, forkVersion, upstreamVersion) {
  if (forkNames.has(name)) return `^${forkVersion}`
  if (name.startsWith('@deepseek-ai/dsh-')) return `^${upstreamVersion}`
  return currentRange
}

/**
 * Parse the JSON emitted by `npm view <package> versions --json`.
 * @param {string} output - Captured npm stdout.
 * @returns {string[]} Published versions in registry order.
 */
export function parsePublishedVersions(output) {
  if (output.trim() === '') return []
  let parsed
  try {
    parsed = JSON.parse(output)
  } catch {
    throw new Error('invalid npm registry response: expected version JSON')
  }
  if (typeof parsed === 'string') return [parsed]
  if (Array.isArray(parsed) && parsed.every(version => typeof version === 'string')) return parsed
  throw new Error('invalid npm registry response: expected a version string or array')
}
