import LinkerPlugin, { LinkerPluginSettings } from 'main';
import { App, PluginManifest } from 'obsidian';

const SETTINGS: LinkerPluginSettings = {
    advancedSettings: false,
    linkerActivated: true,
    suppressSuffixForSubWords: false,
    matchAnyPartsOfWords: false,
    matchEndOfWords: true,
    matchBeginningOfWords: true,
    includeAllFiles: true,
    linkerDirectories: ['Glossary'],
    excludedDirectories: [],
    excludedDirectoriesForLinking: [],
    virtualLinkSuffix: '🔗',
    virtualLinkAliasSuffix: '🔗',
    useDefaultLinkStyleForConversion: true,
    defaultUseMarkdownLinks: false,
    defaultLinkFormat: 'shortest',
    useMarkdownLinks: false,
    linkFormat: 'shortest',
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
    requireModifierForCandidateLinks: false,
};

type SettingDefinition = {
    name?: string;
    items?: SettingDefinition[];
    control?: unknown;
    render?: unknown;
    visible?: () => boolean;
};

describe('declarative settings search', () => {
    it('defines settings for search and preserves conditional and inverted controls', async () => {
        const plugin = new LinkerPlugin({} as App, {} as PluginManifest);
        let tab: { getSettingDefinitions: () => SettingDefinition[] } | undefined;
        let savedSettings: LinkerPluginSettings | undefined;
        Object.assign(plugin, {
            app: {
                workspace: { on: () => undefined },
                vault: { on: () => undefined },
                metadataCache: { initialized: false, on: () => undefined },
            },
            loadSettings: async () => { plugin.settings = { ...SETTINGS }; },
            registerMarkdownPostProcessor: () => undefined,
            registerEditorExtension: () => undefined,
            registerView: () => undefined,
            addSettingTab: (settingTab: unknown) => { tab = settingTab as { getSettingDefinitions: () => SettingDefinition[] }; },
            registerEvent: () => undefined,
            registerDomEvent: () => undefined,
            addCommand: () => undefined,
            saveData: async (value: LinkerPluginSettings) => { savedSettings = { ...value }; },
            scheduleCacheRefresh: jest.fn(),
        });

        plugin.onload();
        await Promise.resolve();
        if (!tab) throw new Error('settings tab was not registered');

        const definitions = tab.getSettingDefinitions();
        const onlyOnce = definitions.find(setting => setting.name === 'Only link once');
        const directories = definitions.find(setting => setting.name === 'Glossary linker directories');
        expect(onlyOnce).toBeDefined();
        expect(directories).toBeDefined();
        expect(onlyOnce?.visible?.()).toBe(false);
        expect(directories?.visible?.()).toBe(false);

        plugin.settings.advancedSettings = true;
        expect(onlyOnce?.visible?.()).toBe(true);
        expect(definitions.find(setting => setting.name === 'Excluded directories')?.visible?.()).toBe(true);

        let wikiValue: boolean | undefined;
        let wikiChange: (value: boolean) => unknown = () => undefined;
        const wikiControl = {
            setValue(value: boolean) {
                wikiValue = value;
                return this;
            },
            onChange(callback: (value: boolean) => unknown) {
                wikiChange = callback;
                return this;
            },
        };
        const wikiLinks = definitions.find(setting => setting.name === 'Use [[Wiki-links]]');
        (wikiLinks?.render as (setting: unknown) => void)({
            addToggle: (callback: (control: typeof wikiControl) => unknown) => callback(wikiControl),
        });
        expect(wikiValue).toBe(true);
        await wikiChange(false);
        expect(plugin.settings.useMarkdownLinks).toBe(true);

        let fieldsChange: (value: string) => unknown = () => undefined;
        const fieldsControl = {
            setPlaceholder(_value: string) { return this; },
            setValue(_value: string) { return this; },
            onChange(callback: (value: string) => unknown) {
                fieldsChange = callback;
                return this;
            },
            inputEl: { addClass: jest.fn() },
        };
        const customFields = definitions.find(setting => setting.name === 'Custom frontmatter fields for linking');
        (customFields?.render as (setting: unknown) => void)({
            addTextArea: (callback: (control: typeof fieldsControl) => unknown) => callback(fieldsControl),
        });
        await fieldsChange(' first \n second \n ');
        expect(plugin.settings.customFrontmatterFields).toEqual(['first', 'second']);

        let percentageChange: (value: string) => unknown = () => undefined;
        const percentageControl = {
            setValue(_value: string) { return this; },
            onChange(callback: (value: string) => unknown) {
                percentageChange = callback;
                return this;
            },
        };
        const percentage = definitions.find(setting => setting.name === 'Capital letter percentage for automatic match case');
        (percentage?.render as (setting: unknown) => void)({
            addText: (callback: (control: typeof percentageControl) => unknown) => callback(percentageControl),
        });
        await percentageChange('150');
        expect(plugin.settings.capitalLetterProportionForAutomaticMatchCase).toBe(1);
        expect(savedSettings).toEqual(expect.objectContaining({
            useMarkdownLinks: true,
            customFrontmatterFields: ['first', 'second'],
            capitalLetterProportionForAutomaticMatchCase: 1,
        }));
    });
});
