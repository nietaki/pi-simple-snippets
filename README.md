# pi-simple-snippets

`pi-simple-snippets` is a [Pi](https://github.com/earendil-works/pi) package for reusable
prompt snippets. It expands configured `%snippet-name` markers when you submit a prompt,
with built-in autocompletion shown after `%` is typed.

It's deliberately simple - there's no extra dotfiles to maintain, just another entry
in your `pi`'s `settings.json`.

## What it does

- **Expands markers on submit.** `%use-mcp` in a prompt becomes the configured text
  before the model sees it. Works in interactive, RPC, print, and JSON sessions, and for
  steering and follow-up input.
- **Completes names in Pi's native popup.** Type `%` (or press the shortcut) and Pi's own
  editor autocomplete lists matching snippets with one-line previews, fuzzy filtering,
  `Tab` acceptance, and `Esc` dismissal. `@file` and slash-command completion are
  untouched.
- **Optionally expands as you complete.** With `expandOnCompletion` turned on, accepting a
  snippet puts its full text in the editor instead of the marker, so you can read and edit
  it before submitting. Multiline snippets land across lines. Off by default, and
  submit-time expansion keeps working either way.
- **Optionally binds a shortcut.** A configured key combo such as `ctrl+shift+s` types a
  literal `%` — but only while the editor owns focus, never into a `/model` or
  `/settings` picker.

## Motivation

Prompt templates are cornerstones of many workflows, but offer limited configurability -
you keep the template's general structure and optionally inject some more information into it.

What I needed was a way to type my own multiline prompt while having the option to insert
some of the phrases I use to steer the agent without having to type them out every time.

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

Under the `piSimpleSnippets` key of your user `~/.pi/agent/settings.json`, or a trusted
project's `.pi/settings.json`:

```json
{
  "piSimpleSnippets": {
    "shortcut": "ctrl+shift+s",
    "expandOnCompletion": true,
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
swallow ordinary typing. `expandOnCompletion` is optional and defaults to `false`; a
non-boolean value is ignored with the same summarized warning.

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

With `expandOnCompletion` on, that same `Tab` writes the text itself into the editor.
Anything it contains, including another marker, is left as ordinary text you can edit, and
the next submission expands it like usual.

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

### Manual smoke test

The suite covers what a provider returns; it cannot prove that a real terminal delivers the
acceptance key or that Pi's editor paints a multiline insert the way the cursor model
expects. Run this after any change to completion, and before a release:

1. Configure one single-line and one multiline snippet, with `expandOnCompletion` on:

   ```json
   {
     "piSimpleSnippets": {
       "expandOnCompletion": true,
       "snippets": {
         "one": "single line text",
         "two": "first line\nsecond line\nthird line"
       }
     }
   }
   ```

2. `/reload`, then type `%` in the editor and confirm the native popup lists both names with
   their previews.
3. Accept `%one` with `Tab`, then `%two` with `Enter`. Each should put the **text** in the
   editor, not the marker; the multiline one should occupy three lines, with the cursor after
   the last inserted line and any text you typed after the marker still there.
4. Edit the inserted text freely — it is ordinary text, so editing, deleting, and undo work.
5. Submit a value that contains another marker, for example a snippet whose text is
   `Run %inner carefully` with `inner` also configured. Submitting expands `%inner`, because
   completion inserts text and submission is a separate pass.
6. Turn `expandOnCompletion` off, `/reload`, and accept a completion again: the marker should
   be inserted, exactly as in earlier versions.

With the setting off, also re-check the cases that must not have moved: `@file` completion,
the `shortcut` popup trigger, and submit-time expansion in a non-TUI run
(`pi --print "%one"`, where the model should receive `single line text`).

CI is `.github/workflows/ci.yml`: on pull requests, pushes to `master`, and manual
dispatch it installs with `npm ci`, runs `npm run check`, and verifies the tarball
contents with `npm pack --dry-run`. It publishes nothing and needs no secrets. There are
no production dependencies — the Pi packages are peers — so `npm audit --omit=dev` is
clean; any advisory can only come from the development toolchain.

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

## Planned work

Tracked in [the issue tracker](https://github.com/nietaki/pi-simple-snippets/issues). The
former entry here, expanding the snippet in the editor instead of only on submit, is now
the `expandOnCompletion` setting.

## Repository

- Source: <https://github.com/nietaki/pi-simple-snippets>
- Issues: <https://github.com/nietaki/pi-simple-snippets/issues>
- [`docs/behavior.md`](docs/behavior.md) — the observable behavior contract
- [`CHANGELOG.md`](CHANGELOG.md) — notable changes by release

## License

MIT — see [`LICENSE`](LICENSE).
