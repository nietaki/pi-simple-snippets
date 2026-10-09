/**
 * The one-pass marker expansion.
 *
 * Contract: docs/behavior.md ("Marker expansion")
 */

import type { SnippetConfig } from "./config.ts";
import { TRIGGER } from "./constants.ts";
import { EXPANSION_RE } from "./patterns.ts";

/**
 * One left-to-right pass over the whole prompt. Values are never re-scanned, so a
 * snippet that mentions another marker is inserted literally.
 */
export function expandText(text: string, config: SnippetConfig): { text: string; changed: boolean } {
	if (config.snippets.length === 0 || !text.includes(TRIGGER)) {
		return { text, changed: false };
	}
	const expanded = text.replace(
		EXPANSION_RE,
		(
			match: string,
			boundary: string,
			wrappers: string,
			escape: string,
			name: string,
			trailing: string,
		): string => {
			const prefix = (boundary ?? "") + (wrappers ?? "");
			const tail = trailing ?? "";
			// `%%name` is an escape: emit a literal `%name`, configured or not.
			if (escape === TRIGGER) return `${prefix}${TRIGGER}${name}${tail}`;
			const value = config.lookup.get(name);
			// Unknown markers stay exactly as typed.
			return value === undefined ? match : prefix + value + tail;
		},
	);
	return { text: expanded, changed: expanded !== text };
}
