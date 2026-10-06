import path from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

import { probes, unprobedMethods } from "../../scopes/probes";

/** Repository root, whose tsconfig.json covers src/. */
const ROOT = path.resolve(import.meta.dirname, "../../..");

/** Allows for type checking all of src/. */
const TYPE_CHECK_TIMEOUT_MS = 60_000;

/**
 * Finds every CoderApi method returning a promise (a request or stream, not
 * client configuration) that code under src/ references, through CoderApi
 * itself or any type it satisfies, like `Api` or `Pick<CoderApi, ...>`.
 */
function findApiMethodsUsedBySource(): Set<string> {
	const config = ts.getParsedCommandLineOfConfigFile(
		path.join(ROOT, "tsconfig.json"),
		{},
		{ ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
	);
	if (!config) {
		throw new Error("Could not read tsconfig.json");
	}
	const program = ts.createProgram(config.fileNames, config.options);
	const checker = program.getTypeChecker();
	const coderApi = getCoderApiType(program, checker);
	const methods = new Set(
		checker
			.getPropertiesOfType(coderApi)
			.filter((method) => isPublicAsyncMethod(checker, method))
			.map((method) => method.name),
	);

	const used = new Set<string>();
	const visit = (node: ts.Node): void => {
		const reference = getMemberReference(node);
		if (
			reference &&
			methods.has(reference.name) &&
			checker.isTypeAssignableTo(
				coderApi,
				// Resolves `this` inside CoderApi to its class type.
				checker.getApparentType(checker.getTypeAtLocation(reference.object)),
			)
		) {
			used.add(reference.name);
		}
		ts.forEachChild(node, visit);
	};
	const srcDir = path.join(ROOT, "src");
	for (const file of program.getSourceFiles()) {
		if (path.resolve(file.fileName).startsWith(srcDir)) {
			visit(file);
		}
	}
	return used;
}

/** The member read by `api.method` or `const { method } = api`, and the node its type comes from. */
function getMemberReference(
	node: ts.Node,
): { name: string; object: ts.Node } | undefined {
	if (ts.isPropertyAccessExpression(node)) {
		return { name: node.name.text, object: node.expression };
	}
	if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
		const property = node.propertyName ?? node.name;
		if (ts.isIdentifier(property)) {
			return { name: property.text, object: node.parent };
		}
	}
	return undefined;
}

function getCoderApiType(
	program: ts.Program,
	checker: ts.TypeChecker,
): ts.Type {
	const file = program.getSourceFile(path.join(ROOT, "src/api/coderApi.ts"));
	const declaration = file?.statements.find(
		(statement): statement is ts.ClassDeclaration =>
			ts.isClassDeclaration(statement) && statement.name?.text === "CoderApi",
	);
	if (!declaration) {
		throw new Error("CoderApi class not found");
	}
	return checker.getTypeAtLocation(declaration);
}

function isPublicAsyncMethod(
	checker: ts.TypeChecker,
	method: ts.Symbol,
): boolean {
	const declaration = method.declarations?.[0];
	if (
		!declaration ||
		ts.getCombinedModifierFlags(declaration) &
			ts.ModifierFlags.NonPublicAccessibilityModifier
	) {
		return false;
	}
	return checker
		.getTypeOfSymbol(method)
		.getCallSignatures()
		.some(
			(signature) =>
				checker.getReturnTypeOfSignature(signature).getSymbol()?.name ===
				"Promise",
		);
}

describe("OAuth scope probes", () => {
	/** Method names the probes cover, without their "(variant)" suffix. */
	const probed = new Set(Object.keys(probes).map((key) => key.split(" ")[0]));
	let used: Set<string>;

	beforeAll(() => {
		used = findApiMethodsUsedBySource();
	}, TYPE_CHECK_TIMEOUT_MS);

	it("probes every Coder API method the extension calls", () => {
		const unprobed = [...used].filter(
			(method) => !probed.has(method) && !(method in unprobedMethods),
		);
		expect(
			unprobed,
			"Add a probe to `probes` in test/scopes/probes.ts and run `pnpm test:scopes`, or list the method in `unprobedMethods` with the reason it needs none",
		).toEqual([]);
	});

	it("only lists methods the extension still calls", () => {
		const listed = [...probed, ...Object.keys(unprobedMethods)];
		expect(
			listed.filter((method) => !used.has(method)),
			"Remove these from test/scopes/probes.ts",
		).toEqual([]);
	});
});
