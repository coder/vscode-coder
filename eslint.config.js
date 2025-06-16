const js = require("@eslint/js")
const tsParser = require("@typescript-eslint/parser")
const tsPlugin = require("@typescript-eslint/eslint-plugin")
const prettierPlugin = require("eslint-plugin-prettier")
const importPlugin = require("eslint-plugin-import")

module.exports = [
	{
		ignores: ["out", "dist", "**/*.d.ts", "**/*.md"]
	},
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				ecmaVersion: 2020,
				sourceType: "module",
				project: true
			},
			globals: {
				Buffer: "readonly", 
				setTimeout: "readonly",
				clearTimeout: "readonly",
				setInterval: "readonly",
				clearInterval: "readonly",
				setImmediate: "readonly",
				AbortController: "readonly",
				URL: "readonly",
				URLSearchParams: "readonly",
				ReadableStream: "readonly",
				ReadableStreamDefaultController: "readonly",
				MessageEvent: "readonly",
				global: "readonly",
				__filename: "readonly",
				__dirname: "readonly",
				NodeJS: "readonly",
				Thenable: "readonly",
				process: "readonly",
				fs: "readonly",
				semver: "readonly"
			}
		},
		plugins: {
			"@typescript-eslint": tsPlugin,
			"prettier": prettierPlugin,
			"import": importPlugin
		},
		rules: {
			...js.configs.recommended.rules,
			...tsPlugin.configs.recommended.rules,
			curly: "error",
			eqeqeq: "error",
			"no-throw-literal": "error",
			"no-console": "error",
			"prettier/prettier": "error",
			"import/order": [
				"error",
				{
					alphabetize: {
						order: "asc"
					},
					groups: [["builtin", "external", "internal"], "parent", "sibling"]
				}
			],
			"import/no-unresolved": "off",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					varsIgnorePattern: "^_"
				}
			]
		}
	}
]