export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', [
      'feat', 'fix', 'chore', 'docs', 'skill', 'refactor'
    ]],
    'scope-enum': [1, 'always', [
      'orchestrator', 'slack', 'outlook', 'jira', 'confluence',
      'github', 'ai-radar', 'scripts', 'config'
    ]]
  }
}
