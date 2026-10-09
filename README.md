# pi-simple-snippets

`pi-simple-snippets` is a [Pi](https://github.com/earendil-works/pi) package for repeating
yourself less. It expands configured `%snippet-name` markers when you submit a prompt,
completes snippet names in Pi's own editor popup, and can bind a shortcut that types the
`%` for you.

It is a thin layer over text you already write: no separate snippet files, no custom
popup, no model call. One line of JSON turns `%use-mcp` into the paragraph you keep
typing.

> **Status:** 0.x. The expansion, completion, and shortcut behavior are implemented,
> tested, and verified against Pi 1.1.0. Placeholder editing, per-project snippet files,
> and snippet management commands are not implemented — see [Planned work](#planned-work).

## What it does

- **Expands markers on submit.** `%use-mcp` in a prompt becomes the configured text
  before the model sees it. Works in interactive, RPC, print, and JSON sessions, and for
  steering and follow-up input.
- **Completes names in Pi's native popup.** Type `%` (or press the shortcut) and Pi's own
  editor autocomplete lists matching snippets with one-line previews, fuzzy filtering,
  `Tab` acceptance, and `Esc` dismissal. `@file` and slash-command completion are
  untouched.
- **Optionally binds a shortcut.** A configured key combo such as `ctrl+shift+s` types a
  literal `%` — but only while the editor owns focus, never into a `/model` or
  `/settings` picker.

## Install

```sh
pi install npm:pi-simple-snippets
```

Or try it for a single invocation without adding it to settings:

```sh
pi -e npm:pi-simple-snippets
```

`pi list` shows configured packages; `pi remove pi-simple-snippets` removes it.

**Verified against Pi 1.1.0** (`@earendil-works/pi-coding-agent` and
`@earendil-works/pi-tui`). Peer ranges stay `"*"` because that is the convention Pi
prescribes for host-provided packages — Pi does not resolve them for managed installs, so
the tested version is stated here rather than pinned in `package.json`. Treat a newer Pi
as unverified until [Verifying a Pi upgrade](#verifying-a-pi-upgrade) passes against it.

After installing, run `/reload` inside Pi so the package's handlers and settings load. If
you used to run this extension as a file under `~/.pi/agent/extensions/`, remove that
copy first: two active registrations would double the completion wrapper and the terminal
listener.

## Configure

Under the `pi-simple-snippets` key of your user `~/.pi/agent/settings.json`, or a trusted
project's `.pi/settings.json`:

```json
{
  "pi-simple-snippets": {
    "shortcut": "ctrl+shift+s",
    "snippets": {
      "use-mcp": "Use your MCP tools to find the information",
      "tdd": "Write the failing test first, watch it fail, then implement the minimum to pass."
    }
  }
}
```

Then `/reload`. Names must match `[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?` (lowercase,
starting and ending with a letter or digit; punctuation is allowed internally) and values
must be non-empty strings; a malformed entry is skipped with one summarized warning, the
rest still work. `shortcut` needs at least one modifier, so a bare printable key can never
swallow ordinary typing.

With no usable snippets, no completion provider is registered, preserving Pi's `%`
completion. A configured valid shortcut is independent and may still install its TUI
listener even when there are no snippets.

The full contract — boundary and name rules, escaping, completion ownership, focus
behavior, warnings, and known limitations — is in
[`docs/behavior.md`](docs/behavior.md).

## Quick tour

Type at a word boundary and submit:

```text
Please %use-mcp.
```

The model receives `Please Use your MCP tools to find the information.` — the period
survives, because a name has to end on a letter or digit.

Type `%` alone to list everything, `%mc` to fuzzy-narrow, `Tab` to accept. Unknown
markers are left untouched, so `git log --format=%h` is safe unless you configure a
snippet named `h`. Type `%%use-mcp` when you genuinely want the literal `%use-mcp`.

## Compatibility notes

Two behaviors are worth knowing before you rely on them, both documented in
[`docs/behavior.md`](docs/behavior.md):

- Pi expands prompt templates and skill commands **after** input handlers, so a snippet
  value beginning with `/name` or `skill:` can be read as an invocation.
- The shortcut is a raw terminal listener, not a registered Pi shortcut: it is invisible
  to `/hotkeys`, gets no conflict diagnostics, and depends on your terminal actually
  delivering that key sequence (Kitty keyboard protocol terminals do; some legacy
  terminals cannot tell `ctrl+shift+s` apart from `ctrl+s`).

The marker boundary rule is mirrored from pi-tui rather than imported, because pi-tui
does not re-export it. A compatibility canary, `test/pi-compatibility.test.ts` (source
repository, not in the npm tarball), pins the mirrored patterns and Pi's
registration-reset behavior against the installed package, so a Pi upgrade that breaks
the mirror fails loudly instead of silently killing completion.

## Development

```sh
npm ci
npm run check        # Vitest suite, then tsc --noEmit
npm run coverage     # v8 coverage over every src module
```

`npm run test` runs the suite alone; `npm run typecheck` runs `tsc --noEmit` alone. There
is no build step: Pi loads `src/index.ts` directly through its TypeScript loader, and the
published package ships source.

The suite is characterization-first — it pins the marker grammar, completion ownership,
focus guard, and session lifecycle the extension has already been verified to have, so a
refactor or a Pi upgrade shows up as a failing assertion rather than a dead shortcut.
Coverage reports every `src` module including ones no test imports.

CI is `.github/workflows/ci.yml`: on pull requests, pushes to `master`, and manual
dispatch it installs with `npm ci`, runs `npm run check`, and verifies the tarball
contents with `npm pack --dry-run`. It publishes nothing and needs no secrets. There are
no production dependencies — the Pi packages are peers — so `npm audit --omit=dev` is
clean; any advisory can only come from the development toolchain.

### Verifying in a real terminal

Some behavior cannot be reproduced faithfully against a fake TUI. Run this matrix in a
real interactive session after any change to the shortcut guard, widget placement, or
trigger handling, and after every Pi upgrade:

1. Submit `%use-mcp` — the model receives the expanded text; submit `%undefined` and it
   arrives literally.
2. Type a bare `%` — the native popup lists every snippet; `Esc` dismisses it without
   touching the text.
3. Press the configured shortcut — the popup opens as if `%` had been typed. Confirm the
   combo actually reaches Pi through your terminal (a Kitty keyboard protocol terminal
   distinguishes `ctrl+shift+s` from `ctrl+s`) and through any multiplexer or window
   manager keymap.
4. Focus a selector (`/model`, `/settings`, session or tree picker) and press the
   shortcut — the key must reach the picker untouched, not type `%`.
5. Check there is no blank row above or below the editor (the capture widget renders zero
   lines and must stay invisible).
6. `/new`, `/resume`, `/fork`, and `/reload` — completion and the shortcut must still work
   afterwards, each exactly once (no duplicated popup entries, no double `%`).
7. Edit `settings.json` and `/reload` — the new snippets take effect; a broken entry
   produces exactly one warning at session start.

### Verifying a Pi upgrade

The locked dev versions are what the suite ran against when it was written. After raising
them:

1. `npm run check` — the compatibility canary pins pi-tui's boundary patterns, the editor
   method fingerprint, and Pi's session-UI reset, so drift fails here first.
2. Re-confirm the mirror itself is still what Pi does, not merely self-consistent:
   `rg -n "autocompleteTokenStartSource|autocompleteBoundaryRegex|cjkPunctuationRegex"
   node_modules/@earendil-works/pi-tui/dist/utils.js node_modules/@earendil-works/pi-tui/dist/components/editor.js`
3. Run the terminal matrix above — the fake `TUI` cannot prove focus or key delivery.

Update `src/patterns.ts` and the pinned strings in `test/pi-compatibility.test.ts` in the
same commit, so the mirror and its guard never disagree.

### Releasing

Releases are run locally with [release-it](https://github.com/release-it/release-it).
Start from a clean `master` branch that tracks its upstream, and make sure npm is
authenticated for this package. Preview the flow without changing Git or npm state:

```sh
npm run release:dry-run
```

A dry run still performs read-only prerequisite checks such as npm authentication. For a
real release, either run the interactive version selector or name the SemVer increment
explicitly:

```sh
npm run release
npm run release -- patch
```

The release runs `npm run check`, updates `package.json` and `package-lock.json`, creates
and pushes a `chore: release vX.Y.Z` commit and `vX.Y.Z` tag, and publishes to npm.
`prepublishOnly` runs the checks again immediately before publication, so a direct
`npm publish` stays protected too. This workflow does not create a GitHub Release and
maintains no changelog — the tag history is the record.

## Planned work

Moved to GitHub issues as they are filed.

- A `/snippets` listing command.
- Per-project snippet files that merge over the user namespace.
- Per-snippet aliases or descriptions.
- Placeholder editing inside snippet values.
- Leaving markers inside fenced code blocks literal, if there is demand.

## Repository

- Source: <https://github.com/nietaki/pi-simple-snippets>
- Issues: <https://github.com/nietaki/pi-simple-snippets/issues>
- [`docs/behavior.md`](docs/behavior.md) — the observable behavior contract

## License

MIT — see [`LICENSE`](LICENSE).
