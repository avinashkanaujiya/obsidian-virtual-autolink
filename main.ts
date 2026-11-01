import { App, EditorPosition, EventRef, Keymap, MarkdownView, Menu, Plugin, PluginSettingTab, Setting, TAbstractFile, TFile, TFolder } from 'obsidian';

import { GlossaryLinker } from './linker/readModeLinker';
import { liveLinkerPlugin } from './linker/liveLinker';
import { ExternalUpdateManager, LinkerCache } from 'linker/linkerCache';
import { LinkerMetaInfoFetcher, normalizeDirectorySetting } from 'linker/linkerInfo';
import { HighlightService, applyHighlightToDOM } from 'linker/highlightService';
import { HighlightView, HIGHLIGHT_VIEW_TYPE } from 'linker/highlightView';

export interface LinkerPluginSettings {
    advancedSettings: boolean;
    linkerActivated: boolean;
    suppressSuffixForSubWords: boolean;
    matchAnyPartsOfWords: boolean;
    matchEndOfWords: boolean;
    matchBeginningOfWords: boolean;
    includeAllFiles: boolean;
    linkerDirectories: string[];
    excludedDirectories: string[];
    excludedDirectoriesForLinking: string[];
    virtualLinkSuffix: string;
    virtualLinkAliasSuffix: string;
    useDefaultLinkStyleForConversion: boolean;
    defaultUseMarkdownLinks: boolean; // Otherwise wiki links
    defaultLinkFormat: 'shortest' | 'relative' | 'absolute';
    useMarkdownLinks: boolean;
    linkFormat: 'shortest' | 'relative' | 'absolute';
    applyDefaultLinkStyling: boolean;
    includeHeaders: boolean;
    matchCaseSensitive: boolean;
    capitalLetterProportionForAutomaticMatchCase: number;
    tagToIgnoreCase: string;
    tagToMatchCase: string;
    propertyNameToMatchCase: string;
    propertyNameToIgnoreCase: string;
    tagToExcludeFile: string;
    tagToIncludeFile: string;
    excludeLinksToOwnNote: boolean;
    fixIMEProblem: boolean;
    excludeLinksInCurrentLine: boolean;
    onlyLinkOnce: boolean;
    excludeLinksToRealLinkedFiles: boolean;
    includeAliases: boolean;
    customFrontmatterFields: string[];
    alwaysShowMultipleReferences: boolean;
    requireModifierForCandidateLinks: boolean;
    // wordBoundaryRegex: string;
    // conversionFormat
}

const DEFAULT_SETTINGS: LinkerPluginSettings = {
    advancedSettings: false,
    linkerActivated: true,
    matchAnyPartsOfWords: false,
    matchEndOfWords: true,
    matchBeginningOfWords: true,
    suppressSuffixForSubWords: false,
    includeAllFiles: true,
    linkerDirectories: ['Glossary'],
    excludedDirectories: [],
    excludedDirectoriesForLinking: [],
    virtualLinkSuffix: '🔗',
    virtualLinkAliasSuffix: '🔗',
    useMarkdownLinks: false,
    linkFormat: 'shortest',
    defaultUseMarkdownLinks: false,
    defaultLinkFormat: 'shortest',
    useDefaultLinkStyleForConversion: true,
    applyDefaultLinkStyling: true,
    includeHeaders: true,
    matchCaseSensitive: false,
    capitalLetterProportionForAutomaticMatchCase: 0.75,
    tagToIgnoreCase: 'linker-ignore-case',
    tagToMatchCase: 'linker-match-case',
    propertyNameToMatchCase: 'linker-match-case',
    propertyNameToIgnoreCase: 'linker-ignore-case',
    tagToExcludeFile: 'linker-exclude',
    tagToIncludeFile: 'linker-include',
    excludeLinksToOwnNote: true,
    fixIMEProblem: false,
    excludeLinksInCurrentLine: false,
    onlyLinkOnce: true,
    excludeLinksToRealLinkedFiles: true,
    includeAliases: true,
    customFrontmatterFields: [],
    alwaysShowMultipleReferences: false,
    requireModifierForCandidateLinks: true,
    // wordBoundaryRegex: '/[\t- !-/:-@\[-`{-~\p{Emoji_Presentation}\p{Extended_Pictographic}]/u',
};

function normalizeVaultPath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

function getVaultDirname(filePath: string): string {
    const normalized = normalizeVaultPath(filePath);
    const lastSlashIndex = normalized.lastIndexOf('/');
    return lastSlashIndex === -1 ? '' : normalized.slice(0, lastSlashIndex);
}

function getVaultBasename(filePath: string): string {
    const normalized = normalizeVaultPath(filePath);
    const lastSlashIndex = normalized.lastIndexOf('/');
    return lastSlashIndex === -1 ? normalized : normalized.slice(lastSlashIndex + 1);
}

function getRelativeDirectoryPath(sourceDir: string, targetDir: string): string {
    const sourceParts = sourceDir.length > 0 ? sourceDir.split('/') : [];
    const targetParts = targetDir.length > 0 ? targetDir.split('/') : [];

    let sharedIndex = 0;
    while (
        sharedIndex < sourceParts.length &&
        sharedIndex < targetParts.length &&
        sourceParts[sharedIndex] === targetParts[sharedIndex]
    ) {
        sharedIndex += 1;
    }

    const parentParts = sourceParts.slice(sharedIndex).map(() => '..');
    const childParts = targetParts.slice(sharedIndex);
    return [...parentParts, ...childParts].join('/');
}

export function buildRelativeVaultPath(sourceFilePath: string, targetFilePath: string): string {
    const sourceDir = getVaultDirname(sourceFilePath);
    const targetDir = getVaultDirname(targetFilePath);
    const targetBase = getVaultBasename(targetFilePath);
    const relativeDir = getRelativeDirectoryPath(sourceDir, targetDir);
    return relativeDir.length > 0 ? `${relativeDir}/${targetBase}` : targetBase;
}

export function normalizeFrontmatterTags(tags: unknown): string[] {
    if (typeof tags === 'string') {
        const normalizedTag = tags.trim();
        return normalizedTag.length > 0 ? [normalizedTag] : [];
    }

    if (!Array.isArray(tags)) {
        return [];
    }

    return tags
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);
}

function matchesFolderSetting(directorySetting: string, folder: TFolder): boolean {
    const normalizedSetting = normalizeDirectorySetting(directorySetting);
    return (
        normalizedSetting === normalizeDirectorySetting(folder.path) ||
        normalizedSetting === normalizeDirectorySetting(folder.name)
    );
}

function isMarkdownFileOrFolder(file: TAbstractFile): boolean {
    return file instanceof TFolder || (file instanceof TFile && file.extension === 'md');
}

type VirtualLinkTarget = {
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): void;
};

type ClosestCapableElement = {
    closest(selector: string): unknown;
    parentElement?: unknown;
};

type VirtualLinkHoverElement = {
    classList: {
        add(token: string): void;
        remove(token: string): void;
        contains(token: string): boolean;
    };
};

const OPEN_ALL_DELAY_MS = 200;
export const VIRTUAL_LINK_HOVER_DELAY_MS = 180;
const VIRTUAL_LINK_HOVER_ACTIVE_CLASS = 'virtual-link-hover-active';
// ponytail: number (browser setTimeout) not NodeJS.Timeout; @types/node pollutes global
const virtualLinkHoverTimers = new WeakMap<VirtualLinkHoverElement, number>();

function getClosestCapableElement(target: EventTarget | null): ClosestCapableElement | null {
    const candidate = target as unknown as ClosestCapableElement | null;
    if (candidate && typeof candidate.closest === 'function') {
        return candidate;
    }

    const parentElement = candidate?.parentElement;
    if (parentElement && typeof (parentElement as ClosestCapableElement).closest === 'function') {
        return parentElement as ClosestCapableElement;
    }

    return null;
}

function isVirtualLinkHoverElement(value: unknown): value is VirtualLinkHoverElement {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const classList = (value as VirtualLinkHoverElement).classList;
    return !!classList
        && typeof classList.add === 'function'
        && typeof classList.remove === 'function'
        && typeof classList.contains === 'function';
}

function resolveVirtualLinkHoverElement(target: EventTarget | null): VirtualLinkHoverElement | null {
    const element = getClosestCapableElement(target);
    if (!element) return null;

    const hoverElement = element.closest('.virtual-link-span');
    return isVirtualLinkHoverElement(hoverElement)
        ? hoverElement
        : null;
}

function clearVirtualLinkHoverTimer(element: VirtualLinkHoverElement): void {
    const timer = virtualLinkHoverTimers.get(element);
    if (timer == null) {
        return;
    }

    window.clearTimeout(timer);
    virtualLinkHoverTimers.delete(element);
}

function resolveVirtualLinkTarget(target: EventTarget | null): VirtualLinkTarget | null {
    const element = getClosestCapableElement(target);
    if (!element) return null;

    const openAllAction = element.closest('.virtual-link-open-all');
    if (openAllAction && typeof (openAllAction as VirtualLinkTarget).getAttribute === 'function') {
        return openAllAction as VirtualLinkTarget;
    }

    const directAnchor = element.closest('.virtual-link-a');
    if (directAnchor && typeof (directAnchor as VirtualLinkTarget).getAttribute === 'function') {
        return directAnchor as VirtualLinkTarget;
    }

    const widget = element.closest('.virtual-link-span') as { querySelector?(selector: string): unknown } | null;
    if (!widget || typeof widget.querySelector !== 'function') {
        return null;
    }

    const firstAnchor = widget.querySelector('.virtual-link-a');
    return firstAnchor && typeof (firstAnchor as VirtualLinkTarget).getAttribute === 'function'
        ? firstAnchor as VirtualLinkTarget
        : null;
}

function parseVirtualLinkPaths(rawPaths: string | null): string[] {
    if (!rawPaths) return [];

    try {
        const parsed: unknown = JSON.parse(rawPaths);
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed.filter((path): path is string => typeof path === 'string' && path.length > 0);
    } catch {
        return [];
    }
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

type MetadataCacheReadyAware = {
    // Present at runtime in Obsidian, but missing from the published typings.
    initialized?: boolean;
    on(name: 'resolved', callback: () => unknown, ctx?: unknown): unknown;
};

export function registerInitialMetadataCacheRefresh(
    metadataCache: MetadataCacheReadyAware,
    registerEvent: (eventRef: EventRef) => void,
    scheduleFullRefresh: () => void,
): void {
    let hasScheduledInitialRefresh = false;

    const scheduleOnce = () => {
        if (hasScheduledInitialRefresh) {
            return;
        }

        hasScheduledInitialRefresh = true;
        scheduleFullRefresh();
    };

    registerEvent(metadataCache.on('resolved', scheduleOnce) as EventRef);

    if (metadataCache.initialized === true) {
        scheduleOnce();
    }
}

export function handleVirtualLinkHoverEnterEvent(requireModifier: boolean, e: MouseEvent): void {
    if (requireModifier && !Keymap.isModEvent(e)) {
        // Gate closed: only block Page Preview for our own candidate links.
        // Other wiki links must continue to bubble so their previews work.
        if (resolveVirtualLinkHoverElement(e.target)) {
            // Stop the mouseover from reaching hover-driven previews (Obsidian's
            // Page Preview and similar) so no popup is shown. The browser's
            // native tooltip and CSS :hover are not affected because they are
            // driven by pointer position, not JS event propagation.
            e.stopPropagation();
        }
        return;
    }

    const hoverElement = resolveVirtualLinkHoverElement(e.target);
    if (!hoverElement) {
        return;
    }

    const previousHoverElement = resolveVirtualLinkHoverElement(e.relatedTarget);
    if (hoverElement === previousHoverElement) {
        return;
    }

    clearVirtualLinkHoverTimer(hoverElement);
    hoverElement.classList.remove(VIRTUAL_LINK_HOVER_ACTIVE_CLASS);

    const timer = window.setTimeout(() => {
        hoverElement.classList.add(VIRTUAL_LINK_HOVER_ACTIVE_CLASS);
        virtualLinkHoverTimers.delete(hoverElement);
    }, VIRTUAL_LINK_HOVER_DELAY_MS);

    virtualLinkHoverTimers.set(hoverElement, timer);
}

export function handleVirtualLinkHoverLeaveEvent(e: MouseEvent): void {
    const hoverElement = resolveVirtualLinkHoverElement(e.target);
    if (!hoverElement) {
        return;
    }

    const nextHoverElement = resolveVirtualLinkHoverElement(e.relatedTarget);
    if (hoverElement === nextHoverElement) {
        return;
    }

    clearVirtualLinkHoverTimer(hoverElement);
    hoverElement.classList.remove(VIRTUAL_LINK_HOVER_ACTIVE_CLASS);
}

export async function handleVirtualLinkClickEvent(
    app: App,
    highlightService: HighlightService,
    requireModifier: boolean,
    e: MouseEvent,
): Promise<void> {
    if (e.button !== 0) return;

    const target = resolveVirtualLinkTarget(e.target);
    if (!target) return;

    if (requireModifier && !Keymap.isModEvent(e)) {
        // Modifier gate is closed: stop the browser and Obsidian from following
        // the candidate link's href. Without this, the native <a> click still
        // navigates even though we never call app.workspace.openLinkText.
        e.preventDefault();
        e.stopPropagation();
        return;
    }

    const openAllPaths = Array.from(new Set(parseVirtualLinkPaths(target.getAttribute('data-open-all-paths'))));
    // Prefer data-real-href because the visible href may be the blocked sentinel
    // (see BLOCKED_HREF in virtualLinkDom.ts) when the modifier gate is on.
    const href = target.getAttribute('data-real-href') || target.getAttribute('href');
    const targetPaths = openAllPaths.length > 0
        ? openAllPaths
        : (href ? [href] : []);

    if (targetPaths.length === 0) return;

    const searchText = target.getAttribute('origin-text');
    if (searchText) {
        targetPaths.forEach((path) => highlightService.setPending(path, searchText));
    }

    e.preventDefault();
    e.stopPropagation();

    const sourcePath = app.workspace.getActiveFile()?.path ?? '';

    if (openAllPaths.length > 0) {
        const openMode = Keymap.isModEvent(e) || 'tab';
        for (let index = 0; index < targetPaths.length; index++) {
            await app.workspace.openLinkText(targetPaths[index], sourcePath, openMode);
            if (index < targetPaths.length - 1) {
                await wait(OPEN_ALL_DELAY_MS);
            }
        }
        return;
    }

    await app.workspace.openLinkText(targetPaths[0], sourcePath, Keymap.isModEvent(e));
}

export default class LinkerPlugin extends Plugin {
    settings: LinkerPluginSettings;
    updateManager = new ExternalUpdateManager();
    highlightService = new HighlightService();
    // ponytail: number (browser setTimeout) not NodeJS.Timeout; @types/node pollutes global
    private cacheRefreshTimer: number | null = null;
    private pendingCacheRefreshPaths = new Set<string>();
    private forceFullCacheRefresh = false;

    onload(): void {
        void (async () => {
        await this.loadSettings();

        // Register the glossary linker for the read mode.
        // The second post-processor applies highlight marks for notes opened
        // via a virtual-link click.
        this.registerMarkdownPostProcessor((element, context) => {
            context.addChild(new GlossaryLinker(this.app, this.settings, context, element));
        });

        this.registerMarkdownPostProcessor((element, context) => {
            const searchText = this.highlightService.getActive(context.sourcePath);
            if (searchText) {
                applyHighlightToDOM(element, searchText, context.getSectionInfo(element));
            }
        });

        // Register the live linker for the live edit mode
        this.registerEditorExtension(liveLinkerPlugin(this.app, this.settings, this.updateManager, this.highlightService));

        // Register the right-sidebar highlights panel
        this.registerView(
            HIGHLIGHT_VIEW_TYPE,
            (leaf) => new HighlightView(leaf, this.highlightService, this.settings, this.updateManager)
        );

        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new LinkerSettingTab(this.app, this));

        // Context menu item to convert virtual links to real links
        this.registerEvent(this.app.workspace.on('file-menu', (menu, file, source) => this.addContextMenuItem(menu, file, source)));

        // ----------------------------------------------------------------
        // Display-text highlight: intercept virtual-link activation.
        // We use mousedown in the capture phase because CodeMirror can prevent
        // the first click from firing when a pane is focused or rerendered,
        // which manifests as “sometimes needs two clicks”. Handling the event
        // earlier makes navigation deterministic for both read mode and live
        // preview widgets.
        // ----------------------------------------------------------------
        this.registerDomEvent(window.document, 'mousedown', (e: MouseEvent) => {
            void handleVirtualLinkClickEvent(this.app, this.highlightService, this.settings.requireModifierForCandidateLinks, e);
        }, true /* capture */);

        // Safety net for the modifier gate. mousedown preventDefault suppresses
        // the click in reading mode, but live-preview's CodeMirror widget fires
        // its own click after handling the mousedown internally — that one slips
        // past our mousedown listener. A capture-phase click handler catches it
        // before the native <a> navigation or CodeMirror's link click.
        this.registerDomEvent(window.document, 'click', (e: MouseEvent) => {
            if (!this.settings.requireModifierForCandidateLinks) return;
            if (e.button !== 0) return;
            if (Keymap.isModEvent(e)) return;
            const target = resolveVirtualLinkTarget(e.target);
            if (!target) return;
            e.preventDefault();
            e.stopPropagation();
        }, true /* capture */);

        // Delay hover-only affordances so links the pointer merely crosses do
        // not flash their chooser or switch to the stronger underline style.
        this.registerDomEvent(window.document, 'mouseover', (e: MouseEvent) => {
            handleVirtualLinkHoverEnterEvent(this.settings.requireModifierForCandidateLinks, e);
        }, true /* capture */);
        this.registerDomEvent(window.document, 'mouseout', (e: MouseEvent) => {
            handleVirtualLinkHoverLeaveEvent(e);
        }, true /* capture */);

        // Promote pending highlight when the target file opens and apply it.
        this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
                if (!file) return;

                const searchText = this.highlightService.activateForFile(file.path);
                if (!searchText) return;

                // Trigger a CM6 re-render so live-preview gets the decorations.
                this.updateManager.update();

                // Apply marks to already-rendered reading-mode DOM (for notes
                // that were already open in another leaf when the link was clicked).
                // For freshly opened notes the reading-mode post-processor handles
                // mark injection; this path handles the tab-switch case.
                window.requestAnimationFrame(() => {
                    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                    if (!view || view.file?.path !== file.path) return;

                    const previewMode = view.previewMode as {
                        containerEl?: HTMLElement;
                        rerender?: (force?: boolean) => void;
                    } | undefined;

                    if (view.getMode?.() === 'preview' && typeof previewMode?.rerender === 'function') {
                        previewMode.rerender(true);
                        return;
                    }

                    // Prefer the internal previewMode container; fall back to
                    // well-known CSS classes so we never apply to toolbar DOM.
                    const readingEl: HTMLElement | null =
                        previewMode?.containerEl ??
                        view.contentEl.querySelector('.markdown-reading-view') ??
                        view.contentEl.querySelector('.markdown-preview-view');

                    if (readingEl?.instanceOf(HTMLElement)) {
                        applyHighlightToDOM(readingEl, searchText);
                    }
                });

                // Scroll to the first highlighted occurrence.  We poll every
                // 200 ms instead of a fixed delay so we adapt to varying render
                // times (fast machine: done at 200 ms; slow / large note: might
                // need a few retries).  Cap at 10 attempts (~2 s total).
                this.attemptScroll(file.path, searchText, 0);
            })
        );

        // Remove stale highlights for notes that have been closed.
        this.registerEvent(
            this.app.workspace.on('layout-change', () => {
                const openPaths = new Set<string>();
                this.app.workspace.iterateAllLeaves(leaf => {
                    if (leaf.view instanceof MarkdownView && leaf.view.file) {
                        openPaths.add(leaf.view.file.path);
                    }
                });
                this.highlightService.clearStale(openPaths);
            })
        );

        this.registerEvent(
            this.app.vault.on('create', (file) => {
                if (isMarkdownFileOrFolder(file)) {
                    this.scheduleCacheRefresh();
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('delete', (file) => {
                if (isMarkdownFileOrFolder(file)) {
                    this.scheduleCacheRefresh();
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('rename', (file) => {
                if (isMarkdownFileOrFolder(file)) {
                    this.scheduleCacheRefresh();
                }
            })
        );

        this.registerEvent(
            this.app.metadataCache.on('changed', (file) => {
                if (file instanceof TFile) {
                    this.scheduleCacheRefresh([file.path]);
                }
            })
        );

        registerInitialMetadataCacheRefresh(
            this.app.metadataCache,
            (eventRef) => this.registerEvent(eventRef),
            () => this.scheduleCacheRefresh(),
        );

        this.addCommand({
            id: 'open-highlights',
            name: 'Open highlights',
            callback: () => this.revealHighlightSidebar(),
        });

        this.addCommand({
            id: 'activate-virtual-linker',
            name: 'Activate Virtual Linker',
            checkCallback: (checking) => {
                if (!this.settings.linkerActivated) {
                    if (!checking) {
                        void this.updateSettings({ linkerActivated: true });
                    }
                    return true;
                }
                return false;
            },
        });

        this.addCommand({
            id: 'deactivate-virtual-linker',
            name: 'Deactivate Virtual Linker',
            checkCallback: (checking) => {
                if (this.settings.linkerActivated) {
                    if (!checking) {
                        void this.updateSettings({ linkerActivated: false });
                    }
                    return true;
                }
                return false;
            },
        });

        this.addCommand({
            id: 'convert-selected-virtual-links',
            name: 'Convert all virtual links in selection to real links',
            checkCallback: (checking: boolean) => {
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                const editor = view?.editor;

                if (!editor || !editor.somethingSelected()) {
                    return false;
                }

                if (checking) return true;

                // Get the selected text range
                const from = editor.getCursor('from');
                const to = editor.getCursor('to');

                // Get the DOM element containing the selection
                const cmEditor = (editor as unknown as { cm?: { dom: ParentNode } }).cm;
                if (!cmEditor) return;

                const selectionRange = cmEditor.dom.querySelector('.cm-content');
                if (!selectionRange) return false;

                // Find all virtual links in the selection
                const virtualLinks = Array.from(selectionRange.querySelectorAll('.virtual-link-a'))
                    .filter((link): link is HTMLElement => link.instanceOf(HTMLElement))
                    .map(link => ({
                        element: link,
                        from: parseInt(link.getAttribute('from') || '-1'),
                        to: parseInt(link.getAttribute('to') || '-1'),
                        text: link.getAttribute('origin-text') || '',
                        href: link.getAttribute('href') || ''
                    }))
                    .filter(link => {
                        const linkFrom = editor.offsetToPos(link.from);
                        const linkTo = editor.offsetToPos(link.to);
                        return this.isPosWithinRange(linkFrom, linkTo, from, to);
                    })
                    .sort((a, b) => a.from - b.from || a.to - b.to)
                    // CodeMirror can split one link around existing formatting.
                    .filter((link, index, links) => index === 0 ||
                        link.from !== links[index - 1].from || link.to !== links[index - 1].to);

                if (virtualLinks.length === 0) return;

                // Process all links in a single operation
                const replacements: {from: number, to: number, text: string}[] = [];

                for (const link of virtualLinks) {
                    const targetFile = this.app.vault.getAbstractFileByPath(link.href);
                    if (!(targetFile instanceof TFile)) continue;

                    const activeFile = this.app.workspace.getActiveFile();
                    if (!activeFile) continue;

                    replacements.push({
                        from: link.from,
                        to: link.to,
                        text: this.buildRealLink(targetFile, activeFile.path, link.text)
                    });
                }

                // Apply all replacements in reverse order to maintain correct positions
                for (const replacement of replacements.reverse()) {
                    const fromPos = editor.offsetToPos(replacement.from);
                    const toPos = editor.offsetToPos(replacement.to);
                    editor.replaceRange(replacement.text, fromPos, toPos);
                }
            }
        });

        })();
    }

    private isPosWithinRange(
        linkFrom: EditorPosition,
        linkTo: EditorPosition,
        selectionFrom: EditorPosition,
        selectionTo: EditorPosition
    ): boolean {
        return (
            (linkFrom.line > selectionFrom.line ||
             (linkFrom.line === selectionFrom.line && linkFrom.ch >= selectionFrom.ch)) &&
            (linkTo.line < selectionTo.line ||
             (linkTo.line === selectionTo.line && linkTo.ch <= selectionTo.ch))
        );
    }

    private buildRealLink(targetFile: TFile, sourceFilePath: string, displayText: string): string {
        let absolutePath = targetFile.path;
        let relativePath = buildRelativeVaultPath(sourceFilePath, absolutePath);

        // fileToLinktext depends on the app's link format setting; we compute all variants ourselves
        const replacementPath = this.app.metadataCache.fileToLinktext(targetFile, sourceFilePath);
        const lastPart = replacementPath.split('/').pop() ?? replacementPath;
        const shortestFile = this.app.metadataCache.getFirstLinkpathDest(lastPart, '');
        let shortestPath = shortestFile?.path === targetFile.path ? lastPart : absolutePath;

        if (!replacementPath.endsWith('.md')) {
            if (absolutePath.endsWith('.md')) absolutePath = absolutePath.slice(0, -3);
            if (shortestPath.endsWith('.md')) shortestPath = shortestPath.slice(0, -3);
            if (relativePath.endsWith('.md')) relativePath = relativePath.slice(0, -3);
        }

        const useMarkdownLinks = this.settings.useDefaultLinkStyleForConversion
            ? this.settings.defaultUseMarkdownLinks
            : this.settings.useMarkdownLinks;

        const linkFormat = this.settings.useDefaultLinkStyleForConversion
            ? this.settings.defaultLinkFormat
            : this.settings.linkFormat;

        const resolvedPath = linkFormat === 'shortest' ? shortestPath
            : linkFormat === 'relative' ? relativePath
            : absolutePath;

        if (replacementPath === displayText && linkFormat === 'shortest') {
            return useMarkdownLinks
                ? `[${displayText}](${resolvedPath})`
                : `[[${replacementPath}]]`;
        }

        return useMarkdownLinks
            ? `[${displayText}](${resolvedPath})`
            : `[[${resolvedPath}|${displayText}]]`;
    }

    private scheduleCacheRefresh(filePaths?: string[]): void {
        if (!filePaths || filePaths.length === 0) {
            this.forceFullCacheRefresh = true;
            this.pendingCacheRefreshPaths.clear();
        } else if (!this.forceFullCacheRefresh) {
            filePaths
                .map((filePath) => filePath.trim())
                .filter((filePath) => filePath.length > 0)
                .forEach((filePath) => this.pendingCacheRefreshPaths.add(filePath));
        }

        if (this.cacheRefreshTimer !== null) {
            window.clearTimeout(this.cacheRefreshTimer);
        }

        this.cacheRefreshTimer = window.setTimeout(() => {
            this.cacheRefreshTimer = null;

            const cache = LinkerCache.getInstance(this.app, this.settings);
            const pendingPaths = Array.from(this.pendingCacheRefreshPaths);
            const forceFullCacheRefresh = this.forceFullCacheRefresh;

            this.pendingCacheRefreshPaths.clear();
            this.forceFullCacheRefresh = false;

            if (forceFullCacheRefresh || pendingPaths.length === 0) {
                cache.rebuildCache();
            } else {
                cache.updateFiles(pendingPaths);
            }

            this.updateManager.update();
        }, 75);
    }

    private async updateFileTags(targetFile: TFile, tagToAdd: string, tagToRemove: string): Promise<boolean> {
        const currentTags = normalizeFrontmatterTags(this.app.metadataCache.getFileCache(targetFile)?.frontmatter?.tags);
        const requiresUpdate = !currentTags.includes(tagToAdd) || currentTags.includes(tagToRemove);
        if (!requiresUpdate) {
            return false;
        }

        await this.app.fileManager.processFrontMatter(targetFile, (frontMatter: Record<string, unknown>) => {
            const nextTags = new Set(normalizeFrontmatterTags((frontMatter as { tags?: unknown }).tags));
            nextTags.add(tagToAdd);
            nextTags.delete(tagToRemove);
            frontMatter.tags = Array.from(nextTags);
        });

        return true;
    }

    addContextMenuItem(menu: Menu, file: TAbstractFile, source: string) {
        if (!file) {
            return;
        }


        const app: App = this.app;
        const settings = this.settings;

        const fetcher = new LinkerMetaInfoFetcher(app, settings);
        // Check, if the file has the linker-included tag

        const isDirectory = app.vault.getAbstractFileByPath(file.path) instanceof TFolder;

        if (!isDirectory) {
            if (!(file instanceof TFile)) return;
            const metaInfo = fetcher.getMetaInfo(file);

            const contextMenuHandler = (event: MouseEvent) => {
                // Access the element that triggered the context menu
                const targetElement = event.targetNode;

                if (!targetElement?.instanceOf(HTMLElement)) {
                    console.error('No target element');
                    return;
                }

                // Check, if we are clicking on a virtual link inside a note or a note in the file explorer
                const isVirtualLink = targetElement.classList.contains('virtual-link-a');

                const from = parseInt(targetElement.getAttribute('from') || '-1');
                const to = parseInt(targetElement.getAttribute('to') || '-1');

                if (from === -1 || to === -1) {
                    menu.addItem((item) => {
                        // Item to convert a virtual link to a real link
                        item.setTitle(
                            '[Virtual Linker] converting link is not here.'
                        ).setIcon('link');
                    });
                }
                // Check, if the element has the "virtual-link" class
                else if (isVirtualLink) {
                    menu.addItem((item) => {
                        // Item to convert a virtual link to a real link
                        item.setTitle('[Virtual Linker] convert to real link')
                            .setIcon('link')
                            .onClick(() => {
                                                                const from = parseInt(targetElement.getAttribute('from') || '-1');
                                const to = parseInt(targetElement.getAttribute('to') || '-1');

                                if (from === -1 || to === -1) {
                                    console.error('[Virtual Autolink] No from or to position');
                                    return;
                                }

                                const text = targetElement.getAttribute('origin-text') || '';
                                const activeFile = app.workspace.getActiveFile();
                                if (!activeFile) {
                                    console.error('[Virtual Autolink] No active file');
                                    return;
                                }

                                if (!(file instanceof TFile)) return;
                                const replacement = this.buildRealLink(file, activeFile.path, text);

                                const editor = app.workspace.getActiveViewOfType(MarkdownView)?.editor;
                                const fromEditorPos = editor?.offsetToPos(from);
                                const toEditorPos = editor?.offsetToPos(to);

                                if (!fromEditorPos || !toEditorPos) {
                                    console.warn('[Virtual Autolink] No editor positions');
                                    return;
                                }

                                editor?.replaceRange(replacement, fromEditorPos, toEditorPos);
                            });
                    });
                }

                // Remove the listener to prevent multiple triggers
                window.document.removeEventListener('contextmenu', contextMenuHandler);
            };

            if (!metaInfo.excludeFile && (metaInfo.includeAllFiles || metaInfo.includeFile || metaInfo.isInIncludedDir)) {
                // Item to exclude a virtual link from the linker
                // This action adds the settings.tagToExcludeFile to the file
                menu.addItem((item) => {
                    item.setTitle('[Virtual Linker] exclude this file')
                        .setIcon('trash')
                        .onClick(async () => {
                            // Get the shown text
                            const target = file;

                            // Get the file
                            const targetFile = app.vault.getFileByPath(target.path);

                            if (!targetFile) {
                                console.error('No target file');
                                return;
                            }

                            const tagWasUpdated = await this.updateFileTags(
                                targetFile,
                                settings.tagToExcludeFile,
                                settings.tagToIncludeFile
                            );

                            if (tagWasUpdated) {
                                this.scheduleCacheRefresh();
                            }
                        });
                });
            } else if (!metaInfo.includeFile && (!metaInfo.includeAllFiles || metaInfo.excludeFile || metaInfo.isInExcludedDir)) {
                //Item to include a virtual link from the linker
                // This action adds the settings.tagToIncludeFile to the file
                menu.addItem((item) => {
                    item.setTitle('[Virtual Linker] include this file')
                        .setIcon('plus')
                        .onClick(async () => {
                            // Get the shown text
                            const target = file;

                            // Get the file
                            const targetFile = app.vault.getFileByPath(target.path);

                            if (!targetFile) {
                                console.error('No target file');
                                return;
                            }

                            const tagWasUpdated = await this.updateFileTags(
                                targetFile,
                                settings.tagToIncludeFile,
                                settings.tagToExcludeFile
                            );

                            if (tagWasUpdated) {
                                this.scheduleCacheRefresh();
                            }
                        });
                });
            }

            // Capture the MouseEvent when the context menu is triggered
            window.document.addEventListener('contextmenu', contextMenuHandler, { once: true });
        } else {
            // Check if the directory is in the linker directories
            const dirPath = file.path + '/';
            const isInIncludedDir = fetcher.includeDirPattern.test(dirPath);
            const isInExcludedDir = fetcher.excludeDirPattern.test(dirPath);

            // If the directory is in the linker directories, add the option to exclude it
            if ((fetcher.includeAllFiles && !isInExcludedDir) || isInIncludedDir) {
                menu.addItem((item) => {
                    item.setTitle('[Virtual Linker] exclude this directory')
                        .setIcon('trash')
                        .onClick(async () => {
                            // Get the shown text
                            const target = file;

                            // Get the file
                            const targetFolder = app.vault.getAbstractFileByPath(target.path);

                            if (!(targetFolder instanceof TFolder)) {
                                console.error('No target folder');
                                return;
                            }

                            const folderPath = normalizeDirectorySetting(targetFolder.path);
                            const newExcludedDirs = Array.from(new Set([
                                ...settings.excludedDirectories.filter((dir) => !matchesFolderSetting(dir, targetFolder)),
                                folderPath,
                            ]));
                            const newIncludedDirs = settings.linkerDirectories.filter((dir) => !matchesFolderSetting(dir, targetFolder));
                            await this.updateSettings({ linkerDirectories: newIncludedDirs, excludedDirectories: newExcludedDirs });
                        });
                });
            } else if ((!fetcher.includeAllFiles && !isInIncludedDir) || isInExcludedDir) {
                // If the directory is in the excluded directories, add the option to include it
                menu.addItem((item) => {
                    item.setTitle('[Virtual Linker] include this directory')
                        .setIcon('plus')
                        .onClick(async () => {
                            // Get the shown text
                            const target = file;

                            // Get the file
                            const targetFolder = app.vault.getAbstractFileByPath(target.path);

                            if (!(targetFolder instanceof TFolder)) {
                                console.error('No target folder');
                                return;
                            }

                            const folderPath = normalizeDirectorySetting(targetFolder.path);
                            const newExcludedDirs = settings.excludedDirectories.filter((dir) => !matchesFolderSetting(dir, targetFolder));
                            const newIncludedDirs = Array.from(new Set([
                                ...settings.linkerDirectories.filter((dir) => !matchesFolderSetting(dir, targetFolder)),
                                folderPath,
                            ]));
                            await this.updateSettings({ linkerDirectories: newIncludedDirs, excludedDirectories: newExcludedDirs });
                        });
                });
            }
        }
    }

    /**
     * Ensure the Virtual Autolink Highlights panel is open in the right sidebar and
     * visible.  Creates a new leaf only when none exists yet.
     */
    private async revealHighlightSidebar(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(HIGHLIGHT_VIEW_TYPE);
        let leaf = existing[0];
        if (!leaf) {
            const rightLeaf = this.app.workspace.getRightLeaf(false);
            if (!rightLeaf) return;
            await rightLeaf.setViewState({ type: HIGHLIGHT_VIEW_TYPE, active: true });
            leaf = rightLeaf;
        }
        await this.app.workspace.revealLeaf(leaf);
    }

    /**
     * Two-phase, mode-agnostic scroll toward the first highlighted occurrence.
     *
     * Phase A – DOM search (both modes)
     *   Reading mode  : <mark class="virtual-autolink-highlight"> injected by
     *                   applyHighlightToDOM().  Scroll via DOM scrollIntoView.
     *   Live preview  : <span class="virtual-autolink-highlight"> rendered by CM6.
     *                   Scroll via DOM scrollIntoView.
     *
     * Phase B – editor kick (live preview only, runs once when Phase A fails)
     *   The first match may be below the initial CM6 viewport, so the span
     *   doesn’t exist in the DOM yet.  We call editor.scrollIntoView() to
     *   move the editor to that position, which causes CM6 to render it.
     *   The very next poll attempt (Phase A) then finds the span.
     *
     * We use iterateAllLeaves instead of getActiveViewOfType so we find the
     * right view even when Obsidian has briefly shifted focus to a toolbar or
     * a different pane during the opening animation.
     */
    private attemptScroll(
        filePath: string,
        searchText: string,
        attempt: number,
        editorKickDone = false
    ): void {
        const INTERVAL_MS  = 150;
        const MAX_ATTEMPTS = 14; // ~2 s total

        if (attempt >= MAX_ATTEMPTS) return;

        window.setTimeout(() => {
            // Find the view that holds this file regardless of focus state.
            let view: MarkdownView | null = null;
            this.app.workspace.iterateAllLeaves(leaf => {
                if (!view &&
                    leaf.view instanceof MarkdownView &&
                    leaf.view.file?.path === filePath) {
                    view = leaf.view;
                }
            });
            if (!view) return; // note was closed

            // ── Phase A: DOM search ────────────────────────────────────────
            // Reading mode injected <mark>
            const domMark = (view as MarkdownView).contentEl
                .querySelector('mark.virtual-autolink-highlight');
            if (domMark?.instanceOf(HTMLElement)) {
                domMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }

            // Live-preview CM6 rendered <span class="virtual-autolink-highlight">
            const cmMark = (view as MarkdownView).contentEl
                .querySelector('.cm-content .virtual-autolink-highlight');
            if (cmMark?.instanceOf(HTMLElement)) {
                cmMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }

            // ── Phase B: editor kick (live preview, first miss only) ────────
            // Scroll the CM6 editor to the text position so it renders that
            // part of the document.  The next poll will find the span in the DOM.
            // We skip frontmatter so we don't kick to position 0 when the search
            // text appears in aliases/tags but not yet in the visible body.
            if (!editorKickDone) {
                const editor = (view as MarkdownView).editor;
                if (editor) {
                    const raw  = editor.getValue();
                    const file = (view as MarkdownView).file;
                    const fmEnd = file
                        ? (this.app.metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset ?? 0)
                        : 0;
                    const searchFrom = fmEnd > 0 ? fmEnd : 0;
                    const idx = raw.toLowerCase().indexOf(searchText.toLowerCase(), searchFrom);
                    if (idx >= 0) {
                        const from = editor.offsetToPos(idx);
                        const to   = editor.offsetToPos(idx + searchText.length);
                        editor.scrollIntoView({ from, to }, true);
                    }
                }
            }

            // Content / decorations not ready yet — retry.
            this.attemptScroll(filePath, searchText, attempt + 1, true);
        }, attempt === 0 ? 200 : INTERVAL_MS);
    }

    onunload() {
        if (this.cacheRefreshTimer !== null) {
            window.clearTimeout(this.cacheRefreshTimer);
            this.cacheRefreshTimer = null;
        }
        this.pendingCacheRefreshPaths.clear();
        this.forceFullCacheRefresh = false;
        LinkerCache.resetInstance();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<LinkerPluginSettings>);

        // Obsidian does not expose link-format settings via a public API, so we read app.json directly.
        try {
            const fileContent = await this.app.vault.adapter.read(this.app.vault.configDir + '/app.json');
            const appSettings = JSON.parse(fileContent) as { useMarkdownLinks?: boolean; newLinkFormat?: string };
            this.settings.defaultUseMarkdownLinks = appSettings.useMarkdownLinks ?? false;
            this.settings.defaultLinkFormat = (appSettings.newLinkFormat as LinkerPluginSettings['defaultLinkFormat']) ?? 'shortest';
        } catch (e) {
            console.warn('[Virtual Autolink] Could not read Obsidian app.json settings, using defaults.', e);
        }
    }

    /** Update plugin settings. */
    async updateSettings(settings: Partial<LinkerPluginSettings> = {}) {
        Object.assign(this.settings, settings);
        await this.saveData(this.settings);
        this.scheduleCacheRefresh();
    }
}

class LinkerSettingTab extends PluginSettingTab {
    constructor(app: App, public plugin: LinkerPlugin) {
        super(app, plugin);
    }

    private saveSetting<K extends keyof LinkerPluginSettings>(key: K, value: LinkerPluginSettings[K]): Promise<void> {
        return this.plugin.updateSettings({ [key]: value });
    }

    private refreshSettings(): void {
        this.update();
    }

    getSettingDefinitions() {
        const advanced = () => this.plugin.settings.advancedSettings;
        const toggle = (
            name: string,
            key: keyof LinkerPluginSettings,
            desc?: string,
            visible: () => boolean = () => true,
            refresh = false,
        ) => ({
            name,
            desc,
            visible,
            render: (setting: Setting) => {
                setting.addToggle(control =>
                    control
                        .setValue(this.plugin.settings[key] as boolean)
                        .onChange(async value => {
                            await this.saveSetting(key, value);
                            if (refresh) this.refreshSettings();
                        })
                );
            },
        });
        const text = (
            name: string,
            key: keyof LinkerPluginSettings,
            desc?: string,
            visible: () => boolean = () => true,
        ) => ({
            name,
            desc,
            visible,
            render: (setting: Setting) => {
                setting.addText(control =>
                    control
                        .setValue(this.plugin.settings[key] as string)
                        .onChange(value => this.saveSetting(key, value))
                );
            },
        });
        const textArea = (
            name: string,
            desc: string,
            key: 'customFrontmatterFields' | 'linkerDirectories' | 'excludedDirectories' | 'excludedDirectoriesForLinking',
            visible: () => boolean = () => true,
            placeholder = 'List of directory paths or names (one per line)',
        ) => ({
            name,
            desc,
            visible,
            render: (setting: Setting) => {
                const values = this.plugin.settings[key];
                setting.addTextArea(control => {
                    control
                        .setPlaceholder(placeholder)
                        .setValue(Array.isArray(values) ? values.join('\n') : '')
                        .onChange(value => this.saveSetting(
                            key,
                            value.split('\n').map(line => line.trim()).filter(line => line.length > 0),
                        ));
                    control.inputEl.addClass('linker-settings-text-box');
                });
            },
        });
        const heading = (name: string) => ({
            name,
            desc: undefined,
            visible: () => true,
            render: (setting: Setting) => { setting.setHeading(); },
        });

        return [
            toggle('Activate Virtual Linker', 'linkerActivated'),
            toggle(
                'Require modifier key for candidate links',
                'requireModifierForCandidateLinks',
                'When on, only modifier-held clicks and hovers activate virtual links. Disable to allow standalone clicks and hovers.',
            ),
            toggle('Show advanced settings', 'advancedSettings', undefined, () => true, true),
            heading('Matching behavior'),
            toggle('Include aliases', 'includeAliases', 'If activated, the virtual linker will also include aliases for the files.'),
            textArea(
                'Custom frontmatter fields for linking',
                'Additional frontmatter property names (one per line) whose values are used as link candidates, independent of the aliases toggle. Use this to keep your aliases clean while still creating virtual links from dedicated fields such as `linker-terms` or `keywords`.',
                'customFrontmatterFields',
                undefined,
                'e.g. linker-terms\nkeywords',
            ),
            toggle(
                'Only link once',
                'onlyLinkOnce',
                'If activated, there will not be several identical virtual links in the same note (Wikipedia style). Repeated identical matches on the same line are always collapsed to the first occurrence to reduce clutter.',
                advanced,
            ),
            toggle(
                'Exclude links to real linked files',
                'excludeLinksToRealLinkedFiles',
                'If activated, there will be no links to files that are already linked in the note by real links.',
                advanced,
            ),
            toggle('Include headers', 'includeHeaders', 'If activated, headers (so your lines beginning with at least one `#`) are included for virtual links.'),
            toggle(
                'Match any part of a word',
                'matchAnyPartsOfWords',
                'If deactivated, only whole words are matched. Otherwise, every part of a word is found.',
                undefined,
                true,
            ),
            toggle(
                'Match the beginning of words',
                'matchBeginningOfWords',
                'If activated, the beginnings of words are also linked, even if it is not a whole match.',
                () => !this.plugin.settings.matchAnyPartsOfWords,
                true,
            ),
            toggle(
                'Match the end of words',
                'matchEndOfWords',
                'If activated, the ends of words are also linked, even if it is not a whole match.',
                () => !this.plugin.settings.matchAnyPartsOfWords,
                true,
            ),
            toggle(
                'Suppress suffix for sub words',
                'suppressSuffixForSubWords',
                'If activated, the suffix is not added to links for subwords, but only for complete matches.',
                () => this.plugin.settings.matchAnyPartsOfWords || this.plugin.settings.matchBeginningOfWords,
            ),
            toggle(
                'Fix IME problem',
                'fixIMEProblem',
                'If activated, there will be no links in the current line start which is followed immediately by the Input Method Editor (IME). This is the recommended setting if you are using IME for typing, e.g. for Chinese characters, because instant linking might interfere with IME.',
                advanced,
            ),
            toggle(
                'Avoid linking in current line',
                'excludeLinksInCurrentLine',
                'If activated, there will be no links in the current line.',
                advanced,
            ),
            heading('Case sensitivity'),
            toggle(
                'Case sensitive',
                'matchCaseSensitive',
                'If activated, the matching is case sensitive.',
                undefined,
                true,
            ),
            {
                name: 'Capital letter percentage for automatic match case',
                desc: 'The percentage (0 - 100) of capital letters in a file name or alias to be automatically considered as case sensitive.',
                visible: advanced,
                render: (setting: Setting) => {
                    setting.addText(control =>
                        control
                            .setValue((this.plugin.settings.capitalLetterProportionForAutomaticMatchCase * 100).toFixed(1))
                            .onChange(async value => {
                                let percentage = parseFloat(value);
                                if (isNaN(percentage)) percentage = 75;
                                else if (percentage < 0) percentage = 0;
                                else if (percentage > 100) percentage = 100;
                                await this.saveSetting('capitalLetterProportionForAutomaticMatchCase', percentage / 100);
                            })
                    );
                },
            },
            text(
                'Tag to ignore case',
                'tagToIgnoreCase',
                'By adding this tag to a file, the linker will ignore the case for the file.',
                () => this.plugin.settings.advancedSettings && this.plugin.settings.matchCaseSensitive,
            ),
            text(
                'Tag to match case',
                'tagToMatchCase',
                'By adding this tag to a file, the linker will match the case for the file.',
                () => this.plugin.settings.advancedSettings && !this.plugin.settings.matchCaseSensitive,
            ),
            text(
                'Property name to ignore case',
                'propertyNameToIgnoreCase',
                'By adding this property to a note, containing a list of names, the linker will ignore the case for the specified names / aliases. This way you can decide, which alias should be insensitive.',
                advanced,
            ),
            text(
                'Property name to match case',
                'propertyNameToMatchCase',
                'By adding this property to a note, containing a list of names, the linker will match the case for the specified names / aliases. This way you can decide, which alias should be case sensitive.',
                advanced,
            ),
            heading('Matched files'),
            toggle('Include all files', 'includeAllFiles', 'Include all files for the virtual linker.', undefined, true),
            textArea(
                'Glossary linker directories',
                'Directories to include for the virtual linker (one folder path or name per line).',
                'linkerDirectories',
                () => !this.plugin.settings.includeAllFiles,
            ),
            textArea(
                'Excluded directories',
                'Directories from which files are to be excluded for the virtual linker. Files in these directories will not create any virtual links in other files.',
                'excludedDirectories',
                () => this.plugin.settings.advancedSettings && this.plugin.settings.includeAllFiles,
            ),
            text('Tag to include file', 'tagToIncludeFile', 'Tag to explicitly include the file for the linker.', advanced),
            text('Tag to ignore file', 'tagToExcludeFile', 'Tag to ignore the file for the linker.', advanced),
            toggle(
                'Exclude self-links to the current note',
                'excludeLinksToOwnNote',
                'If toggled, links to the note itself are excluded from the linker. (This might not work in preview windows.)',
                advanced,
            ),
            textArea(
                'Excluded directories for generating virtual links',
                'Directories in which the plugin will not create virtual links (one folder path or name per line).',
                'excludedDirectoriesForLinking',
                advanced,
            ),
            heading('Link style'),
            toggle(
                'Always show multiple references',
                'alwaysShowMultipleReferences',
                'If toggled, if there are multiple matching notes, all references are shown behind the match. If not toggled, the references are only shown if hovering over the match.',
            ),
            text('Virtual link suffix', 'virtualLinkSuffix', 'The suffix to add to auto generated virtual links.'),
            text('Virtual link suffix for aliases', 'virtualLinkAliasSuffix', 'The suffix to add to auto generated virtual links for aliases.'),
            toggle(
                'Apply default link styling',
                'applyDefaultLinkStyling',
                'If toggled, the default link styling will be applied to virtual links. You can also style them with a CSS snippet affecting the `virtual-link` class.',
            ),
            toggle(
                'Use default link style for conversion',
                'useDefaultLinkStyleForConversion',
                'If toggled, the default link style will be used for the conversion of virtual links to real links.',
                undefined,
                true,
            ),
            {
                name: 'Use [[Wiki-links]]',
                desc: 'If toggled, the virtual links will be created as wiki-links instead of markdown links.',
                visible: () => !this.plugin.settings.useDefaultLinkStyleForConversion,
                render: (setting: Setting) => {
                    setting.addToggle(control =>
                        control
                            .setValue(!this.plugin.settings.useMarkdownLinks)
                            .onChange(value => this.saveSetting('useMarkdownLinks', !value))
                    );
                },
            },
            {
                name: 'Link format',
                desc: 'The format of the generated links.',
                visible: () => !this.plugin.settings.useDefaultLinkStyleForConversion,
                render: (setting: Setting) => {
                    setting.addDropdown(dropdown =>
                        dropdown
                            .addOption('shortest', 'Shortest')
                            .addOption('relative', 'Relative')
                            .addOption('absolute', 'Absolute')
                            .setValue(this.plugin.settings.linkFormat)
                            .onChange(value => this.saveSetting('linkFormat', value as LinkerPluginSettings['linkFormat']))
                    );
                },
            },
        ];
    }

}
