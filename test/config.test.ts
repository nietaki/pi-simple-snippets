/**
 * Configuration reading and validation: partial acceptance of malformed entries,
 * the summarized warning surface, deterministic popup order, and shortcut normalization.
 *
 * Contract: docs/behavior.md ("Configuration")
 */

import { describe, expect, it } from "vitest";

import { FakePi, VALUE, GOOD_SETTINGS, makeCtx, snippetSettings } from "./harness.ts";

/** Register, start a session with `settings`, and return the extension plus its ctx. */
async function boot(settings: Record<string, unknown>, ctxOpts = {}) {
	const pi = FakePi.register(settings);
	const s = makeCtx(ctxOpts);
	await pi.start(s.ctx);
	return { pi, s };
}

describe("a well-formed namespace", () => {
	it("registers the completion wrapper, the shortcut listener, and the capture widget", async () => {
		const { s } = await boot(GOOD_SETTINGS, { focused: null });
		expect(s.wrapperFactories).toHaveLength(1);
		expect(s.listeners).toHaveLength(1);
		expect(s.notices).toHaveLength(0);
		expect(s.widgets.get("pi-simple-snippets")?.options).toStrictEqual({ placement: "belowEditor" });
		expect(s.widgets.get("pi-simple-snippets")?.component.render(80)).toStrictEqual([]);
		// `Component.invalidate()` is required by pi-tui; the capture widget must keep
		// answering it without throwing when Pi repaints on resize or theme change.
		expect(() => s.widgets.get("pi-simple-snippets")?.component.invalidate()).not.toThrow();
	});

	it("expands a configured marker", async () => {
		const { pi } = await boot(GOOD_SETTINGS, { mode: "print" });
		expect(pi.input("%use-mcp").text).toBe(VALUE);
	});
});

describe("malformed snippet entries are skipped, the rest still work", () => {
	it("rejects names that cannot end a marker while accepting internal punctuation", async () => {
		const { pi, s } = await boot({
			"pi-simple-snippets": {
				snippets: { "foo-": "dash", "foo.": "period", "foo_": "underscore", "foo-bar": "valid" },
			},
		});

		expect(pi.input("%foo-bar").text).toBe("valid");
		for (const name of ["foo-", "foo.", "foo_"]) {
			expect(pi.input(`%${name}`).action).toBe("continue");
		}
		expect(s.notices).toHaveLength(1);
		for (const name of ["foo-", "foo.", "foo_"]) {
			expect(s.notices[0]).toContain(`${JSON.stringify(name)} (invalid name)`);
		}
		expect(s.notices[0]).toContain("ignored 3 snippet entries");
	});

	it("keeps valid entries and summarizes exactly the invalid ones", async () => {
		const { pi, s } = await boot({
			"pi-simple-snippets": {
				snippets: { Bad: "x", "ok-name": "Y", a: "", good: "G", "1num": "N", up: 42, deep: { k: "v" } },
			},
		});

		// Names may start on a digit; uppercase names are invalid, and values must be
		// non-empty strings.
		expect(pi.input("%good").text).toBe("G");
		expect(pi.input("%ok-name").text).toBe("Y");
		expect(pi.input("%1num").text).toBe("N");
		expect(pi.input("%Bad").action).toBe("continue");
		expect(pi.input("%up").action).toBe("continue");
		expect(s.notices).toHaveLength(1);

		const warning = s.notices[0];
		expect(warning.startsWith("warning:")).toBe(true);
		expect(warning).toContain('"Bad" (invalid name)');
		expect(warning).toContain('"a" (value must be a non-empty string)');
		expect(warning).toContain('"up" (value must be a non-empty string)');
		expect(warning).toContain('"deep" (value must be a non-empty string)');
		expect(warning).toContain("ignored 4 snippet entries");
		expect(warning).not.toContain("1num");
	});

	it("uses the singular form for one skipped entry", async () => {
		const { s } = await boot({ "pi-simple-snippets": { snippets: { Bad: "x", good: "G" } } });
		expect(s.notices[0]).toContain("ignored 1 snippet entry");
	});

	it("ignores the whole snippets table when it is not an object", async () => {
		const { pi, s } = await boot({ "pi-simple-snippets": { snippets: [1, 2], shortcut: "ctrl+%" } });
		expect(s.notices[0]).toContain("`snippets` must be an object of name to text");
		expect(pi.input("%a").action).toBe("continue");
		// The shortcut is still usable: fields are validated independently.
		expect(s.listeners).toHaveLength(1);
	});
});

describe("the namespace itself", () => {
	it("is silent when absent", async () => {
		const { pi, s } = await boot({ other: 1 });
		expect(s.notices).toHaveLength(0);
		expect(pi.input("%a").action).toBe("continue");
		expect(s.wrapperFactories).toHaveLength(0);
	});

	it("warns and registers nothing when it is not an object", async () => {
		const { pi, s } = await boot({ "pi-simple-snippets": "not-an-object" });
		expect(s.notices).toHaveLength(1);
		expect(s.notices[0]).toContain('"pi-simple-snippets" must be an object; ignoring the whole namespace');
		expect(pi.input("%a").action).toBe("continue");
		expect(s.wrapperFactories).toHaveLength(0);
		expect(s.listeners).toHaveLength(0);
	});

	it("registers nothing for an empty snippets object", async () => {
		const { s } = await boot(snippetSettings({}));
		expect(s.wrapperFactories).toHaveLength(0);
		expect(s.widgets.size).toBe(0);
		expect(s.listeners).toHaveLength(0);
	});

	it("registers no TUI surface when only snippets are configured", async () => {
		const { s } = await boot(snippetSettings({ a: "AAA" }));
		expect(s.wrapperFactories).toHaveLength(1);
		expect(s.widgets.size).toBe(0);
		expect(s.listeners).toHaveLength(0);
	});

	it("registers no completion wrapper when only a shortcut is configured", async () => {
		const { pi, s } = await boot({ "pi-simple-snippets": { shortcut: "ctrl+shift+s" } }, { focused: null });
		expect(s.listeners).toHaveLength(1);
		expect(s.wrapperFactories).toHaveLength(0);
		expect(pi.input("%a").action).toBe("continue");
	});
});

describe("shortcut validation", () => {
	const accepted: Array<[string, string]> = [
		["ctrl+shift+s", "ctrl+shift+s"],
		["CTRL+SHIFT+S", "ctrl+shift+s"],
		["  ctrl+shift+s  ", "ctrl+shift+s"],
		["alt+f5", "alt+f5"],
		["ctrl+enter", "ctrl+enter"],
		["ctrl+space", "ctrl+space"],
		["super+m", "super+m"],
		["ctrl+shift+alt+pagedown", "ctrl+shift+alt+pagedown"],
		["ctrl+%", "ctrl+%"],
	];

	const rejected: string[] = [
		"s", // bare printable key would swallow typing
		"enter", // bare named key
		"hyper+s", // unknown modifier
		"ctrl++s", // empty part
		"", // empty
		"ctrl+ctrl+s", // duplicate modifier
		"ctrl++", // empty parts
		"ctrl+shift+ss", // multi-character base that is not a named key
		"ctrl+shift+%s", // base must be single character or named
		"ctrl + shift + s", // only the whole string is trimmed, not each part
		"5", // digit alone
	];

	for (const [raw] of accepted) {
		it(`accepts ${JSON.stringify(raw)}`, async () => {
			const { s } = await boot({ "pi-simple-snippets": { shortcut: raw, snippets: { a: "AAA" } } }, { focused: null });
			expect(s.listeners).toHaveLength(1);
			expect(s.notices.filter((n) => n.includes("shortcut"))).toHaveLength(0);
		});
	}

	for (const raw of rejected) {
		it(`rejects ${JSON.stringify(raw)}`, async () => {
			const { s } = await boot({ "pi-simple-snippets": { shortcut: raw, snippets: { a: "AAA" } } }, { focused: null });
			expect(s.listeners).toHaveLength(0);
			expect(s.notices.filter((n) => n.includes("shortcut"))).toHaveLength(1);
		});
	}

	it("warns with the configured spelling and the rule", async () => {
		const { s } = await boot({ "pi-simple-snippets": { shortcut: "s", snippets: { a: "AAA" } } });
		expect(s.notices[0]).toContain('`shortcut` "s" needs "mod[+mod]+key" with at least one modifier; ignoring it');
	});

	it("warns when shortcut is not a string", async () => {
		const { s } = await boot({ "pi-simple-snippets": { shortcut: 7, snippets: { a: "AAA" } } });
		expect(s.notices[0]).toContain("`shortcut` must be a string");
	});
});

describe("warnings surface once, only in TUI mode", () => {
	it("summarizes several problems into one notification", async () => {
		const { s } = await boot({
			"pi-simple-snippets": { shortcut: "s", snippets: { Bad: "x" } },
		});
		expect(s.notices).toHaveLength(1);
		expect(s.notices[0]).toContain("; ");
	});

	it("does not notify outside the TUI", async () => {
		const { s } = await boot({ "pi-simple-snippets": { shortcut: "s", snippets: { Bad: "x" } } }, { mode: "print" });
		expect(s.notices).toHaveLength(0);
	});

	it("a bare printable shortcut never installs, so it cannot swallow typing", async () => {
		const { pi, s } = await boot({ "pi-simple-snippets": { shortcut: "%", snippets: { a: "AAA" } } }, { focused: null });
		expect(s.listeners).toHaveLength(0);
		expect(pi.input("%a").text).toBe("AAA");
	});
});
