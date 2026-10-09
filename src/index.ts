/**
 * pi-simple-snippets
 *
 * Expands configured `%snippet-name` markers when a prompt is submitted, adds
 * `%`-triggered snippet-name completion to Pi's native editor autocomplete popup, and
 * optionally binds a shortcut that types a literal `%` to open that popup.
 *
 * Configuration lives under the `piSimpleSnippets` key of Pi settings:
 *
 *     "piSimpleSnippets": {
 *       "shortcut": "ctrl+shift+s",
 *       "snippets": { "use-mcp": "Use your MCP tools to find the information" }
 *     }
 *
 * This module is lifecycle wiring only; the marker grammar, configuration validation,
 * completion provider, and shortcut guard live in their own modules. Behavior is
 * specified in `docs/behavior.md`.
 *
 * Verified against Pi 1.1.0 (`@earendil-works/pi-coding-agent` and `pi-tui` 1.1.0).
 */

import type { ExtensionAPI, ExtensionContext, InputEvent, InputEventResult } from "@earendil-works/pi-coding-agent";

import { createSnippetProvider } from "./autocomplete.ts";
import { EMPTY_CONFIG, type SnippetConfig, loadConfig } from "./config.ts";
import { expandText } from "./expansion.ts";
import { captureTui, createShortcutHandler, type FocusAwareTui, releaseTui } from "./shortcut.ts";

export default function piSimpleSnippets(pi: ExtensionAPI): void {
	// Inert until the first `session_start` populates it.
	let config: SnippetConfig = EMPTY_CONFIG;
	/** Live `TUI`, captured through the zero-line widget during this generation. */
	let tui: FocusAwareTui | undefined;
	let unsubscribeTerminalInput: (() => void) | undefined;
	/** One TUI registration per session-start generation; cleared by `session_shutdown`. */
	let registered = false;

	pi.on("input", (event: InputEvent): InputEventResult => {
		const result = expandText(event.text, config);
		if (!result.changed) return { action: "continue" };
		return { action: "transform", text: result.text, images: event.images };
	});

	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		config = loadConfig(pi.getSettings());
		emitWarnings(config, ctx);

		if (ctx.mode !== "tui") return;
		// `resetExtensionUI()` empties both the autocomplete-wrapper list and the
		// terminal-input listener list before every session transition and on `/reload`,
		// so each generation registers again. The flag only rejects a duplicate
		// `session_start` inside one generation.
		if (registered) return;
		registered = true;

		// With nothing usable configured the extension registers no UI at all, so `%`
		// behaves exactly as it does without this extension.
		if (config.snippets.length > 0) {
			ctx.ui.addAutocompleteProvider((previous) => createSnippetProvider(previous, () => config));
		}

		if (config.shortcut === undefined) return;
		const activeTui = captureTui(ctx.ui);
		if (!activeTui || typeof activeTui.getFocusedComponent !== "function") {
			// Fail visibly rather than installing a shortcut that would type `%` into
			// whatever happens to hold focus.
			ctx.ui.notify(
				"pi-simple-snippets: shortcut not installed because the focused component is unavailable; snippet expansion still works",
				"warning",
			);
			return;
		}
		tui = activeTui;
		const shortcut = config.shortcut;
		unsubscribeTerminalInput = ctx.ui.onTerminalInput(createShortcutHandler(() => tui, shortcut));
	});

	pi.on("session_shutdown", (_event, ctx: ExtensionContext) => {
		registered = false;
		if (unsubscribeTerminalInput) {
			unsubscribeTerminalInput();
			unsubscribeTerminalInput = undefined;
		}
		if (ctx.mode === "tui") {
			// Idempotent: Pi also clears extension widgets when it resets extension UI.
			releaseTui(ctx.ui);
		}
		tui = undefined;
		config = EMPTY_CONFIG;
	});
}

/** Summarize configuration problems once per session-start generation. */
function emitWarnings(config: SnippetConfig, ctx: ExtensionContext): void {
	if (config.warnings.length === 0 || ctx.mode !== "tui") return;
	ctx.ui.notify(`pi-simple-snippets: ${config.warnings.join("; ")}`, "warning");
}
