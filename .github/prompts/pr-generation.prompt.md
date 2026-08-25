# Vera Pull Request Generation Prompt

Use this workflow when asked to generate, create, or update a pull request for
this repository.

## Repository context

Vera is a TypeScript-first npm-workspaces monorepo. The implemented application
currently lives in `apps/api`. The architectural source of truth is:

- `README.md` for setup, operation, and manual testing;
- `docs/README.md` for documentation ownership and reading order;
- `docs/product-charter.md` for product boundaries;
- `docs/system-architecture.md` for component responsibilities;
- `docs/domain-model.md` for durable domain contracts;
- `docs/security-and-trust.md` for authority and disclosure boundaries;
- `docs/engineering-method.md` for the project development method;
- `docs/decisions/README.md` and the accepted ADRs for binding decisions;
- `docs/api.md` for implemented HTTP behavior;
- `docs/v1-definition.md` for current V1 scope.

Do not cite repository instruction or validation files that do not exist. If a
future instruction file is added, verify that it is present before relying on
it.

## Workflow

1. Inspect the complete worktree with `git status --short`, then inspect both
   unstaged and staged changes. Include untracked files in the review. Never
   assume that staged changes are the complete pull request.

2. Establish the comparison base from Git, normally `origin/main`, and read the
   complete resulting diff. Understand why every changed file belongs in the
   pull request. Preserve unrelated user-owned changes; stop if they cannot be
   separated safely.

3. Review the change against Vera's architecture before committing:
   - models may propose actions, but deterministic application code owns
     authority, validation, budgets, approvals, and side effects;
   - MongoDB is durable operational truth and Redis is a rebuildable,
     non-authoritative scratchpad;
   - task transitions must remain durable, idempotent, recoverable, and safe
     under retries, concurrency, cancellation, and partial failure;
   - project context must be explicit, bounded, hash-verifiable, isolated by
     project, and free of credential-like files;
   - capability contracts must remain provider-neutral; a provider-specific
     implementation belongs behind an adapter;
   - approvals must disclose and bind the exact authority-bearing invocation;
   - persisted schema changes require compatibility or an explicit migration;
   - external errors and logs must not expose secrets or provider internals;
   - HTTP request objects remain closed and loopback-only assumptions must not
     be weakened accidentally;
   - documentation and ADRs must agree with the implementation.

4. Run validation appropriate to the change. For application changes, the
   minimum is:

   ```sh
   npm run check
   npm run build
   git diff --check
   git diff --cached --check
   ```

   `npm run check` covers formatting, linting, TypeScript checking, and all
   workspace tests. Also perform focused manual verification for changed
   boundaries:
   - HTTP lifecycle changes: exercise the compiled API from project or task
     creation through the resulting terminal resource;
   - MongoDB/Redis changes: use an isolated database/key prefix, verify
     migration or recovery semantics, and remove temporary data afterward;
   - model or capability adapters: verify readiness, structured output,
     approval disclosure, cancellation, and failure classification as relevant;
   - documentation-only changes: verify links, Mermaid syntax, decision index,
     and consistency with accepted ADRs.

   Record the commands and actual results. Do not claim checks that were not
   run. Do not treat a GitHub review bot as a substitute for local validation.

5. Stage only the reviewed pull-request files. Re-read the final staged diff
   and run `git diff --cached --check` before committing.

6. Use these Git conventions:
   - branch: `codex/<brief-kebab-case-description>`, normally under 60
     characters;
   - commit and PR title: Conventional Commits format,
     `type(optional-scope): imperative subject`;
   - common types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`;
   - keep commits cohesive and never rewrite or amend user commits unless the
     user explicitly asks;
   - push and create or update a PR only when the user has requested it.

7. Generate a high-signal PR description using the template below. Derive it
   from the final staged or committed diff—not from memory or an earlier draft.
   Keep the description specific enough that a reviewer can understand domain,
   persistence, API, security, and operational consequences without reading
   every file first.

8. Push the current branch and create a ready-for-review pull request against
   `main`, unless the user requests a draft or a different base. After creation,
   read the resulting PR title and body back from GitHub and correct any quoting
   or formatting damage.

## Pull request description template

```markdown
## Summary

Explain the user-visible or architectural outcome and why Vera needs it.

## Changes

- Describe the durable domain and lifecycle changes.
- Describe API, adapter, persistence, configuration, and documentation changes
  that apply.
- Call out migrations and compatibility behavior explicitly.

## Architecture and safety

- Explain authority, approval, isolation, idempotency, recovery, concurrency,
  and data-boundary consequences that apply.
- State why the design remains generic and extendable rather than tied to one
  model provider, specialist, repository, or client.

## Testing

- `npm run check` — include the passing test count.
- `npm run build`.
- Focused integration and manual verification with actual outcomes.

## Manual testing

1. Provide reproducible setup commands or prerequisites.
2. Exercise the complete changed flow through the public HTTP API.
3. Inspect approval, events, persistence, and artifacts as relevant.
4. Include a negative or failure-path check when the change affects authority
   or external systems.

## Environment variables

List every added or changed variable and its purpose, default, and important
compatibility aliases. Write `None` when not applicable.

## Migration and compatibility

Describe persisted-data migration, API compatibility, configuration aliases,
and any operator action. Write `None` only when genuinely inapplicable.

## Related issues

List issue or ticket references when known; otherwise write `None`.
```

Omit screenshots unless the pull request contains a visual interface change.
Use plain repository paths in the GitHub description and wrap paths, commands,
symbols, environment variables, and endpoint names in backticks.
