import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import globals from 'globals';
import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';

export default defineConfig([
    { ignores: ['node_modules/**', 'main.js', 'coverage/**'] },
    {
        files: ['**/*.ts'],
        ignores: ['tests/**'],
        extends: obsidianmd.configs.recommended,
        languageOptions: {
            parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
        },
        rules: {
            '@typescript-eslint/no-unnecessary-type-assertion': 'error',
            '@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
            'obsidianmd/ui/sentence-case': ['warn', {
                brands: ['Virtual Autolink', 'Virtual Linker'],
                enforceCamelCaseLower: true,
            }],
        },
    },
    {
        files: ['tests/**/*.ts'],
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.jest } },
        rules: {
            // Obsidian API test doubles intentionally model partial and untyped host objects.
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-empty-function': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
        },
    },
    {
        files: ['**/*.{js,cjs,mjs}'],
        extends: [js.configs.recommended],
        languageOptions: { globals: globals.node },
    },
]);
