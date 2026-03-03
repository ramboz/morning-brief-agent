export const isDryRun = process.argv.includes('--dry-run')
export const isMock = process.argv.includes('--mock')
export const isSaveFixture = process.argv.includes('--save-fixture')
export const isDebug = process.argv.includes('--debug')

/**
 * Logs a debug message. No-op unless --debug flag is set.
 * @param {string} label - Module or context label (e.g. '[ai]', '[index]')
 * @param {...any} args
 */
export function debug(label, ...args) {
  if (isDebug) console.log(`${label}:debug`, ...args)
}
