/**
 * Reading and validating the `pi-simple-snippets` settings namespace.
 *
 * Pi declares no schema for extension settings: `settings-manager.js` deep-merges
 * unknown keys and writes them back untouched, so this namespace survives Pi's own
 * writes. That freedom is why validation is runtime, not just types — a malformed
 * namespace must degrade to "as if the extension were absent" with one summarized
 * warning rather than throw inside `session_start`.
 *
 * Contract: docs/behavior.md ("Configuration")
 */

import { SETTINGS_KEY } from "./constants.ts";
import { SNIPPET_NAME_RE } from "./patterns.ts";

export interface Snippet {
	name: string;
	value: string;
}

export interface SnippetConfig {
	/** Accepted snippets, sorted by name so the popup order is deterministic. */
	snippets: Snippet[];
	lookup: Map<string, string>;
	/** Normalized key identifier, or undefined when no usable shortcut is configured. */
	shortcut: string | undefined;
	/** Problems found while validating, summarized into one notification. */
	warnings: string[];
}

export const EMPTY_CONFIG: SnippetConfig = {
	snippets: [],
	lookup: new Map(),
	shortcut: undefined,
	warnings: [],
};

const MODIFIERS = new Set(["ctrl", "shift", "alt", "super"]);
const NAMED_BASE_KEYS = new Set([
	"escape",
	"esc",
	"enter",
	"return",
	"tab",
	"space",
	"backspace",
	"delete",
	"insert",
	"clear",
	"home",
	"end",
	"pageup",
	"pagedown",
	"up",
	"down",
	"left",
	"right",
	"f1",
	"f2",
	"f3",
	"f4",
	"f5",
	"f6",
	"f7",
	"f8",
	"f9",
	"f10",
	"f11",
	"f12",
]);

/**
 * Validate a configured shortcut. Requires at least one modifier so a bare printable
 * key can never swallow ordinary typing, and lowercases every part because pi-tui's
 * `parseKeyId()` matches the lowercased form.
 */
export function normalizeShortcut(raw: string): string | undefined {
	const parts = raw.trim().toLowerCase().split("+");
	if (parts.length < 2) return undefined;
	if (parts.some((part) => part.length === 0)) return undefined;
	const base = parts[parts.length - 1];
	const modifiers = parts.slice(0, -1);
	if (modifiers.some((modifier) => !MODIFIERS.has(modifier))) return undefined;
	if (new Set(modifiers).size !== modifiers.length) return undefined;
	const singlePrintableAscii = base.length === 1 && base >= "!" && base <= "~";
	if (!singlePrintableAscii && !NAMED_BASE_KEYS.has(base)) return undefined;
	return parts.join("+");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

/** Read and validate the extension namespace from effective settings. */
export function loadConfig(settings: unknown): SnippetConfig {
	const warnings: string[] = [];
	const rawNamespace = asRecord(settings)?.[SETTINGS_KEY];
	if (rawNamespace === undefined) return { ...EMPTY_CONFIG, warnings };

	const fields = asRecord(rawNamespace);
	if (fields === undefined) {
		warnings.push(`"${SETTINGS_KEY}" must be an object; ignoring the whole namespace`);
		return { ...EMPTY_CONFIG, warnings };
	}

	// Shortcut: absent is fine, unusable is a warning.
	let shortcut: string | undefined;
	const rawShortcut = fields.shortcut;
	if (rawShortcut !== undefined) {
		if (typeof rawShortcut !== "string") {
			warnings.push("`shortcut` must be a string; ignoring it");
		} else {
			shortcut = normalizeShortcut(rawShortcut);
			if (shortcut === undefined) {
				warnings.push(
					`\`shortcut\` "${rawShortcut}" needs "mod[+mod]+key" with at least one modifier; ignoring it`,
				);
			}
		}
	}

	// Snippets: malformed entries are skipped, the rest still work.
	const snippets: Snippet[] = [];
	const skipped: string[] = [];
	const rawSnippets = fields.snippets;
	if (rawSnippets !== undefined) {
		const table = asRecord(rawSnippets);
		if (table === undefined) {
			warnings.push("`snippets` must be an object of name to text; ignoring it");
		} else {
			for (const [name, value] of Object.entries(table)) {
				if (!SNIPPET_NAME_RE.test(name)) {
					skipped.push(`${JSON.stringify(name)} (invalid name)`);
					continue;
				}
				if (typeof value !== "string" || value.length === 0) {
					skipped.push(`${JSON.stringify(name)} (value must be a non-empty string)`);
					continue;
				}
				snippets.push({ name, value });
			}
		}
	}

	snippets.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	if (skipped.length > 0) {
		const label = skipped.length === 1 ? "entry" : "entries";
		warnings.push(`ignored ${skipped.length} snippet ${label}: ${skipped.join(", ")}`);
	}

	return {
		snippets,
		lookup: new Map(snippets.map((snippet) => [snippet.name, snippet.value])),
		shortcut,
		warnings,
	};
}
