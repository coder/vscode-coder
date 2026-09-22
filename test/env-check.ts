import assert from "node:assert/strict";

/** Fails the run when the test runtime is not the architecture CI expects. */
export default function checkEnv(): void {
	const expected = process.env.EXPECTED_ARCH?.toLowerCase();
	if (!expected) {
		return;
	}
	assert.equal(
		process.arch,
		expected,
		`Test runtime architecture is ${process.arch}, but CI expects ${expected}`,
	);
}
