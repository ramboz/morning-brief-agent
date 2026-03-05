import fs from 'fs/promises'

let _cached = null

/**
 * Loads the user context file (config/context.md) for AI prompt injection.
 * Returns an empty string if the file does not exist — graceful degradation,
 * all prompts work normally without it.
 * Result is cached for the lifetime of the process (one load per run).
 * @returns {Promise<string>}
 */
export async function loadContext() {
  if (_cached !== null) return _cached
  try {
    _cached = await fs.readFile('config/context.md', 'utf-8')
    console.log('[context] Loaded user context from config/context.md')
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[context] Failed to load config/context.md:', err.message)
    }
    _cached = ''
  }
  return _cached
}

/**
 * Prepends user context to a prompt string.
 * If no context file exists, returns the prompt unchanged.
 * @param {string} prompt - The base prompt
 * @returns {Promise<string>}
 */
export async function withContext(prompt) {
  const context = await loadContext()
  if (!context.trim()) return prompt
  return `## About the engineer you are briefing\n\n${context.trim()}\n\n---\n\n${prompt}`
}
