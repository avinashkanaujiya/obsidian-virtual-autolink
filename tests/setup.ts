// ponytail: polyfill browser globals for Node test environment
export {};

// Delegate to globalThis so Jest fake timers can intercept
(globalThis as Record<string, unknown>).window = {
    get setTimeout() { return globalThis.setTimeout; },
    get clearTimeout() { return globalThis.clearTimeout; },
    get requestAnimationFrame() { return (cb: FrameRequestCallback) => globalThis.setTimeout(cb, 16); },
    get document() { return (globalThis as Record<string, unknown>).document ?? {}; },
};

// DOM class stubs expose Obsidian's cross-window-aware type check.
class StubHTMLElement {
    instanceOf(type: new (...args: never[]) => unknown): boolean {
        return this instanceof type;
    }
}
class StubHTMLAnchorElement extends StubHTMLElement {}
(globalThis as Record<string, unknown>).HTMLElement = StubHTMLElement;
(globalThis as Record<string, unknown>).HTMLAnchorElement = StubHTMLAnchorElement;

// Obsidian's global DOM helpers use whichever document a test installs.
function createTestElement(tag: keyof HTMLElementTagNameMap, options?: DomElementInfo | string): HTMLElement {
    const el = document.createElement(tag);
    const info = typeof options === 'string' ? { cls: options } : options;
    if (info?.cls) el.classList.add(...(Array.isArray(info.cls) ? info.cls : info.cls.split(' ')));
    if (typeof info?.text === 'string') el.textContent = info.text;
    if (info?.parent) info.parent.appendChild(el);
    return el;
}
(globalThis as Record<string, unknown>).createEl = createTestElement;
(globalThis as Record<string, unknown>).createDiv = (options?: DomElementInfo | string) => createTestElement('div', options);
(globalThis as Record<string, unknown>).createSpan = (options?: DomElementInfo | string) => createTestElement('span', options);
(globalThis as Record<string, unknown>).createFragment = () => document.createDocumentFragment();
