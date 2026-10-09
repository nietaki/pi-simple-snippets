/**
 * Session lifecycle: the factory registers handlers and nothing else, TUI surface is
 * registered once per session-start generation (never once per runtime), shutdown
 * unwinds it, and configuration is re-read on every generation.
 *
 * The register-per-generation rule exists because Pi's `resetExtensionUI()` empties
 * the autocomplete-wrapper list and the terminal-input listener list on every session
 * transition and on `/reload`; registering once per runtime would silently lose `%`
 * completion after `/new`, `/resume`, `/fork`, or reload.
 *
 * Contract: docs/behavior.md ("Configuration"), README ("Implementation notes")
 */

import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import piSimpleSnippets from "../src/index.ts";
import {
	EDITOR,
	FakePi,
	GOOD_SETTINGS,
	VALUE,
	makeCtx,
	makePrevious,
	snippetSettings,
} from "./harness.ts";

describe("the factory", () => {
	it("registers exactly three handlers and reads nothing", () => {
		const pi = new FakePi();
		// No settings planted: the factory must not touch `getSettings()` or the UI.
		piSimpleSnippets(pi.asApi());
		expect([...pi.handlers.keys()].sort()).toStrictEqual(["input", "session_shutdown", "session_start"]);
		expect(pi.handlerCount).toBe(3);
	});

	it("is inert before the first session_start", () => {
		const pi = FakePi.register(GOOD_SETTINGS);
		expect(pi.input("%use-mcp")).toStrictEqual({ action: "continue" });
	});
});

describe("session_start", () => {
	it("reads settings only when a session starts", async () => {
		const pi = new FakePi();
		let reads = 0;
		pi.getSettings = () => {
			reads++;
			return GOOD_SETTINGS;
		};
		piSimpleSnippets(pi.asApi());
		expect(reads).toBe(0);
		await pi.start(makeCtx().ctx);
		expect(reads).toBe(1);
	});

	it("registers one wrapper, one listener, and one widget per generation", async () => {
		const pi = FakePi.register(GOOD_SETTINGS);
		const s = makeCtx({ focused: EDITOR });
		await pi.start(s.ctx);
		expect(s.wrapperFactories).toHaveLength(1);
		expect(s.listeners).toHaveLength(1);
		expect(s.widgets.get("pi-simple-snippets")?.options).toStrictEqual({ placement: "belowEditor" });
	});

	it("refuses a duplicate session_start inside one generation", async () => {
		const pi = FakePi.register(GOOD_SETTINGS);
		const s = makeCtx({ focused: EDITOR });
		await pi.start(s.ctx);
		await pi.start(s.ctx, "startup");
		expect(s.wrapperFactories).toHaveLength(1);
		expect(s.listeners).toHaveLength(1);
		expect(s.widgets.size).toBe(1);
	});

	it.each(["startup", "reload", "new", "resume", "fork"])("re-registers after shutdown (%s)", async (reason) => {
		const pi = FakePi.register(GOOD_SETTINGS);
		const s = makeCtx({ focused: EDITOR });
		await pi.start(s.ctx);
		await pi.shutdown(s.ctx, reason);
		await pi.start(s.ctx, reason);
		expect(s.wrapperFactories).toHaveLength(2);
		expect(s.listeners).toHaveLength(1);
	});

	it("re-reads configuration on the next generation", async () => {
		const pi = FakePi.register(GOOD_SETTINGS);
		const s = makeCtx({ focused: EDITOR });
		await pi.start(s.ctx);
		await pi.shutdown(s.ctx);

		pi.settings = snippetSettings({ a: "CHANGED" });
		await pi.start(s.ctx, "reload");
		expect(pi.input("%a").text).toBe("CHANGED");
		expect(pi.input("%use-mcp").action).toBe("continue");
	});

	it("drops a shortcut removed from settings on reload", async () => {
		const pi = FakePi.register(GOOD_SETTINGS);
		const s = makeCtx({ focused: EDITOR });
		await pi.start(s.ctx);
		await pi.shutdown(s.ctx);
		s.listeners.length = 0; // the fake keeps the old array; emulate Pi's cleared list

		pi.settings = snippetSettings({ a: "AAA" });
		await pi.start(s.ctx, "reload");
		expect(s.listeners).toHaveLength(0);
	});
});

describe("session_shutdown", () => {
	it("unsubscribes the listener and removes the capture widget", async () => {
		const pi = FakePi.register(GOOD_SETTINGS);
		const s = makeCtx({ focused: EDITOR });
		await pi.start(s.ctx);
		await pi.shutdown(s.ctx, "quit");
		expect(s.listeners).toHaveLength(0);
		expect(s.widgets.size).toBe(0);
	});

	it("resets configuration so an idle runtime holds no snippets", async () => {
		const pi = FakePi.register(GOOD_SETTINGS);
		const s = makeCtx({ focused: EDITOR });
		await pi.start(s.ctx);
		await pi.shutdown(s.ctx, "new");
		expect(pi.input("%use-mcp")).toStrictEqual({ action: "continue" });
	});

	it("is idempotent across converging shutdown reasons", async () => {
		const pi = FakePi.register(GOOD_SETTINGS);
		const s = makeCtx({ focused: EDITOR });
		await pi.start(s.ctx);
		await pi.shutdown(s.ctx, "reload");
		await pi.shutdown(s.ctx, "quit");
		await pi.shutdown(s.ctx, "new");
		expect(s.listeners).toHaveLength(0);
		expect(s.widgets.size).toBe(0);
	});

	it("does not touch the widget outside TUI mode", async () => {
		const pi = FakePi.register(GOOD_SETTINGS);
		const s = makeCtx({ mode: "print" });
		await pi.start(s.ctx);
		await pi.shutdown(s.ctx, "quit");
		expect(s.widgets.size).toBe(0);
	});
});

describe("non-TUI modes", () => {
	it.each(["print", "json", "rpc"])("expands without registering any TUI surface (%s)", async (mode) => {
		const pi = FakePi.register(GOOD_SETTINGS);
		const s = makeCtx({ mode });
		await pi.start(s.ctx);
		expect(s.wrapperFactories).toHaveLength(0);
		expect(s.listeners).toHaveLength(0);
		expect(s.widgets.size).toBe(0);
		expect(s.notices).toHaveLength(0);
		expect(pi.input("%use-mcp").text).toBe(VALUE);
	});
});

describe("the provider factory chain Pi builds", () => {
	it("wraps the provider Pi hands it and keeps the chain's own behavior", async () => {
		const pi = FakePi.register(GOOD_SETTINGS);
		const previous = makePrevious();
		const s = makeCtx({ previous });
		await pi.start(s.ctx);

		// Pi calls every registered factory with the previous chain link, in order.
		const factory = s.wrapperFactories[0]!;
		const wrapped = factory(previous as unknown as AutocompleteProvider);
		expect(wrapped.triggerCharacters).toStrictEqual(["%"]);

		// A second generation's factory produces an independent wrapper instance.
		await pi.shutdown(s.ctx);
		await pi.start(s.ctx, "resume");
		const second = s.wrapperFactories[1]!(previous as unknown as AutocompleteProvider);
		expect(second).not.toBe(wrapped);
	});
});
