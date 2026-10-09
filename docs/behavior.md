# Behavior contract

The observable behavior of `pi-simple-snippets`. Implementation and
`test/*.test.ts` are authoritative alongside this document; Pi-internal rationale lives
in the code comments next to the constraint it explains.

Verified against Pi 1.1.0.

## Configuration

All configuration lives under the `piSimpleSnippets` key of Pi settings: the user
`~/.pi/agent/settings.json`, or a project `.pi/settings.json` that Pi merges over the
user value. The key is lower camelCase, like Pi's own settings keys; the package name,
notification prefix, and internal widget key keep the hyphenated npm spelling.

```json
{
  "piSimpleSnippets": {
    "shortcut": "ctrl+shift+s",
    "snippets": {
      "use-mcp": "Use your MCP tools to find the information"
    }
  }
}
```

- `snippets` — object of name to text. Names must match
  `[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?` (lowercase, start and end with a letter or digit;
  dots, hyphens, and underscores are allowed internally); values must be non-empty strings.
- `shortcut` — optional, no default. `"modifier[+modifier]+key"` with **at least one**
  `ctrl`, `shift`, `alt`, or `super`. The whole string is trimmed and lowercased; the
  parts around `+` are not individually trimmed, so `"ctrl + shift + s"` is rejected
  while `"CTRL+SHIFT+S"` is accepted.
  - Base key: a single printable ASCII character (`!` through `~`), or one of `escape`,
    `esc`, `enter`, `return`, `tab`, `space`, `backspace`, `delete`, `insert`, `clear`,
    `home`, `end`, `pageup`, `pagedown`, `up`, `down`, `left`, `right`, `f1`–`f12`.
    Duplicate modifiers and unknown modifiers are rejected.
- Configuration is read on every `session_start` — startup, reload, new, resume, fork —
  which is how an edited `settings.json` takes effect after `/reload`.

### Validation and warnings

- Malformed snippet entries are skipped individually; the valid ones still work.
- A rejected shortcut is ignored; snippets still work.
- A `snippets` value that is not an object, or a namespace that is not an object,
  discards that part with a warning.
- All problems found in one generation are summarized into **one** `warning`
  notification at session start, prefixed `pi-simple-snippets:`.
- Notifications only appear in the interactive TUI. Other modes accept or reject the
  same configuration silently.
- An absent namespace produces no notification at all.
- Only `piSimpleSnippets` is read. Any other settings key — including a leftover
  `pi-simple-snippets` block from an earlier draft of this package — is ignored silently
  with no warning, so re-check the spelling when configuration appears to have no effect.

### Empty snippets and shortcut-only configuration

When no usable snippet is configured, the extension registers no completion provider, so
it does not quietly suppress Pi's `%` completion. A valid `shortcut` is independent of
snippets: in TUI mode it can still register a terminal-input listener and invisible
capture widget. With neither usable snippets nor a valid shortcut, no completion provider,
terminal-input listener, or widget is registered.

## Marker expansion

Expansion runs on submitted input, one left-to-right pass over the whole prompt. Snippet
values are inserted literally and are never re-scanned, so a value that mentions another
marker stays text.

A change is reported as a transform; text that is unchanged after the pass is reported as
unmodified, so attached images and the original text pass through untouched.

### The boundary rule

A marker starts at a boundary, identical to the rule Pi's own editor uses to decide when
to open the completion popup:

- the start of the prompt or of any line;
- after any whitespace character;
- after CJK script punctuation (`，．：；！？（）［］｛｝“”‘’…—`, or a CJK-script
  character that is itself punctuation).

ASCII punctuation (`,`, `:`, `'`, `"`, `-`) is **not** a boundary, and neither is a word
character or a digit: `x%use-mcp` is untouched.

Any number of the opening wrappers `(`, `[`, `{`, `<`, `` ` `` may sit between the
boundary and the `%`. So `(%use-mcp)` and `` `%use-mcp` `` expand.

Completion and expansion always agree about what a snippet token is. A position where the
popup can open is a position where submission expands.

### The name rule

- The name matches `[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?`: lowercase, starting and ending
  with a letter or digit, with `.`, `-`, and `_` allowed internally.
- A leftover run of `.`, `-`, `_` after the name is treated as surrounding punctuation:
  it is re-emitted unchanged. `Please %use-mcp.` expands and keeps its period.
- A longer unknown run is never shortened to a known prefix: `%use-mcpx` stays literal
  even when `use-mcp` is configured.
- Names are lowercase only. `%Use-MCP` is untouched.

### Escaping

`%%name` at a valid boundary yields the literal `%name`, whether or not the name is
configured. Only that exact shape escapes — `%%`, `%%%name`, `%%Name`, and a `%%` that is
not at a boundary are left untouched.

### Unknown markers

An unknown marker stays exactly as typed, with no warning. Because the rule is
syntax-based, ordinary uses of `%` are safe as long as no snippet with that name exists:
`git log --format=%h`, `printf`, and SQL wildcards pass through.

### Summary

| Submitted | Result (with `use-mcp` configured) |
| --- | --- |
| `%use-mcp` | the snippet value |
| `Please %use-mcp.` | `Please ` + value + `.` |
| `Check (%use-mcp)` | wrappers before the marker are allowed |
| `，%use-mcp` | CJK punctuation is a boundary |
| `%rec` where `rec` = `see %use-mcp` | `see %use-mcp` — the value's own marker is not re-expanded |
| `x%use-mcp` | unchanged |
| `%unknown` | unchanged |
| `%%use-mcp` | `%use-mcp` |
| `git log --format=%h` | unchanged (`h` is not configured) |

### Which submissions expand

Every submission that passes through Pi's input handling expands: interactive, RPC, print,
and JSON modes, and steering or follow-up delivery. Arguments to an extension-registered
slash command are dispatched before input handlers run, so `/somecmd %use-mcp` keeps the
marker literal.

## Autocomplete

In the interactive TUI, `%query` at a boundary opens Pi's **native** editor popup with
matching snippet names, one-line value previews, fuzzy filtering, `Tab` or `Enter`
acceptance, and `Esc` dismissal.

- A **bare `%` lists every snippet**, in name order. The accepted trade-off: prose
  containing a standalone `%` (`100 %`, a SQL wildcard) also opens the list. Dismiss it
  with `Esc`; the text itself is unaffected.
- At most 20 suggestions.
- A preview collapses all whitespace to single spaces and is capped at 80 characters,
  with a trailing `…`.
- Requests outside a snippet token go to the provider this extension wraps, so `@file`
  and slash-command completion are untouched. So is `#` in its built-in role.
- A snippet token with no matches shows nothing rather than falling through to file
  completion. That includes a token whose name run is rejected by the name rule after a
  valid prefix — the documented case is completing `%use-mcp.` (trailing punctuation
  already typed) finds nothing: the query keeps the punctuation, the name rule does not.
  Complete first, then type the punctuation.
- Accepting a completion replaces only the active token. Text after the cursor is
  preserved, and the cursor lands directly after the inserted name.
- Items the wrapped provider produced are applied by that provider, not here.
- `Tab` with exactly one remaining match is applied immediately without showing the list.
  That is Pi's existing behavior for every provider.
- A manual `%` trigger and the shortcut both open the same popup.

## Shortcut

When `shortcut` is configured, a raw terminal-input listener converts that keypress into
a typed `%`, so the editor opens its own popup exactly as if you had typed the character.

- The listener acts **only while the main editor owns focus**. With a Pi selector
  (`/model`, `/settings`, session, tree, message), an overlay, or an extension dialog
  holding focus, the keypress is left untouched and reaches that component normally.
- Focus is re-read on every keypress; nothing about focus is cached.
- If the running Pi build does not expose the focused component, the shortcut is not
  installed at all and a warning says so, rather than typing `%` into an unknown target.
  Snippet expansion and completion keep working.
- This is a raw listener, **not** a registered Pi shortcut: it does not appear in
  `/hotkeys`, and Pi's built-in shortcut-conflict diagnostics do not see it. Check for
  collisions with your terminal, window manager, and multiplexer keymaps yourself.
- Delivering the key combo to the terminal is outside this package's control. Under a
  Kitty keyboard protocol terminal the sequence arrives intact; legacy terminals may not
  distinguish `ctrl+shift+s` at all, in which case the listener never fires.

## Session lifecycle

TUI integration is registered for every session-start generation and unwound on
`session_shutdown`:

- after `/new`, `/resume`, `/fork`, tree navigation, or `/reload`, completion and the
  shortcut are registered again;
- a duplicate `session_start` inside one generation does not register twice;
- `session_shutdown` unsubscribes the terminal-input listener, removes the extension's
  widget, and clears configuration until the next start;
- configuration is re-read on each start, so edited settings take effect on `/reload`.

## Interaction with other extensions

Expansion happens in Pi's input handling, before the text reaches the model. Sibling
extensions that also read submitted input observe the **expanded** text; which sibling
runs first depends on package configuration order, and this package makes no ordering
promise about other npm packages.

Pi expands prompt templates and skill commands **after** input handlers, so a snippet
value that begins with `/name` or `skill:` can be interpreted as an invocation rather
than plain text. This is a documented hazard, not a guard.

## Known limitations

- No recursive expansion, by design: a snippet value is text, never a template.
- A snippet value beginning with `/` can be picked up as a prompt template or skill
  command (see the interaction above).
- Extension slash-command arguments are not expanded.
- The trailing-punctuation asymmetry in the popup (see "Autocomplete").
- Markers inside fenced code blocks are expanded like anywhere else. There is no
  syntax-aware exemption.
- The shortcut is invisible to `/hotkeys` and to Pi's conflict diagnostics.
- Only one settings namespace: there is no project-local override file, no per-snippet
  aliases or descriptions, and no placeholder editing.

## Reference

- [`README.md`](../README.md) — installation, configuration summary, development, and
  release.
- `test/*.test.ts` — the executable form of this contract (source repository, not in the
  npm tarball).
- `test/pi-compatibility.test.ts` — the assumptions this package mirrors from Pi, which
  are expected to be re-verified on every Pi upgrade.
