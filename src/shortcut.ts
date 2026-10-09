/**
 * The optional shortcut and its focus guard.
 *
 * Why this is a raw terminal listener rather than `pi.registerShortcut()`: a registered
 * shortcut cannot open the editor popup. The only editor-facing options are
 * `setEditorText()` (appends, loses the cursor) and `pasteToEditor()` (bracketed paste
 * explicitly does not trigger autocomplete), so the listener re-dispatches the keypress
 * as a typed `%` and lets the editor open its own popup.
 *
 * Re-dispatch semantics (pi-tui 1.1.0 `tui.js:685-700`): extension listeners run before
 * focus dispatch; `{consume: true}` drops the input, `{data: "%"}` replaces it and
 * continues down the chain, and the final value is delivered to whatever component holds
 * focus. Returning `undefined` leaves it untouched.
 *
 * Contract: docs/behavior.md ("Shortcut")
 */

import type { ExtensionUIContext, TerminalInputHandler } from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider, Component, KeyId, TUI } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";

import { TRIGGER, WIDGET_KEY } from "./constants.ts";

/**
 * Structural fingerprint of Pi's main editor. The concrete `Editor` class exposes
 * `setAutocompleteProvider()` and `isShowingAutocomplete()`; Pi's selectors, dialogs
 * and list components expose neither. Pi's built-in selectors swap the editor out with
 * `setFocus()` and are *not* overlays, so `hasOverlay()` alone cannot detect them.
 */
interface EditorLike extends Component {
	getText(): string;
	setAutocompleteProvider(provider: AutocompleteProvider): void;
	isShowingAutocomplete(): boolean;
}

function isEditorLike(component: Component | null): component is EditorLike {
	if (!component) return false;
	const candidate = component as Partial<EditorLike>;
	return (
		typeof candidate.getText === "function" &&
		typeof candidate.setAutocompleteProvider === "function" &&
		typeof candidate.isShowingAutocomplete === "function"
	);
}

/**
 * `getFocusedComponent()` exists on pi-tui's concrete TUI class but not on the exported
 * `TUI` interface, which is what `setWidget()`'s factory hands over. It is reached
 * through this narrow optional-member view instead of a broad cast, and probed once
 * before the shortcut listener is installed.
 */
export interface FocusAwareTui extends TUI {
	getFocusedComponent?(): Component | null;
}

/**
 * A widget that renders no lines, installed only because `setWidget()` is the one UI
 * factory that hands an extension the live `TUI` without replacing Pi's chrome.
 * `placement: "belowEditor"` matters: the above-editor container always adds a leading
 * `Spacer(1)`, while the below-editor container adds only its components, so an empty
 * render contributes nothing visible. The factory runs synchronously inside
 * `setWidget()` (interactive-mode.js:1881), so the reference is available as soon as the
 * call returns.
 */
const CAPTURE_WIDGET: Component = {
	render(): string[] {
		return [];
	},
	invalidate(): void {},
};

/** Read the live `TUI` through an invisible below-editor widget. */
export function captureTui(ui: ExtensionUIContext): FocusAwareTui | undefined {
	let captured: FocusAwareTui | undefined;
	ui.setWidget(
		WIDGET_KEY,
		(liveTui) => {
			captured = liveTui as FocusAwareTui;
			return CAPTURE_WIDGET;
		},
		{ placement: "belowEditor" },
	);
	return captured;
}

/** Remove the capture widget. Idempotent, like Pi's own reset. */
export function releaseTui(ui: ExtensionUIContext): void {
	ui.setWidget(WIDGET_KEY, undefined, { placement: "belowEditor" });
}

/**
 * Build the terminal-input handler for `shortcut`. It acts only while the main editor
 * owns focus, so the keypress reaches a selector, dialog, or overlay untouched; a
 * missing `TUI` makes it inert rather than guessing where to type.
 */
export function createShortcutHandler(
	getTui: () => FocusAwareTui | undefined,
	shortcut: string,
): TerminalInputHandler {
	const keyId = shortcut as KeyId;
	return (data) => {
		// Cheap check first: almost no terminal input is our shortcut.
		if (!matchesKey(data, keyId)) return undefined;
		const active = getTui();
		// Focus is re-read on every keypress rather than cached.
		if (!active || active.hasOverlay()) return undefined;
		if (!isEditorLike(active.getFocusedComponent?.() ?? null)) return undefined;
		// Re-dispatch as a typed `%` so the editor opens its own autocomplete.
		return { data: TRIGGER };
	};
}
