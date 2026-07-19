/**
 * Conventional Commits, enforced by the Husky `commit-msg` hook.
 * Allowed types mirror CONTRIBUTING.md.
 */
const config = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'refactor',
        'test',
        'docs',
        'chore',
        'perf',
        'build',
        'ci',
        'revert',
      ],
    ],
    'subject-case': [0],
    'body-max-line-length': [0],
  },
}

export default config
