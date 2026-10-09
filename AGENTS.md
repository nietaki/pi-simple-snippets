# Project purpose

- Build `pi-simple-snippets` as a distributable Pi package.
- Keep the extension small and focused. Discuss broader features such as placeholders, recursive expansion, project-specific files, aliases, or snippet-management commands with the operator before implementing them.
- Do not silently change marker grammar, escaping, autocomplete ownership, focus behavior, or lifecycle semantics.

# Implementation

- Write implementation code in TypeScript under `src/`.
- Keep `src/index.ts` as the Pi extension entry point and prefer focused internal modules for configuration, expansion, autocomplete, and shortcut behavior.
- Prefer documented Pi APIs and extension integration points over assumptions about Pi internals, the user's filesystem, or the terminal environment.
- Check the current Pi documentation and exported types when choosing or changing an API.
- Pi-internal behavior may be relied on only when no documented API provides the required behavior. Isolate each such dependency, explain why it is needed, record the verified Pi version, and protect it with a compatibility test or maintainer check.
- Keep runtime dependencies minimal. Pi host packages belong in `peerDependencies` with the wildcard ranges prescribed by Pi; do not put host-provided packages in `dependencies` or bundle them.
- Pi loads the TypeScript source directly. Do not add a build step or generated JavaScript unless a concrete distribution requirement justifies it.

# Public behavior and compatibility

- Configuration lives under the `piSimpleSnippets` settings key, camelCase like Pi's own settings keys. Preserve compatibility with existing user settings unless a migration is explicitly agreed.
- Expansion is a single left-to-right pass. Inserted snippet values are not recursively expanded.
- Unknown markers stay unchanged. Escaping, name parsing, trailing punctuation, wrappers, whitespace, line boundaries, and CJK punctuation are part of the observable contract.
- Autocomplete must wrap and delegate to the provider it receives. Requests and completion items not owned by this extension must continue to work.
- The optional shortcut must act only while Pi's main editor owns focus. It must not inject `%` into selectors, dialogs, overlays, or other focused components.
- TUI integrations must be registered for every session-start generation and cleaned up idempotently on shutdown. Do not replace this with register-once-per-runtime behavior without proving that Pi's UI reset lifecycle has changed.
- Keep input expansion functional in non-TUI modes. Guard terminal-only behavior with `ctx.mode === "tui"`.
- Do not promise that this npm package's input handler runs before or after another npm package unless that ordering has been verified and deliberately made part of the contract.
- When upgrading the Pi development versions, re-run the full suite and the compatibility checks for mirrored autocomplete boundaries, TUI focus access, widget capture, terminal-input redispatch, and session UI resets.

# Testing and validation

- Establish characterization tests before refactoring existing behavior.
- Write tests in TypeScript under `test/*.test.ts` using Vitest.
- Test observable contracts rather than incidental implementation structure.
- Use real `@earendil-works/pi-tui` helpers where practical. Keep fakes narrow and document casts used to stand in for Pi's larger interfaces.
- Cover at least:
  - settings validation, partial acceptance, warnings, and shortcut normalization;
  - marker boundaries, names, escaping, punctuation, unknown markers, multiple markers, multiline input, and nonrecursive expansion;
  - autocomplete extraction, fuzzy filtering, previews, caps, delegation, completion application, and forced-completion forwarding;
  - shortcut matching, overlays, selectors, editor focus detection, missing focus access, and unrelated input;
  - TUI versus non-TUI modes, repeated session generations, duplicate starts, cleanup, configuration reloads, and image preservation;
  - compatibility assumptions mirrored from or inferred from Pi internals.
- Use the project scripts:
  - `npm test` — run the Vitest suite;
  - `npm run coverage` — run the suite with v8 coverage over every `src` module;
  - `npm run typecheck` — run TypeScript without emitting files;
  - `npm run check` — run the complete local gate.
- Keep `npm run check` passing.
- Before publishing or declaring packaging work complete, run `npm pack --dry-run` and inspect the file list.
- Interactive terminal behavior that cannot be represented faithfully in Vitest must have a documented smoke-test procedure. Report that procedure in your response to the operator instead of writing it to any tracked file. Do not treat an automated fake as proof that a terminal, multiplexer, or keyboard protocol delivers a shortcut correctly.

# Dependencies and npm

- Local dependency operations are allowed, including:
  - `npm install`;
  - `npm ci`;
  - `npm outdated`;
  - adding or removing dependency entries;
  - changes to `package-lock.json` and `node_modules`.
- Do not perform operations that modify the published npm package, including:
  - `npm publish`;
  - `npm unpublish`;
  - `npm deprecate`;
  - `npm dist-tag`;
  - `npm owner`;
  - `npm star`.
- Publishing and other npm-registry mutations are the operator's responsibility.
- Do not add npm tokens or other publishing credentials to GitHub Actions. CI verifies the package but does not publish it.

# Experiments

- Put one-off probes and experiment scripts under the gitignored `scratch/` directory.
- Do not commit experiment scripts.
- Do not make public documentation depend on scratch files.
- Record durable conclusions from an experiment in tests or implementation comments next to the code they explain.

# Documentation

Maintain documentation according to its audience and level of abstraction. Prefer links to the authoritative document over duplicating detailed explanations.

Implementation and tests define actual behavior. `docs/behavior.md` is the canonical public behavior contract. Keep terminology, defaults, examples, warning semantics, and limitations consistent across these sources.

## `README.md`

Write the README for people evaluating, installing, configuring, or trying the package.

Keep it at the product and workflow level:

- explain the package's purpose, capabilities, maturity, and scope;
- provide npm/Pi installation, compatibility, and a short path to first use;
- show a concise settings example;
- summarize marker expansion, autocomplete, shortcut behavior, and major limitations;
- provide development and release commands;
- link to the detailed behavior contract.

Keep contributor and maintenance procedures out of the README.

## `docs/behavior.md`

Treat `docs/behavior.md` as the authoritative user-facing contract. Document observable behavior precisely enough that users and contributors do not need to inspect the implementation.

Cover configuration, validation and warnings, marker grammar, boundaries, escaping, expansion order, autocomplete behavior, shortcut behavior, supported modes, interactions with other Pi input processing, and known limitations. Keep Pi-internal investigation and historical rationale out of this document.

## Implementation documentation

Do not create a separate maintainer-reference document. Keep implementation-sensitive knowledge next to the implementation it explains:

- use focused comments for lifecycle constraints, mirrored pi-tui behavior, provider chaining, TUI capture, focus detection, and terminal-input redispatch;
- use tests to make compatibility assumptions and regression cases executable;
- keep comments concise and explain why a non-obvious constraint exists rather than narrating the code;

## Documentation changes

Update only the documentation layers affected by a change:

1. update `docs/behavior.md` when observable behavior changes;
2. update `README.md` when adoption, installation, compatibility, configuration, major capabilities, or the initial user experience changes;
3. update code comments and compatibility tests when an implementation dependency, verification procedure, or upgrade risk changes.

Verify examples against current behavior. Prefer links over maintaining equivalent explanations in multiple files.

## Changelog

- Add each notable user-facing change to the `[Unreleased]` section of `CHANGELOG.md` in the same change that implements it.
- Use the Keep a Changelog categories (`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, and `Security`) and describe outcomes for users rather than commit-level implementation details.
- During development, do not replace `[Unreleased]` with a version or date and do not update release comparison links manually. The configured release-it plugin performs that mechanical finalization after the release version is selected.
- Keep internal-only maintenance out of the changelog unless it materially affects package users, contributors, compatibility, or the release process.

# CI and releases

- Keep GitHub Actions read-only and minimal: install from the lockfile, run `npm run check`, and verify package contents with `npm pack --dry-run`.
- Releases are run locally with `release-it` from a clean `master` branch that tracks its upstream.
- The release workflow may update versions, create and push the release commit and annotated tag, and publish to npm only when the operator explicitly runs it.
- Do not add automatic npm publishing, a generated changelog, or GitHub Releases without operator agreement.
