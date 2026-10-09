/**
 * Compatibility canary.
 *
 * Three Pi behaviors are mirrored rather than imported, because pi-tui does not
 * re-export them from its package root, and each one silently breaks completion or the
 * shortcut guard when Pi changes:
 *
 * 1. the marker boundary rule, mirrored into `src/index.ts`;
 * 2. the editor method fingerprint that separates Pi's editor from its selectors;
 * 3. `resetExtensionUI()` clearing extension autocomplete wrappers and terminal-input
 *    listeners, which is why registration happens per session-start generation.
 *
 * Part 1 pins pi-tui 1.1.0's own pattern sources and compares them against the
 * installed package, then checks the extension behaves the same way as those live
 * regexes on a boundary corpus. Parts 2 and 3 check the structural assumptions against
 * the installed sources. All of it is expected to start failing on a Pi upgrade — that
 * is the canary working: re-verify the assumptions and update the mirror deliberately,
 * never by deleting the test.
 *
 * Verified against `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` 1.1.0.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	autocompleteBoundaryRegex,
	autocompleteSeparatorRegex,
	cjkBreakRegex,
	cjkPunctuationRegex,
} from "@earendil-works/pi-tui/dist/utils.js";
import { describe, expect, it } from "vitest";

import { EDITOR, FakePi, SELECTOR, VALUE, ask, makeCtx, makePrevious, snippetSettings } from "./harness.ts";

/**
 * Read a file from an installed package by its path inside the package.
 *
 * Both Pi packages are ESM-only and `@earendil-works/pi-coding-agent` restricts subpath
 * exports, so the root is found by resolving the package entry and walking up to the
 * `package.json` that names it. These reads are the canary: they inspect the *installed*
 * Pi, not this package's own behavior.
 */
function packageFile(packageName: string, relativePath: string): string {
	const entry = fileURLToPath(import.meta.resolve(packageName));
	let directory = dirname(entry);
	for (;;) {
		const manifest = join(directory, "package.json");
		if (existsSync(manifest) && readFileSync(manifest, "utf8").includes(`"name": "${packageName}"`)) break;
		const parent = dirname(directory);
		if (parent === directory) throw new Error(`could not locate the root of ${packageName}`);
		directory = parent;
	}
	return readFileSync(join(directory, relativePath), "utf8");
}

// pi-tui 1.1.0 `dist/utils.js` pattern sources, copied from the live package, and
// `dist/components/editor.js`'s wrapper class. These strings are what `src/index.ts`
// mirrors; a change here means the mirror is now stale.
const PINNED = {
	cjkBreak: String.raw`[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Bopomofo}]`,
	punctuationTail: String.raw`|[，．：；！？（）［］｛｝“”‘’…—]`,
	punctuationHead: String.raw`(?:(?=\p{Punctuation})`,
	separatorHead: String.raw`(?:\s|`,
	boundaryHead: String.raw`(?:^|`,
	wrappers: "[([{<`]",
} as const;

describe("1. pi-tui's live pattern sources still match the pinned mirror", () => {
	it("the CJK break class is unchanged", () => {
		expect(cjkBreakRegex.source).toBe(PINNED.cjkBreak);
	});

	it("the CJK punctuation class is unchanged", () => {
		expect(cjkPunctuationRegex.source.startsWith(PINNED.punctuationHead)).toBe(true);
		expect(cjkPunctuationRegex.source).toContain(PINNED.punctuationTail);
		expect(cjkPunctuationRegex.source).toBe(`${PINNED.punctuationHead}${PINNED.cjkBreak}${PINNED.punctuationTail})`);
	});

	it("the separator is still whitespace or CJK punctuation", () => {
		expect(autocompleteSeparatorRegex.source).toBe(
			`${PINNED.separatorHead}${cjkPunctuationRegex.source})`,
		);
	});

	it("the boundary is still start-or-separator", () => {
		expect(autocompleteBoundaryRegex.source).toBe(`${PINNED.boundaryHead}${autocompleteSeparatorRegex.source})`);
	});

	it("the editor still wraps tokens in the pinned opening-wrapper class", () => {
		// pi-tui 1.1.0 dist/components/editor.js:174 builds the token start as
		// `${autocompleteBoundaryRegex.source}[([{<\`]*`.
		expect(packageFile("@earendil-works/pi-tui", "dist/components/editor.js")).toContain("[([{<\\`]*");
	});
});

describe("2. the extension agrees with Pi's live popup trigger on the boundary corpus", () => {
	// Pi's own trigger pattern for a `%` trigger, rebuilt from the live pi-tui regex
	// sources the way `buildTriggerPattern()` assembles it (editor.js:174-179).
	const suffix = `(?:(?!${autocompleteSeparatorRegex.source}).)*`;
	const tokenStart = `${autocompleteBoundaryRegex.source}${PINNED.wrappers}*`;
	const piOpensPercentPopup = (beforeCursor: string): boolean =>
		new RegExp(`${tokenStart}(?:@"[^"]*|[%]${suffix})$`, "u").test(beforeCursor);

	const prefixes = [
		"", // start of line
		" ",
		"\t",
		"\n",
		"word ",
		"((",
		"[",
		"{",
		"<",
		"`",
		"([`",
		"，",
		"。",
		"；",
		"：",
		"！",
		"）",
		"中文",
		"100 ",
		"(%",
		// non-boundaries: the popup must not open, and expansion must not fire
		"word",
		"x",
		"5",
		"-",
		",",
		":",
		"'",
		'"',
	];

	for (const prefix of prefixes) {
		it(`both paths decide ${JSON.stringify(prefix)}%use-mcp the same way Pi does`, async () => {
			const line = `${prefix}%use-mcp`;
			const col = line.length;
			const piOpens = piOpensPercentPopup(line.slice(0, col));

			// Submission path: does the input handler expand the marker here?
			const submit = FakePi.register(snippetSettings({ "use-mcp": VALUE }));
			await submit.start(makeCtx({ mode: "print" }).ctx);
			const expands = submit.input(line).action === "transform";

			// Completion path: does the provider claim the token, or delegate?
			const completionCtx = makeCtx({ previous: makePrevious() });
			const completion = FakePi.register(snippetSettings({ "use-mcp": VALUE }));
			await completion.start(completionCtx.ctx);
			const suggestion = (await ask(completionCtx.provider()!, line, col))!;
			const claimsToken = suggestion.prefix.startsWith("%");

			// Where the extension acts, Pi must have opened the popup. The reverse is not
			// required and is deliberately asymmetric: Pi opens the popup for any
			// non-separator suffix (`%foo,bar`, `%%escaped`), while the name rule refuses
			// those, so `expands` and `claimsToken` each imply `piOpens` and never the
			// other way round.
			if (expands) expect(piOpens, `${JSON.stringify(prefix)}: expanded but Pi would not open`).toBe(true);
			if (claimsToken) expect(piOpens, `${JSON.stringify(prefix)}: claimed but Pi would not open`).toBe(true);
		});
	}

	it("a marker Pi would not open the popup for is never expanded", async () => {
		// The one direction the corpus cannot get wrong in isolation: a mid-word `%` is
		// neither a popup trigger nor a boundary.
		for (const prefix of ["word", "x", "5", "-", ",", ":", "'", '"']) {
			const line = `${prefix}%use-mcp`;
			expect(piOpensPercentPopup(line.slice(0, line.length)), prefix).toBe(false);

			const submit = FakePi.register(snippetSettings({ "use-mcp": VALUE }));
			await submit.start(makeCtx({ mode: "print" }).ctx);
			expect(submit.input(line).action, prefix).toBe("continue");

			const completionCtx = makeCtx({ previous: makePrevious() });
			const completion = FakePi.register(snippetSettings({ "use-mcp": VALUE }));
			await completion.start(completionCtx.ctx);
			const suggestion = (await ask(completionCtx.provider()!, line, line.length))!;
			expect(suggestion.prefix.startsWith("%"), prefix).toBe(false);
		}
	});
});

describe("3. the editor method fingerprint still separates editor from selectors", () => {
	// The guard distinguishes Pi's editor by three public methods. If a release renames
	// them, `isEditorLike()` stops matching and the shortcut goes inert — no crash, no
	// warning, just a dead key.
	it("pi-tui's editor still exposes the fingerprinted methods", () => {
		const editor = packageFile("@earendil-works/pi-tui", "dist/components/editor.js");
		expect(editor).toContain("setAutocompleteProvider(");
		expect(editor).toContain("isShowingAutocomplete(");
		expect(editor).toContain("getText(");
	});

	it("pi-tui's selector components still lack the two autocomplete members", () => {
		for (const relative of ["dist/components/select-list.js", "dist/components/settings-list.js"]) {
			const component = packageFile("@earendil-works/pi-tui", relative);
			expect(component, relative).not.toContain("setAutocompleteProvider(");
			expect(component, relative).not.toContain("isShowingAutocomplete(");
		}
	});

	it("the fake editor and fake selector still differ by the same fingerprint", () => {
		const fingerprint = (component: unknown) => {
			const c = component as Record<string, unknown>;
			return (
				typeof c.getText === "function" &&
				typeof c.setAutocompleteProvider === "function" &&
				typeof c.isShowingAutocomplete === "function"
			);
		};
		expect(fingerprint(EDITOR)).toBe(true);
		expect(fingerprint(SELECTOR)).toBe(false);
	});
});

describe("4. the session UI reset the lifecycle depends on", () => {
	// Pi's `resetExtensionUI()` empties the autocomplete-wrapper list, the terminal-input
	// listener list, and extension widgets before every session transition and on
	// `/reload`. The extension re-registers on every `session_start` because of it. If a
	// release stopped clearing them, re-registration would duplicate instead of replace.
	const interactive = () =>
		packageFile("@earendil-works/pi-coding-agent", "dist/modes/interactive/interactive-mode.js");

	it("interactive mode still clears extension autocomplete wrappers on reset", () => {
		expect(interactive()).toContain("this.autocompleteProviderWrappers = []");
	});

	it("interactive mode still clears extension terminal-input listeners on reset", () => {
		expect(interactive()).toContain("this.clearExtensionTerminalInputListeners()");
	});

	it("interactive mode still clears extension widgets on reset", () => {
		// The maps are split by placement; the capture widget lives in the below-editor one.
		const text = interactive();
		expect(text).toContain("this.extensionWidgetsAbove.clear()");
		expect(text).toContain("this.extensionWidgetsBelow.clear()");
	});

	it("the reset is still wired before session invalidation", () => {
		expect(interactive()).toContain("setBeforeSessionInvalidate");
	});

	it("the concrete TUI still exposes getFocusedComponent while the exported interface does not", () => {
		// The shortcut reaches the member through a narrow structural view precisely because
		// the `TUI` interface lacks it. If a release adds it to the interface, the optional
		// member view can become a direct call — that is a simplification, not a breakage,
		// and this test is where it gets noticed.
		expect(packageFile("@earendil-works/pi-tui", "dist/tui.js")).toContain("getFocusedComponent()");
		const declaration = packageFile("@earendil-works/pi-tui", "dist/tui.d.ts");
		const start = declaration.indexOf("export interface TUI");
		const end = declaration.indexOf("export interface", start + 10);
		expect(declaration.slice(start, end)).not.toContain("getFocusedComponent");
	});
});
