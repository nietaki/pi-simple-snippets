/**
 * Marker expansion through the real `input` handler: boundaries, the name rule,
 * escaping, non-recursion, and the unknown-marker fallbacks.
 *
 * Every case drives a print-mode session so expansion is tested independently of
 * any TUI registration; the `images` passthrough rides along.
 *
 * Contract: docs/behavior.md ("Marker expansion")
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { FakePi, VALUE, makeCtx, snippetSettings } from "./harness.ts";

/** Start a print-mode session with `snippets` configured and expand `text`. */
async function expand(text: string, snippets: Record<string, string>, images?: unknown) {
	const pi = FakePi.register(snippetSettings(snippets));
	await pi.start(makeCtx({ mode: "print" }).ctx as unknown as ExtensionContext);
	return pi.input(text, images);
}

/** A prompt that expands must change; return its transformed text. */
const expandsTo = async (text: string, snippets: Record<string, string>, expected: string) => {
	const result = await expand(text, snippets);
	expect(result, JSON.stringify(text)).toEqual({ action: "transform", text: expected, images: undefined });
};

/** A prompt that must reach the model exactly as typed. */
const staysLiteral = async (text: string, snippets: Record<string, string>) => {
	expect(await expand(text, snippets), JSON.stringify(text)).toEqual({ action: "continue" });
};

const SNIPPETS = {
	"use-mcp": VALUE,
	a: "AAA",
	b: "BBB",
	"x.y": "DOT",
	"x-y": "HYPHEN",
	"x_y": "UNDER",
	"0start": "ZERO",
	rec: "see %use-mcp",
};

describe("expansion: the happy path", () => {
	const cases: Array<[string, string]> = [
		["%use-mcp", VALUE],
		["Please %use-mcp now", `Please ${VALUE} now`],
		["%a and %b", "AAA and BBB"],
		["%a %b %a", "AAA BBB AAA"],
		["line one\n%use-mcp\nline three", `line one\n${VALUE}\nline three`],
		["tab\t%a\there", "tab\tAAA\there"],
		["trailing %a", "trailing AAA"],
		["%a is short", "AAA is short"],
	];

	for (const [input, expected] of cases) {
		it(`expands ${JSON.stringify(input)}`, async () => {
			await expandsTo(input, SNIPPETS, expected);
		});
	}
});

describe("expansion: the boundary rule", () => {
	const ONE = { "use-mcp": VALUE };

	// start of prompt, start of line, any whitespace, CJK punctuation, and any
	// number of opening wrappers between the boundary and the marker.
	const expands: Array<[string, string]> = [
		["(%use-mcp)", `(${VALUE})`],
		["[[%use-mcp]]", `[[${VALUE}]]`],
		["{%use-mcp}", `{${VALUE}}`],
		["<%use-mcp>", `<${VALUE}>`],
		["`%use-mcp`", "`" + VALUE + "`"],
		["([`%use-mcp`])", "([`" + VALUE + "`])"],
		["，%use-mcp", `，${VALUE}`],
		["。%use-mcp", `。${VALUE}`],
		["；%use-mcp", `；${VALUE}`],
		["：%use-mcp", `：${VALUE}`],
		["！%use-mcp", `！${VALUE}`],
		["（%use-mcp）", `（${VALUE}）`],
		["Check (%use-mcp) please", `Check (${VALUE}) please`],
		["line\n%use-mcp", `line\n${VALUE}`],
		["100 %use-mcp?", `100 ${VALUE}?`], // a plain space is a boundary
		["%use-mcp", VALUE],
	];

	// Word characters, digits, and ASCII punctuation are not separators: the boundary
	// rule accepts only whitespace and CJK-script punctuation (plus wrappers between
	// boundary and marker).
	const stays: string[] = [
		"x%use-mcp",
		"5%use-mcp",
		"-%use-mcp",
		",%use-mcp",
		":%use-mcp",
		"'%use-mcp'",
		"\"%use-mcp\"",
		"（x%use-mcp",
	];

	for (const [input, expected] of expands) {
		it(`expands ${JSON.stringify(input)}`, async () => {
			await expandsTo(input, ONE, expected);
		});
	}

	for (const input of stays) {
		it(`leaves ${JSON.stringify(input)} untouched`, async () => {
			await staysLiteral(input, ONE);
		});
	}

	it("the second marker on a line is bounded by the first expansion's separator only if typed there", async () => {
		// `%use-mcp%use-mcp`: the second `%` follows a letter, so it is not a boundary.
		await expandsTo("%use-mcp%use-mcp", ONE, `${VALUE}%use-mcp`);
	});
});

describe("expansion: the name rule", () => {
	it("ends a name on an alphanumeric and re-emits trailing punctuation", async () => {
		const ONE = { "use-mcp": VALUE };
		await expandsTo("Please %use-mcp.", ONE, `Please ${VALUE}.`);
		await expandsTo("%use-mcp...", ONE, `${VALUE}...`);
		await expandsTo("%use-mcp, ok", ONE, `${VALUE}, ok`);
		await expandsTo("%a-", { a: "AAA" }, "AAA-");
		await expandsTo("%a_.", { a: "AAA" }, "AAA_.");
	});

	it("never shortens a longer unknown run to a known prefix", async () => {
		const ONE = { "use-mcp": VALUE };
		await staysLiteral("%use-mcpx", ONE);
		await staysLiteral("%use-mcpx.", ONE);
	});

	it("accepts dots, hyphens, and underscores inside names", async () => {
		await expandsTo("%x.y", { "x.y": "DOT" }, "DOT");
		await expandsTo("%x-y", { "x-y": "HYPHEN" }, "HYPHEN");
		await expandsTo("%x_y", { "x_y": "UNDER" }, "UNDER");
		await expandsTo("%0start", { "0start": "ZERO" }, "ZERO");
	});

	it("rejects names that start on punctuation", async () => {
		await staysLiteral("%.use", { use: "V" });
		await staysLiteral("%-use", { use: "V" });
	});

	it("is lowercase-only", async () => {
		await staysLiteral("%Use-MCP", { "use-mcp": VALUE });
	});

	it("is a single left-to-right pass with no recursion", async () => {
		await expandsTo("%rec", SNIPPETS, "see %use-mcp");
	});

	it("a value equal to its own marker yields no change, so the prompt continues", async () => {
		// `%a` with a = "%a": the one pass inserts the value literally; the text is
		// identical, so the handler reports `continue` rather than a no-op transform.
		await staysLiteral("%a %a", { a: "%a" });
	});

	it("expands every known marker in one pass", async () => {
		await expandsTo("%a, %b, and %use-mcp", SNIPPETS, `AAA, BBB, and ${VALUE}`);
	});
});

describe("expansion: escaping", () => {
	const ONE = { "use-mcp": VALUE };

	it("%%name yields the literal %name", async () => {
		await expandsTo("%%use-mcp", ONE, "%use-mcp");
		await expandsTo("say %%use-mcp loudly", ONE, "say %use-mcp loudly");
	});

	it("escapes inside the wrapper shape too", async () => {
		await expandsTo("(%%use-mcp)", ONE, "(%use-mcp)");
	});

	it("escapes an unknown name as well", async () => {
		await expandsTo("%%nope", ONE, "%nope");
	});

	it("does not escape bare %% or malformed shapes", async () => {
		await staysLiteral("100 %%", ONE);
		await staysLiteral("%%%use-mcp", ONE);
		await staysLiteral("%%Use-mcp", ONE);
	});
});

describe("expansion: unknown markers and short-circuits", () => {
	it("leaves unknown markers unchanged", async () => {
		await staysLiteral("%unknown", { a: "AAA" });
	});

	it("treats git format and SQL percents as unknown markers", async () => {
		await staysLiteral("git log --format=%h", { a: "AAA" });
		await staysLiteral("LIKE '%' ESCAPE", { a: "AAA" });
	});

	it("skips work when no snippets are configured", async () => {
		await staysLiteral("%a", {});
	});

	it("skips work when the prompt holds no %", async () => {
		expect(await expand("nothing here", { a: "AAA" })).toEqual({ action: "continue" });
	});

	it("passes attached images through a transform", async () => {
		const images = [{ type: "image", data: "Zm9v", mimeType: "image/png" }];
		expect(await expand("%a", { a: "AAA" }, images)).toEqual({ action: "transform", text: "AAA", images });
	});

	it("does not expand a marker glued to the end of a word", async () => {
		await staysLiteral("path%a", { a: "AAA" });
	});

	it("expands a printf-shaped marker after a real space (documented trade-off)", async () => {
		await expandsTo("printf %a now", { a: "AAA" }, "printf AAA now");
	});
});
