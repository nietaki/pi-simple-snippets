/**
 * Shared fakes for driving the real extension entry point.
 *
 * `FakePi` implements only the two `ExtensionAPI` members the extension uses
 * (`on`, `getSettings`); the cast in `register()` exists because Pi's full API is far
 * larger than what an extension with no tools or commands touches. `makeCtx` implements
 * the slice of `ExtensionUIContext` this extension calls, and — like Pi's real
 * `setExtensionWidget` — invokes the widget factory synchronously with the fake TUI.
 *
 * Contract: docs/behavior.md
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";

import piSimpleSnippets from "../src/index.ts";

export const VALUE = "Use your MCP tools to find the information";

export const GOOD_SETTINGS = {
	"pi-simple-snippets": {
		shortcut: "ctrl+shift+s",
		snippets: { "use-mcp": VALUE, a: "AAA", b: "BBB" },
	},
};

export const snippetSettings = (snippets: Record<string, string>, shortcut?: string) => ({
	"pi-simple-snippets": shortcut === undefined ? { snippets } : { snippets, shortcut },
});

type Handler = (event: any, ctx: any) => unknown;

/** The extension's `on`/`getSettings` surface, plus the event dispatch Pi performs. */
export class FakePi {
	handlers = new Map<string, Array<(e: unknown, c: unknown) => unknown>>();
	settings: Record<string, unknown> = {};

	on(event: string, handler: (e: unknown, c: unknown) => unknown): () => void {
		if (!this.handlers.has(event)) this.handlers.set(event, []);
		this.handlers.get(event)!.push(handler);
		return () => {
			const list = this.handlers.get(event)!;
			const i = list.indexOf(handler);
			if (i >= 0) list.splice(i, 1);
		};
	}

	getSettings(): Record<string, unknown> {
		return this.settings;
	}

	/** The two `ExtensionAPI` members this extension uses, typed as the real interface. */
	asApi(): ExtensionAPI {
		return this as unknown as ExtensionAPI;
	}

	/** Register the extension and return the API with its handlers wired. */
	static register(settings: Record<string, unknown> = {}): FakePi {
		const pi = new FakePi();
		pi.settings = settings;
		piSimpleSnippets(pi.asApi());
		return pi;
	}

	async fire(event: string, payload: unknown, ctx: unknown): Promise<unknown[]> {
		const out: unknown[] = [];
		for (const h of [...(this.handlers.get(event) ?? [])]) out.push(await h(payload, ctx));
		return out;
	}

	async start(ctx: unknown, reason = "startup"): Promise<void> {
		await this.fire("session_start", { type: "session_start", reason }, ctx);
	}

	async shutdown(ctx: unknown, reason = "new"): Promise<void> {
		await this.fire("session_shutdown", { type: "session_shutdown", reason }, ctx);
	}

	/** One submitted prompt through the `input` handlers, Pi-style. */
	input(text: string, images?: unknown): any {
		const handler = this.handlers.get("input")?.[0];
		if (!handler) throw new Error("no input handler registered");
		return handler({ type: "input", text, source: "interactive", images }, {} as ExtensionContext);
	}

	get handlerCount(): number {
		return [...this.handlers.values()].reduce((n, list) => n + list.length, 0);
	}
}

export interface FakeEditor {
	render(): string[];
	invalidate(): void;
	getText(): string;
	handleInput(data: string): void;
	setAutocompleteProvider(provider: AutocompleteProvider): void;
	isShowingAutocomplete(): boolean;
}

/** Structural fingerprint of Pi's editor: exactly what the extension's guard checks. */
export const EDITOR: FakeEditor = {
	render: () => [],
	invalidate: () => {},
	getText: () => "",
	handleInput: () => {},
	setAutocompleteProvider: () => {},
	isShowingAutocomplete: () => false,
};

/** A Pi selector: has `getText` but no autocomplete members, like every real one. */
export const SELECTOR = {
	render: () => [],
	invalidate: () => {},
	getText: () => "",
	handleInput: () => {},
};

/** The delegation target a snippet provider wraps: records every delegated call. */
export function makePrevious(options: { fileCompletionAnswer?: boolean } = {}) {
	const calls: string[] = [];
	const provider = {
		triggerCharacters: ["@", "#"],
		calls,
		async getSuggestions() {
			calls.push("suggestions");
			return { items: [{ value: "FILE", label: "FILE" }], prefix: "@x" };
		},
		applyCompletion(lines: string[], _l: number, c: number) {
			calls.push("apply");
			return { lines, cursorLine: _l, cursorCol: c + 1 };
		},
		shouldTriggerFileCompletion() {
			calls.push("shouldTrigger");
			return options.fileCompletionAnswer !== false;
		},
	};
	return provider as typeof provider & AutocompleteProvider;
}

/** Ask the provider exactly as the editor does: whole line, cursor at `col`. */

export interface CtxOptions {
	mode?: string;
	focused?: unknown;
	overlay?: boolean;
	previous?: unknown;
	/** Replace the object handed to widget factories, e.g. one without focus access. */
	tui?: unknown;
}

/** A TUI slice: what `setWidget` hands over plus the two members the guard probes. */
export function makeCtx(opts: CtxOptions = {}) {
	const notices: string[] = [];
	const widgets = new Map<string, { component: any; options?: unknown }>();
	const listeners: Array<(data: string) => unknown> = [];
	const wrapperFactories: Array<(p: AutocompleteProvider) => AutocompleteProvider> = [];
	let focused: unknown = opts.focused === undefined ? null : opts.focused;
	let overlay = opts.overlay === true;
	const liveTui = {
		requestRender: () => {},
		hasOverlay: () => overlay,
		getFocusedComponent: () => focused,
	};
	// The shortcut guard holds on to whatever `setWidget` handed over, so focus changes
	// and overlay state must live on that one object, as they do on Pi's real TUI.
	const tui = (opts.tui ?? liveTui) as typeof liveTui;
	const ctx = {
		mode: opts.mode ?? "tui",
		ui: {
			notify: (message: string, kind?: string) => notices.push(`${kind}:${message}`),
			addAutocompleteProvider: (factory: (p: AutocompleteProvider) => AutocompleteProvider) => {
				wrapperFactories.push(factory);
			},
			setWidget: (key: string, content: unknown, options?: unknown) => {
				if (content === undefined) {
					widgets.delete(key);
					return;
				}
				widgets.set(key, { component: (content as any)(tui, {}), options });
			},
			onTerminalInput: (handler: (data: string) => unknown) => {
				listeners.push(handler);
				return () => {
					const i = listeners.indexOf(handler);
					if (i >= 0) listeners.splice(i, 1);
				};
			},
		},
	};
	return {
		ctx: ctx as unknown as ExtensionContext,
		tui,
		notices,
		widgets,
		listeners,
		wrapperFactories,
		/** Swap what the TUI reports as focused, like moving focus would. */
		setFocused(component: unknown) {
			focused = component;
		},
		setOverlay(value: boolean) {
			overlay = value;
		},
		/** Build the wrapped provider the way Pi's editor setup would. */
		provider(): AutocompleteProvider | undefined {
			if (wrapperFactories.length === 0) return undefined;
			const factory = wrapperFactories[wrapperFactories.length - 1]!;
			return factory((opts.previous ?? makePrevious()) as AutocompleteProvider);
		},
	};
}

/** Ask the provider exactly as the editor does: whole line, cursor at `col`. */
export function ask(
	provider: AutocompleteProvider,
	line: string,
	col: number,
): Promise<{ items: Array<{ value: string; label: string; description?: string }>; prefix: string } | null> {
	return provider.getSuggestions([line], 0, col, { signal: new AbortController().signal });
}
