/**
 * The autocomplete wrapper: token recognition, the real fuzzy filter, previews,
 * the suggestion cap, delegation, completion application, and forced-completion
 * forwarding. Every case builds the provider the way Pi's editor setup does —
 * `factory(previous)` — so the delegation contract is exercised against a real
 * wrapped provider rather than a mock of our own logic.
 *
 * Contract: docs/behavior.md ("Autocomplete")
 */

import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import {
	EDITOR,
	FakePi,
	VALUE,
	GOOD_SETTINGS,
	ask,
	makeCtx,
	makePrevious,
	snippetSettings,
} from "./harness.ts";

const OPTIONS = { signal: new AbortController().signal };

/** Start with `snippets` and return the wrapped provider and its delegation record. */
async function boot(
	snippets: Record<string, string>,
	previous: AutocompleteProvider = makePrevious(),
	expandOnCompletion?: boolean,
) {
	const pi = FakePi.register(
		expandOnCompletion === undefined
			? snippetSettings(snippets)
			: { piSimpleSnippets: { snippets, expandOnCompletion } },
	);
	const s = makeCtx({ previous, focused: EDITOR });
	await pi.start(s.ctx);
	const p = s.provider();
	if (!p) throw new Error("expected a registered completion wrapper");
	return { pi, s, p, calls: (previous as ReturnType<typeof makePrevious>).calls };
}

const DEFAULT_SNIPPETS = { "use-mcp": VALUE, a: "AAA", b: "BBB" };

describe("trigger characters", () => {
	it("declares only % as its own, leaving @ and # to the editor defaults", async () => {
		const { p } = await boot({ a: "AAA" });
		expect(p.triggerCharacters).toStrictEqual(["%"]);
	});
});

describe("token recognition", () => {
	it("bare % lists every snippet in name order", async () => {
		const { p } = await boot(DEFAULT_SNIPPETS);
		expect(await ask(p, "%", 1)).toMatchObject({
			prefix: "%",
			items: [{ value: "%a" }, { value: "%b" }, { value: "%use-mcp" }],
		});
	});

	it("a partial name filters through the real fuzzy matcher", async () => {
		const { p } = await boot(DEFAULT_SNIPPETS);
		expect((await ask(p, "%use", 4))?.items.map((i) => i.value)).toStrictEqual(["%use-mcp"]);
		expect((await ask(p, "%mc", 3))?.items.map((i) => i.value)).toStrictEqual(["%use-mcp"]);
	});

	it("the description is the one-line snippet value", async () => {
		const { p } = await boot(DEFAULT_SNIPPETS);
		expect((await ask(p, "%use", 4))?.items[0]?.description).toBe(VALUE);
	});

	it("a snippet-shaped token with no match is ours, so file completion stays out", async () => {
		const { p, calls } = await boot(DEFAULT_SNIPPETS);
		expect(await ask(p, "%zz", 3)).toStrictEqual({ items: [], prefix: "%zz" });
		expect(calls).toStrictEqual([]);
	});

	it("a query ending on punctuation finds nothing but is still ours", async () => {
		const { p } = await boot(DEFAULT_SNIPPETS);
		expect(await ask(p, "%use-mcp.", 9)).toStrictEqual({ items: [], prefix: "%use-mcp." });
	});

	it("a % glued to a word is not a snippet token, so it delegates", async () => {
		const { p, calls } = await boot(DEFAULT_SNIPPETS);
		expect(await ask(p, "x%use", 5)).toMatchObject({ items: [{ value: "FILE" }] });
		expect(calls).toStrictEqual(["suggestions"]);
	});

	it("a token whose name starts on punctuation delegates", async () => {
		const { p, calls } = await boot(DEFAULT_SNIPPETS);
		expect(await ask(p, "%-.a", 4)).toMatchObject({ items: [{ value: "FILE" }] });
		expect(calls).toContain("suggestions");
	});

	it("wrapper and CJK positions the popup can open also complete", async () => {
		const { p } = await boot(DEFAULT_SNIPPETS);
		expect((await ask(p, "Check (%us", 12))?.prefix).toBe("%us");
		expect((await ask(p, "，%us", 4))?.prefix).toBe("%us");
	});

	it("reads only the cursor line, before the cursor", async () => {
		const { p } = await boot(DEFAULT_SNIPPETS);
		const result = await p.getSuggestions(["first line", "%us"], 1, 3, OPTIONS);
		expect(result).toMatchObject({ prefix: "%us", items: [{ value: "%use-mcp" }] });
	});

	it("clamps an out-of-range cursor column", async () => {
		const { p } = await boot(DEFAULT_SNIPPETS);
		expect((await ask(p, "%a", 99))?.prefix).toBe("%a");
	});

	it("an empty position at line start delegates", async () => {
		const { p, calls } = await boot(DEFAULT_SNIPPETS);
		await p.getSuggestions(["", ""], 1, 0, OPTIONS);
		expect(calls).toContain("suggestions");
	});

	it("a cursor line the editor no longer reports delegates instead of throwing", async () => {
		const { p, calls } = await boot(DEFAULT_SNIPPETS);
		await p.getSuggestions(["only line"], 4, 0, OPTIONS);
		expect(calls).toContain("suggestions");
	});

	it("keeps a snippet token to itself even after snippets are emptied mid-generation", async () => {
		// Defensive path: a wrapper Pi still holds, with configuration that no longer has
		// anything to offer. The token stays ours and the list stays empty, so unrelated
		// file completion cannot leak into a `%` popup.
		const { pi, p, calls } = await boot(DEFAULT_SNIPPETS);

		pi.settings = snippetSettings({});
		// A duplicate session_start inside one generation re-reads configuration without
		// re-registering, so the held wrapper now sees an empty snippet list.
		await pi.start(makeCtx().ctx, "startup");

		expect(await ask(p, "%use", 4)).toStrictEqual({ items: [], prefix: "%use" });
		expect(calls).toStrictEqual([]);
	});

	it("text before the marker that is not a boundary delegates", async () => {
		const { p, calls } = await boot(DEFAULT_SNIPPETS);
		await ask(p, "path%us", 7);
		expect(calls).toContain("suggestions");
	});
});

describe("previews and caps", () => {
	it("caps suggestions at 20", async () => {
		const many: Record<string, string> = {};
		for (let i = 0; i < 25; i++) many[`s${String(i).padStart(2, "0")}`] = `value ${i}`;
		const { p } = await boot(many);
		expect((await ask(p, "%", 1))?.items).toHaveLength(20);
	});

	it("collapses whitespace and bounds a long preview at 80 columns", async () => {
		const long = "line one\n  line   two\tand more ".repeat(12);
		const { p } = await boot({ long });
		const description = (await ask(p, "%", 1))?.items[0]?.description ?? "";
		expect(/[\n\t]/.test(description)).toBe(false);
		expect([...description].length).toBeLessThanOrEqual(80);
		expect(description.endsWith("…")).toBe(true);
	});

	it("keeps a short preview with only inner whitespace collapsed", async () => {
		const { p } = await boot({ s: "one  two" });
		expect((await ask(p, "%", 1))?.items[0]?.description).toBe("one two");
	});
});

describe("applyCompletion", () => {
	it("replaces only the active token and preserves the text after the cursor", async () => {
		const { p, calls } = await boot(DEFAULT_SNIPPETS);
		const suggestion = (await ask(p, "Check (%us more", 10))!;
		const result = p.applyCompletion(["Check (%us more"], 0, 10, suggestion.items[0], suggestion.prefix);
		expect(result).toStrictEqual({ lines: ["Check (%use-mcp more"], cursorLine: 0, cursorCol: 15 });
		expect(calls).toStrictEqual([]);
	});

	it("a foreign item is delegated untouched", async () => {
		const { p, calls } = await boot(DEFAULT_SNIPPETS);
		const result = p.applyCompletion(["@x"], 0, 2, { value: "FILE", label: "FILE" }, "@x");
		expect(calls).toContain("apply");
		expect(result).toStrictEqual({ lines: ["@x"], cursorLine: 0, cursorCol: 3 });
	});

	it("an item we never served is delegated", async () => {
		const { p, calls } = await boot(DEFAULT_SNIPPETS);
		p.applyCompletion(["elsewhere"], 0, 0, { value: "%a", label: "%a" }, "%a");
		expect(calls).toContain("apply");
	});

	it("a cursor line the editor no longer reports falls back to the wrapped provider", async () => {
		const { p, calls } = await boot(DEFAULT_SNIPPETS);
		const suggestion = (await ask(p, "%use", 4))!;
		p.applyCompletion(["one line"], 7, 4, suggestion.items[0], suggestion.prefix);
		expect(calls).toContain("apply");
	});

	it("a prefix that does not match the line delegates instead of corrupting it", async () => {
		const { p, calls } = await boot(DEFAULT_SNIPPETS);
		const suggestion = (await ask(p, "%a", 2))!;
		p.applyCompletion(["totally different"], 0, 2, suggestion.items[0], suggestion.prefix);
		expect(calls).toContain("apply");
	});

	it("a cursor left of the served prefix delegates rather than slicing backwards", async () => {
		const { p, calls } = await boot(DEFAULT_SNIPPETS);
		const suggestion = (await ask(p, "%use", 4))!;
		// A stale cursor two columns inside the token: `start` would be negative.
		p.applyCompletion(["%use"], 0, 2, suggestion.items[0], suggestion.prefix);
		expect(calls).toContain("apply");
	});

	it("applies on any line the editor reports, not only the first", async () => {
		const { p } = await boot(DEFAULT_SNIPPETS);
		const suggestion = (await ask(p, "%use", 4))!;
		const result = p.applyCompletion(["top", "say %use please"], 1, 8, suggestion.items[0], suggestion.prefix);
		expect(result).toStrictEqual({ lines: ["top", "say %use-mcp please"], cursorLine: 1, cursorCol: 12 });
	});
});

describe("expandOnCompletion", () => {
	/** Ask for `%query` at the end of `line`, then accept the first owned item. */
	async function accept(
		p: AutocompleteProvider,
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		index = 0,
	) {
		const suggestion = (await p.getSuggestions(lines, cursorLine, cursorCol, OPTIONS))!;
		return p.applyCompletion(lines, cursorLine, cursorCol, suggestion.items[index], suggestion.prefix);
	}

	it("is off by default, so accepting still inserts the marker", async () => {
		const { p } = await boot(DEFAULT_SNIPPETS);
		const result = await accept(p, ["Check %us end"], 0, 9);
		expect(result).toStrictEqual({ lines: ["Check %use-mcp end"], cursorLine: 0, cursorCol: 14 });
	});

	it("inserts the marker exactly as before when configured false", async () => {
		const { p } = await boot(DEFAULT_SNIPPETS, makePrevious(), false);
		const result = await accept(p, ["Check %us end"], 0, 9);
		expect(result).toStrictEqual({ lines: ["Check %use-mcp end"], cursorLine: 0, cursorCol: 14 });
	});

	it("inserts the configured value when enabled, preserving the text after the cursor", async () => {
		const { p } = await boot(DEFAULT_SNIPPETS, makePrevious(), true);
		const result = await accept(p, ["Check %us end"], 0, 9);
		expect(result).toStrictEqual({
			lines: [`Check ${VALUE} end`],
			cursorLine: 0,
			cursorCol: 6 + VALUE.length,
		});
	});

	it("keeps suggestion values, labels, and previews on the marker", async () => {
		const { p } = await boot(DEFAULT_SNIPPETS, makePrevious(), true);
		const suggestion = (await ask(p, "%use", 4))!;
		expect(suggestion).toMatchObject({
			prefix: "%use",
			items: [{ value: "%use-mcp", label: "%use-mcp", description: VALUE }],
		});
	});

	it("keeps token wrappers and the text before them untouched", async () => {
		const { p } = await boot({ s: "SS" }, makePrevious(), true);
		const result = await accept(p, ["Lead (%s trail"], 0, 8);
		expect(result).toStrictEqual({ lines: ["Lead (SS trail"], cursorLine: 0, cursorCol: 8 });
	});

	it("applies on any logical editor line, not only the first", async () => {
		const { p } = await boot({ s: "SS" }, makePrevious(), true);
		const result = await accept(p, ["top", "say %s please", "bottom"], 1, 6);
		expect(result).toStrictEqual({
			lines: ["top", "say SS please", "bottom"],
			cursorLine: 1,
			cursorCol: 6,
		});
	});

	it("splits a multiline value across lines and lands the cursor after it", async () => {
		const { p } = await boot({ multi: "one\ntwo\nthree" }, makePrevious(), true);
		const result = await accept(p, ["lead %mu trail", "next line"], 0, 8);
		expect(result).toStrictEqual({
			lines: ["lead one", "two", "three trail", "next line"],
			cursorLine: 2,
			cursorCol: 5,
		});
	});

	it("normalizes CRLF and CR to logical newlines", async () => {
		const { p } = await boot({ crlf: "a\r\nb\rc" }, makePrevious(), true);
		expect(await accept(p, ["%crlf"], 0, 5)).toStrictEqual({
			lines: ["a", "b", "c"],
			cursorLine: 2,
			cursorCol: 1,
		});
		const { p: cr } = await boot({ lone: "a\rb" }, makePrevious(), true);
		expect(await accept(cr, ["%lone"], 0, 5)).toStrictEqual({
			lines: ["a", "b"],
			cursorLine: 1,
			cursorCol: 1,
		});
	});

	it("a value ending in a newline leaves the tail on the last inserted line", async () => {
		const { p } = await boot({ tail: "x\n" }, makePrevious(), true);
		expect(await accept(p, ["%tail rest"], 0, 5)).toStrictEqual({
			lines: ["x", " rest"],
			cursorLine: 1,
			cursorCol: 0,
		});
	});

	it("keeps tabs and spaces as written, matching the submission pass", async () => {
		// Pi's editor turns a *typed or pasted* tab into four spaces, but completion is not
		// typing: the value is inserted as configured so the same snippet expands to the same
		// text on submit. Only line endings are normalized.
		const { p } = await boot({ tabbed: "a\tb  c" }, makePrevious(), true);
		expect(await accept(p, ["%tabbed"], 0, 7)).toStrictEqual({
			lines: ["a\tb  c"],
			cursorLine: 0,
			cursorCol: 6,
		});
	});

	it("a value that starts or ends on a blank line keeps both lines", async () => {
		const { p } = await boot({ pad: "\nmiddle\n" }, makePrevious(), true);
		expect(await accept(p, ["a %pad b"], 0, 6)).toStrictEqual({
			lines: ["a ", "middle", " b"],
			cursorLine: 2,
			cursorCol: 0,
		});
	});

	it("a marker-shaped value is inserted literally and stays ordinary text", async () => {
		const pi = FakePi.register({
			piSimpleSnippets: { snippets: { outer: "Run %inner carefully", inner: "INNER" }, expandOnCompletion: true },
		});
		const s = makeCtx({ previous: makePrevious(), focused: EDITOR });
		await pi.start(s.ctx);
		const p = s.provider()!;
		const result = await accept(p, ["%outer"], 0, 6);
		expect(result).toStrictEqual({ lines: ["Run %inner carefully"], cursorLine: 0, cursorCol: 20 });
		// The separate submission pass sees it as normal editor text.
		expect(pi.input("Run %inner carefully").text).toBe("Run INNER carefully");
	});

	it("a served item whose snippet was removed delegates instead of inserting nothing", async () => {
		const previous = makePrevious();
		const { pi, s, p, calls } = await boot(DEFAULT_SNIPPETS, previous, true);
		const suggestion = (await ask(p, "%use", 4))!;

		pi.settings = { piSimpleSnippets: { snippets: { a: "AAA" }, expandOnCompletion: true } };
		await pi.start(s.ctx, "reload");

		expect(p.applyCompletion(["say %use"], 0, 8, suggestion.items[0], suggestion.prefix)).toStrictEqual({
			lines: ["say %use"],
			cursorLine: 0,
			cursorCol: 9,
		});
		expect(calls).toContain("apply");
	});

	it("foreign and unserved items still delegate with the setting enabled", async () => {
		const { p, calls } = await boot(DEFAULT_SNIPPETS, makePrevious(), true);
		p.applyCompletion(["@x"], 0, 2, { value: "FILE", label: "FILE" }, "@x");
		p.applyCompletion(["elsewhere"], 0, 0, { value: "%a", label: "%a" }, "%a");
		expect(calls.filter((c) => c === "apply")).toHaveLength(2);
	});
});

describe("forced completion", () => {
	it("forwards the wrapped provider's refusal", async () => {
		const previous = makePrevious({ fileCompletionAnswer: false });
		const { p, calls } = await boot(DEFAULT_SNIPPETS, previous);
		expect(p.shouldTriggerFileCompletion!(["%a"], 0, 2)).toBe(false);
		expect(calls).toContain("shouldTrigger");
	});

	it("defaults to true when the wrapped provider has no opinion", async () => {
		const bare: AutocompleteProvider = {
			triggerCharacters: [],
			async getSuggestions() {
				return null;
			},
			applyCompletion(lines, _l, c) {
				return { lines, cursorLine: _l, cursorCol: c };
			},
		};
		const { p } = await boot(DEFAULT_SNIPPETS, bare);
		expect(p.shouldTriggerFileCompletion!(["x"], 0, 1)).toBe(true);
	});

	it("a null delegation passes straight through", async () => {
		const bare: AutocompleteProvider = {
			triggerCharacters: [],
			async getSuggestions() {
				return null;
			},
			applyCompletion(lines, _l, c) {
				return { lines, cursorLine: _l, cursorCol: c };
			},
		};
		const { p } = await boot(DEFAULT_SNIPPETS, bare);
		expect(await p.getSuggestions(["hello"], 0, 5, OPTIONS)).toBeNull();
	});
});

describe("the provider sees live configuration", () => {
	it("a snippet added by a reload is offered without re-registration", async () => {
		const pi = FakePi.register(GOOD_SETTINGS);
		const s = makeCtx({ previous: makePrevious(), focused: EDITOR });
		await pi.start(s.ctx);
		const p = s.provider()!;
		expect((await ask(p, "%new", 4))?.items).toHaveLength(0);

		pi.settings = snippetSettings({ new: "NEW" });
		await pi.start(s.ctx, "reload");
		expect((await ask(p, "%new", 4))?.items.map((i) => i.value)).toStrictEqual(["%new"]);
	});
});
