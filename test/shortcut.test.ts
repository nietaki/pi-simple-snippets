/**
 * The optional shortcut: raw terminal-input matching and the focus guard matrix.
 * Uses the real pi-tui `matchesKey`, including its Kitty-protocol switch, so the
 * byte sequence under test is exactly what a terminal delivers.
 *
 * Contract: docs/behavior.md ("Shortcut")
 */

import { setKittyProtocolActive } from "@earendil-works/pi-tui";
import { afterAll, describe, expect, it } from "vitest";

import { EDITOR, FakePi, GOOD_SETTINGS, SELECTOR, VALUE, makeCtx } from "./harness.ts";

/** `ctrl+shift+s` encoded the way a Kitty-protocol terminal sends it. */
const SHORTCUT = "\x1b[115;6u";

async function boot(ctxOpts: Parameters<typeof makeCtx>[0] = {}) {
	const pi = FakePi.register(GOOD_SETTINGS);
	const s = makeCtx(ctxOpts);
	await pi.start(s.ctx);
	const handler = s.listeners[0];
	if (!handler) throw new Error("expected a shortcut listener");
	return { pi, s, press: (data: string) => handler(data) };
}

describe("with the Kitty keyboard protocol active", () => {
	afterAll(() => setKittyProtocolActive(false));

	it("types % while the main editor owns focus", async () => {
		const { press } = await boot({ focused: EDITOR });
		expect(press(SHORTCUT)).toStrictEqual({ data: "%" });
	});

	it("leaves unrelated input untouched", async () => {
		const { press } = await boot({ focused: EDITOR });
		expect(press("s")).toBeUndefined();
		expect(press("hello")).toBeUndefined();
		expect(press("\r")).toBeUndefined();
	});

	it("does not fire on legacy ctrl+s, and still fires once Kitty is on", async () => {
		setKittyProtocolActive(false);
		const { press } = await boot({ focused: EDITOR });
		expect(press("\x13")).toBeUndefined();
		setKittyProtocolActive(true);
		expect(press(SHORTCUT)).toStrictEqual({ data: "%" });
	});

	it("is inert while an overlay owns the screen", async () => {
		const { press, s } = await boot({ focused: EDITOR, overlay: true });
		expect(press(SHORTCUT)).toBeUndefined();
		s.setOverlay(false);
		expect(press(SHORTCUT)).toStrictEqual({ data: "%" });
	});

	it("is inert while a Pi selector holds focus", async () => {
		const { press, s } = await boot({ focused: EDITOR });
		s.setFocused(SELECTOR);
		expect(press(SHORTCUT)).toBeUndefined();
		s.setFocused(EDITOR);
		expect(press(SHORTCUT)).toStrictEqual({ data: "%" });
	});

	it("is inert when nothing is focused", async () => {
		const { press, s } = await boot({ focused: EDITOR });
		s.setFocused(null);
		expect(press(SHORTCUT)).toBeUndefined();
	});

	it("is inert for a component without the editor autocomplete fingerprint", async () => {
		const { press, s } = await boot({ focused: EDITOR });
		s.setFocused({ ...SELECTOR, setAutocompleteProvider: () => {} });
		expect(press(SHORTCUT)).toBeUndefined();
	});

	it("re-reads focus on every keypress instead of caching it", async () => {
		const { press, s } = await boot({ focused: SELECTOR });
		expect(press(SHORTCUT)).toBeUndefined();
		s.setFocused(EDITOR);
		expect(press(SHORTCUT)).toStrictEqual({ data: "%" });
	});
});

describe("when the running TUI does not expose the focused component", () => {
	it("installs no listener and announces why", async () => {
		// A TUI carrying only the documented interface members: no getFocusedComponent.
		const s = makeCtx({ tui: { hasOverlay: () => false, requestRender: () => {} } });
		const pi = FakePi.register(GOOD_SETTINGS);
		await pi.start(s.ctx);

		expect(s.listeners).toHaveLength(0);
		expect(s.notices.some((n) => n.includes("not installed"))).toBe(true);
		// Expansion is independent of the TUI and keeps working.
		expect(pi.input("%use-mcp").text).toBe(VALUE);
	});

	it("still registers the completion wrapper", async () => {
		const s = makeCtx({ tui: { hasOverlay: () => false, requestRender: () => {} } });
		const pi = FakePi.register(GOOD_SETTINGS);
		await pi.start(s.ctx);
		expect(s.wrapperFactories).toHaveLength(1);
		expect(s.provider()).toBeDefined();
	});
});
