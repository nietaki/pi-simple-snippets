/**
 * The `%` snippet completion provider, installed as a wrapper around Pi's own provider
 * so the native editor popup stays the only completion UI.
 *
 * Trigger characters: Pi aggregates `triggerCharacters` across every wrapper in the
 * chain (`interactive-mode.js:546-556`) and `Editor.setAutocompleteTriggerCharacters()`
 * always re-seeds its private `@`/`#` defaults (`editor.js:1952`), rejecting `/`,
 * whitespace, and multi-character entries. A wrapper therefore declares only its own
 * characters; merging by hand risks regressing `@`/`#`.
 *
 * Contract: docs/behavior.md ("Autocomplete")
 */

import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";
import { fuzzyFilter } from "@earendil-works/pi-tui";

import type { SnippetConfig } from "./config.ts";
import { TRIGGER } from "./constants.ts";
import { SNIPPET_QUERY_RE, TOKEN_RE } from "./patterns.ts";

const MAX_SUGGESTIONS = 20;
const MAX_PREVIEW_CHARS = 80;

/**
 * Return the `%token` immediately before the cursor, or undefined when the cursor is
 * not inside a snippet-shaped token.
 */
function extractSnippetToken(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
): string | undefined {
	const line = lines[cursorLine] ?? "";
	const col = Math.max(0, Math.min(cursorCol, line.length));
	const match = TOKEN_RE.exec(line.slice(0, col));
	if (!match) return undefined;
	const name = match[2] ?? "";
	// `%.` and `%-.` are not snippet tokens: let the delegated provider answer.
	if (name.length > 0 && !SNIPPET_QUERY_RE.test(name)) return undefined;
	return `${TRIGGER}${name}`;
}

/** One-line preview of a snippet value for the popup description. */
function preview(value: string): string {
	const collapsed = value.replace(/\s+/gu, " ").trim();
	if (collapsed.length <= MAX_PREVIEW_CHARS) return collapsed;
	return `${Array.from(collapsed).slice(0, MAX_PREVIEW_CHARS - 1).join("")}…`;
}

/**
 * Resolve the text an owned item inserts: the marker itself, or — when
 * `expandOnCompletion` is on — the snippet's configured value. `undefined` means the
 * served item no longer maps to a configured snippet (a reload changed settings between
 * suggestion and acceptance), so the caller delegates instead of inserting nothing.
 * Every owned item value is `%name`, which is what the lookup key is built from.
 *
 * Item values stay markers even when the setting is on: labels, prefixes, previews, fuzzy
 * matching, and the ownership check in `served` are all built on them.
 */
function resolveItemText(marker: string, config: SnippetConfig): string | undefined {
	if (!config.expandOnCompletion) return marker;
	return config.lookup.get(marker.slice(TRIGGER.length));
}

/**
 * Replace the active token with `text`, which may be multiline.
 *
 * Pi's editor holds its lines as logical lines and normalizes typed/pasted `CRLF` and `CR`
 * to `\n` (`editor.js:954`), while a settings value can carry either. Splitting on
 * normalized line endings is therefore the minimum needed to hand back well-formed lines.
 * Other whitespace is kept as configured, unlike typing, so the same snippet inserts the
 * same text through completion and through submission.
 */
function insertValue(
	before: string,
	after: string,
	text: string,
): { lines: string[]; cursorCol: number } {
	const parts = text.replace(/\r\n?/gu, "\n").split("\n");
	const last = parts[parts.length - 1];
	const lines = parts.map((part, index) => {
		const head = index === 0 ? before : "";
		const tail = index === parts.length - 1 ? after : "";
		return `${head}${part}${tail}`;
	});
	return {
		lines,
		// Only a single-line insert shares its line with the text before the token.
		cursorCol: parts.length === 1 ? before.length + last.length : last.length,
	};
}

export function createSnippetProvider(
	previous: AutocompleteProvider,
	getConfig: () => SnippetConfig,
): AutocompleteProvider {
	/** What the latest `getSuggestions()` served, used to recognize our own items. */
	let served: { prefix: string; items: AutocompleteItem[] } | undefined;

	return {
		// Pi aggregates trigger characters across the wrapper chain and the editor
		// re-seeds its own `@`/`#` defaults, so only `%` belongs here.
		triggerCharacters: [TRIGGER],

		async getSuggestions(
			lines: string[],
			cursorLine: number,
			cursorCol: number,
			options: { signal: AbortSignal; force?: boolean },
		): Promise<AutocompleteSuggestions | null> {
			served = undefined;
			const token = extractSnippetToken(lines, cursorLine, cursorCol);
			if (token === undefined) {
				return previous.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const { snippets } = getConfig();
			// A snippet token belongs to us even with nothing to show: an empty list
			// keeps unrelated file completion out of the popup.
			if (snippets.length === 0) return { items: [], prefix: token };

			const query = token.slice(TRIGGER.length);
			const matched =
				query.length === 0 ? snippets : fuzzyFilter(snippets, query, (snippet) => snippet.name);
			const items = matched.slice(0, MAX_SUGGESTIONS).map((snippet) => ({
				value: `${TRIGGER}${snippet.name}`,
				label: `${TRIGGER}${snippet.name}`,
				description: preview(snippet.value),
			}));
			served = { prefix: token, items };
			return { items, prefix: token };
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			const isOurs =
				served !== undefined &&
				served.prefix === prefix &&
				served.items.some((candidate) => candidate.value === item.value);
			if (!isOurs) return previous.applyCompletion(lines, cursorLine, cursorCol, item, prefix);

			const currentLine = lines[cursorLine] ?? "";
			const start = cursorCol - prefix.length;
			if (start < 0 || currentLine.slice(start, cursorCol) !== prefix) {
				return previous.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			}
			const text = resolveItemText(item.value, getConfig());
			if (text === undefined) {
				return previous.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			}
			// Replace only the active token; text after the cursor is preserved.
			const inserted = insertValue(currentLine.slice(0, start), currentLine.slice(cursorCol), text);
			return {
				lines: [...lines.slice(0, cursorLine), ...inserted.lines, ...lines.slice(cursorLine + 1)],
				cursorLine: cursorLine + inserted.lines.length - 1,
				cursorCol: inserted.cursorCol,
			};
		},

		// The editor consults this only for forced completion (`editor.js:1916-1921`),
		// and a wrapper that omits the method makes the delegated provider's refusal
		// unobservable — so forward it.
		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return previous.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}
