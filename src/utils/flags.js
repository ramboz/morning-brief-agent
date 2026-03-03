export const isDryRun = process.argv.includes('--dry-run')
export const isMock = process.argv.includes('--mock')
export const isSaveFixture = process.argv.includes('--save-fixture')
export const isDebug = process.argv.includes('--debug')

/**
 * Parses --model <name> from argv. Passed through to `claude -p --model <name>`.
 * Supports --model haiku (space-separated) and --model=haiku (equals-separated).
 * @returns {string|null}
 */
function parseModelFlag() {
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i]
    if (arg === '--model' && process.argv[i + 1]) return process.argv[i + 1]
    if (arg.startsWith('--model=')) return arg.split('=')[1]
  }
  return null
}

export const aiModel = parseModelFlag()

/**
 * Parses --days N from argv. Returns lookback in hours, or null if not set.
 * Supports --days 3 (space-separated) and --days=3 (equals-separated).
 */
function parseDaysFlag() {
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i]
    if (arg === '--days' && process.argv[i + 1]) {
      const n = parseFloat(process.argv[i + 1])
      if (!isNaN(n) && n > 0) return n * 24
    }
    if (arg.startsWith('--days=')) {
      const n = parseFloat(arg.split('=')[1])
      if (!isNaN(n) && n > 0) return n * 24
    }
  }
  return null
}

/** Lookback window in hours. --days flag > LOOKBACK_HOURS env > 24h default. */
export const lookbackHours = parseDaysFlag() ?? parseInt(process.env.LOOKBACK_HOURS ?? '24')

/**
 * Logs a debug message. No-op unless --debug flag is set.
 * @param {string} label - Module or context label (e.g. '[ai]', '[index]')
 * @param {...any} args
 */
export function debug(label, ...args) {
  if (isDebug) console.log(`${label}:debug`, ...args)
}
