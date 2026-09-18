import markdown from "@eslint/markdown";
import { defineConfig, globalIgnores } from "eslint/config";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import { flatConfigs as importXFlatConfigs } from "eslint-plugin-import-x";
import packageJson from "eslint-plugin-package-json";
import oxlint from "eslint-plugin-oxlint";
import tseslint from "typescript-eslint";

// Oxlint owns JS/TS/TSX linting (see `.oxlintrc.jsonc`), including type-aware
// rules. ESLint only covers what Oxlint cannot:
//
//   - `import-x/order`: Oxlint omits it; Oxfmt's `sortImports` reorders
//     differently.
//   - Markdown: `@eslint/markdown` uses processors the JS plugin API lacks.
//   - `package.json`: Oxlint only lints source extensions.
//
// `oxlint.buildFromOxlintConfigFile` turns off every rule Oxlint already
// covers, so the two never disagree. It must come last.
export default defineConfig(
	globalIgnores([
		"out/**",
		"dist/**",
		"**/*.d.ts",
		"**/vite.config*.ts",
		".vscode-test/**",
		"test/fixtures/scripts/**",
		"storybook-static/**",
	]),

	// Parse TypeScript without the type-aware programs; Oxlint owns typed rules.
	{
		files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
		languageOptions: { parser: tseslint.parser },
	},

	// Import ordering for source files.
	{
		files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
		extends: [importXFlatConfigs.typescript],
		settings: {
			"import-x/resolver-next": [
				createTypeScriptImportResolver({ project: "./tsconfig.json" }),
			],
			"import-x/internal-regex": "^@/",
		},
		rules: {
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
					warnOnUnassignedImports: true,
				},
			],
		},
	},

	// Test files resolve against the test tsconfig.
	{
		files: ["test/**/*.{ts,tsx}", "**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
		settings: {
			"import-x/resolver-next": [
				createTypeScriptImportResolver({ project: "test/tsconfig.json" }),
			],
		},
	},

	// Package.json linting.
	packageJson.configs.recommended,
	{
		// The root package.json is a VS Code extension (not an npm package),
		// so these publishing-oriented rules don't apply.
		files: ["package.json"],
		ignores: ["packages/**/package.json"],
		rules: {
			"package-json/require-exports": "off",
			"package-json/require-files": "off",
			"package-json/require-sideEffects": "off",
			"package-json/require-attribution": "off",
		},
	},

	// Markdown linting with GitHub-flavored admonitions allowed.
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

	// Turn off every rule Oxlint already covers. Must stay last so its disables win.
	...oxlint.buildFromOxlintConfigFile("./.oxlintrc.jsonc"),
);
