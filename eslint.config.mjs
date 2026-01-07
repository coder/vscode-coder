// @ts-check
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import markdown from "@eslint/markdown";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";
import prettierPlugin from "eslint-plugin-prettier";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import { flatConfigs as importXFlatConfigs } from "eslint-plugin-import-x";
import packageJson from "eslint-plugin-package-json";
import globals from "globals";

export default defineConfig(
	// Global ignores
	{
		ignores: [
			"out/**",
			"dist/**",
			"**/*.d.ts",
			"vitest.config.ts",
			".vscode-test/**",
		],
	},

	// Base ESLint recommended rules (for JS/TS files only)
	{
		files: ["**/*.ts", "**/*.js", "**/*.mjs"],
		...eslint.configs.recommended,
	},

	// TypeScript configuration with type-checked rules
	{
		files: ["**/*.ts"],
		extends: [
			...tseslint.configs.recommendedTypeChecked,
			...tseslint.configs.stylisticTypeChecked,
			importXFlatConfigs.typescript,
		],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		plugins: {
			prettier: prettierPlugin,
		},
		settings: {
			"import-x/resolver-next": [
				createTypeScriptImportResolver({ project: "./tsconfig.json" }),
			],
			"import-x/internal-regex": "^@/",
		},
		rules: {
			// Prettier integration
			"prettier/prettier": "error",

			// Core ESLint rules
			curly: "error",
			eqeqeq: "error",
			"no-throw-literal": "error",
			"no-console": "error",

			// TypeScript rules (extending/overriding presets)
			"require-await": "off",
			"@typescript-eslint/require-await": "error",
			"@typescript-eslint/consistent-type-imports": "error",
			"@typescript-eslint/switch-exhaustiveness-check": [
				"error",
				{ considerDefaultExhaustiveForUnions: true },
			],
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ varsIgnorePattern: "^_" },
			],
			"@typescript-eslint/array-type": ["error", { default: "array-simple" }],
			"@typescript-eslint/prefer-nullish-coalescing": [
				"error",
				// Allow || for strings where empty string should be treated as falsy
				{ ignorePrimitives: { string: true } },
			],
			"@typescript-eslint/dot-notation": [
				"error",
				// Allow bracket notation for index signatures (e.g., Record<string, T>)
				{ allowIndexSignaturePropertyAccess: true },
			],

			// Import rules
			"import-x/order": [
				"error",
				{
					groups: [
						["builtin", "external"],
						"internal",
						"parent",
						["sibling", "index"],
						"type",
					],
					pathGroups: [
						{ pattern: "@/**", group: "internal", position: "before" },
					],
					pathGroupsExcludedImportTypes: ["builtin", "external"],
					"newlines-between": "always",
					alphabetize: { order: "asc", caseInsensitive: true },
					sortTypesGroup: true,
				},
			],
			"no-duplicate-imports": "off",
			"import-x/no-duplicates": ["error", { "prefer-inline": true }],
			"import-x/no-unresolved": ["error", { ignore: ["vscode"] }],

			// Custom AST selector rule
			"no-restricted-syntax": [
				"error",
				{
					selector:
						"CallExpression[callee.property.name='executeCommand'][arguments.0.value='setContext'][arguments.length>=3]",
					message:
						"Do not use executeCommand('setContext', ...) directly. Use the ContextManager class instead.",
				},
			],
		},
	},

	// Test files - use test tsconfig and relax some rules
	{
		files: ["test/**/*.ts", "**/*.test.ts", "**/*.spec.ts"],
		settings: {
			"import-x/resolver-next": [
				createTypeScriptImportResolver({ project: "test/tsconfig.json" }),
			],
		},
		rules: {
			// Allow type annotations in tests (e.g., for vi.fn<SomeType>())
			"@typescript-eslint/consistent-type-imports": [
				"error",
				{
					disallowTypeAnnotations: false,
				},
			],
			// vitest mocks trigger false positives for unbound-method
			"@typescript-eslint/unbound-method": "off",
			// Empty callbacks are common in test stubs
			"@typescript-eslint/no-empty-function": "off",
			// Test mocks often have loose typing - relax unsafe rules
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-return": "off",
		},
	},

	// Disable no-restricted-syntax for contextManager
	{
		files: ["src/core/contextManager.ts"],
		rules: {
			"no-restricted-syntax": "off",
		},
	},

	// Webpack config - CommonJS with Node globals
	{
		files: ["webpack.config.js"],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
	},

	// Package.json linting
	packageJson.configs.recommended,

	// Markdown linting with GitHub-flavored admonitions allowed
	...markdown.configs.recommended,
	{
		files: ["**/*.md"],
		rules: {
			"markdown/no-missing-label-refs": [
				"error",
				{
					allowLabels: ["!NOTE", "!TIP", "!IMPORTANT", "!WARNING", "!CAUTION"],
				},
			],
		},
	},

	// Prettier must be last to override other formatting rules
	prettierConfig,
);
