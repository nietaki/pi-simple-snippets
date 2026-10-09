/**
 * Names that are shared across modules and must not drift apart.
 *
 * `TRIGGER` is both the marker character and the only completion trigger this
 * extension adds; `SETTINGS_KEY` is the settings namespace Pi deep-merges and preserves;
 * `WIDGET_KEY` is the invisible TUI-capture widget's slot.
 */

/** `%` is both the marker and the only trigger character this extension adds. */
export const TRIGGER = "%";

export const SETTINGS_KEY = "pi-simple-snippets";

/**
 * The widget key doubles as the identity of the zero-line component installed only to
 * receive the live `TUI` from `setWidget()`. Placed `belowEditor` because the
 * above-editor container always contributes a leading `Spacer(1)`, while the
 * below-editor container adds only its components — an empty render there is invisible.
 */
export const WIDGET_KEY = "pi-simple-snippets";
