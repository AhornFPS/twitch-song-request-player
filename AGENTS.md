# AGENTS.md

## Required Changelog Updates

- Update `CHANGELOG.md` for every user-visible change you implement.
- Add new entries under `## Unreleased` while changes are in progress between releases.
- Never write new changelog entries into any existing released version section.
- Always add in-progress changes to `## Unreleased`, even if a new release is created or the changelog is updated while you are still working in the same conversation.
- Do not append in-between-release changes to the most recent version section; only the release automation should move `## Unreleased` entries into a version section.
- Test builds must not rewrite or roll the changelog; only the GitHub release flow may rewrite `CHANGELOG.md` into a new version section.
- Keep changelog entries short, factual, and user-focused.
- Use `package.json` as the single source of truth for the current app version.
