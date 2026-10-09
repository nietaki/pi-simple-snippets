/**
 * The marker grammar, in one place, so completion and expansion cannot disagree.
 *
 * The boundary rule is mirrored from pi-tui 1.1.0 `dist/utils.js` (`cjkBreakRegex`,
 * `cjkPunctuationRegex`, `autocompleteSeparatorRegex`, `autocompleteBoundaryRegex`) and
 * `dist/components/editor.js` (`autocompleteTokenStartSource`, line 174). Those pattern
 * sources are not re-exported from the package root, so the identical text lives here.
 * Pi's editor decides *when* the provider is called; sharing the rule means completion
 * and expansion never disagree about what a snippet token is.
 *
 * `test/pi-compatibility.test.ts` pins these sources against the installed pi-tui and
 * re-checks the boundary behaviorally. On a Pi upgrade, re-verify before editing.
 */

import { TRIGGER } from "./constants.ts";

/**
 * Snippet names and marker names share one grammar: lowercase, start and end with an
 * alphanumeric, with dots, hyphens, and underscores allowed internally.
 */
export const MARKER_NAME_SOURCE = "[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?";
export const SNIPPET_NAME_SOURCE = MARKER_NAME_SOURCE;
export const SNIPPET_NAME_RE = new RegExp(`^${SNIPPET_NAME_SOURCE}$`, "u");
/** Partial popup queries may end in punctuation typed after a valid name. */
export const SNIPPET_QUERY_RE = /^[a-z0-9][a-z0-9._-]*$/u;

/**
 * A name inside a marker has to end on an alphanumeric. A greedy maximal run would
 * swallow the sentence period in `Please %use-mcp.` and report the unknown name
 * `use-mcp.`. Capturing the leftover `[._-]*` separately lets `%use-mcp.` expand and
 * re-emit `.`, while `%use-mcpx` stays unknown because it is never shortened to
 * `use-mcp`.
 */
export const TRAILING_PUNCT_SOURCE = "[._-]*";

const CJK_BREAK_SOURCE =
	"[\\p{Script_Extensions=Han}\\p{Script_Extensions=Hiragana}\\p{Script_Extensions=Katakana}\\p{Script_Extensions=Hangul}\\p{Script_Extensions=Bopomofo}]";
const CJK_PUNCTUATION_SOURCE = `(?:(?=\\p{Punctuation})${CJK_BREAK_SOURCE}|[，．：；！？（）［］｛｝“”‘’…—])`;
const SEPARATOR_SOURCE = `(?:\\s|${CJK_PUNCTUATION_SOURCE})`;
/** Opening wrappers allowed between the boundary and the marker. */
const WRAPPERS_SOURCE = "[([{<`]";

/**
 * Whole-prompt expansion: boundary, wrappers, `%`, optional escape `%`, name.
 * Global and multiline so every line start is a boundary too. `String.replace`
 * resets `lastIndex` on a global regex, so this shared instance is stateless in use.
 */
export const EXPANSION_RE = new RegExp(
	`(^|${SEPARATOR_SOURCE})(${WRAPPERS_SOURCE}*)%(%)?(${MARKER_NAME_SOURCE})(${TRAILING_PUNCT_SOURCE})`,
	"gmu",
);

/**
 * Cursor token extraction, anchored at the end of the text before the cursor, with the
 * boundary inside the match so a wrapper-only prefix cannot fabricate a boundary.
 * Equivalent to Pi's own trigger pattern for `%` tokens.
 */
export const TOKEN_RE = new RegExp(
	`(?:^|${SEPARATOR_SOURCE})(${WRAPPERS_SOURCE}*)${TRIGGER}([a-z0-9._-]*)$`,
	"u",
);
