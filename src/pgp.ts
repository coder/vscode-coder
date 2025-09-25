import { createReadStream, promises as fs } from "fs";
import * as openpgp from "openpgp";
import * as path from "path";
import { Readable } from "stream";

import { errToStr } from "./api/api-helper";
import { type Logger } from "./logging/logger";

export type Key = openpgp.Key;

export enum VerificationErrorCode {
	/* The signature does not match. */
	Invalid = "Invalid",
	/* Failed to read the signature or the file to verify. */
	Read = "Read",
}

export class VerificationError extends Error {
	constructor(
		public readonly code: VerificationErrorCode,
		message: string,
	) {
		super(message);
	}

	summary(): string {
		switch (this.code) {
			case VerificationErrorCode.Invalid:
				return "Signature does not match";
			case VerificationErrorCode.Read:
				return "Failed to read signature";
		}
	}
}

/**
 * Return the public keys bundled with the plugin.
 */
export async function readPublicKeys(logger?: Logger): Promise<Key[]> {
	const keyFile = path.join(__dirname, "../pgp-public.key");
	logger?.info("Reading public key", keyFile);
	const armoredKeys = await fs.readFile(keyFile, "utf8");
	return openpgp.readKeys({ armoredKeys });
}

/**
 * Given public keys, a path to a file to verify, and a path to a detached
 * signature, verify the file's signature.  Throw VerificationError if invalid
 * or unable to validate.
 */
export async function verifySignature(
	publicKeys: openpgp.Key[],
	cliPath: string,
	signaturePath: string,
	logger?: Logger,
): Promise<void> {
	try {
		logger?.info("Reading signature", signaturePath);
		const armoredSignature = await fs.readFile(signaturePath, "utf8");
		const signature = await openpgp.readSignature({ armoredSignature });

		logger?.info("Verifying signature of", cliPath);
		const message = await openpgp.createMessage({
			// openpgpjs only accepts web readable streams.
			binary: Readable.toWeb(createReadStream(cliPath)),
		});
		const verificationResult = await openpgp.verify({
			message,
			signature,
			verificationKeys: publicKeys,
		});
		for await (const _ of verificationResult.data) {
			// The docs indicate this data must be consumed; it triggers the
			// verification of the data.
		}
		try {
			const { verified } = verificationResult.signatures[0];
			await verified; // Throws on invalid signature.
			logger?.info("Binary signature matches");
		} catch (e) {
			const error = `Unable to verify the authenticity of the binary: ${errToStr(e)}. The binary may have been tampered with.`;
			logger?.warn(error);
			throw new VerificationError(VerificationErrorCode.Invalid, error);
		}
	} catch (e) {
		const error = `Failed to read signature or binary: ${errToStr(e)}.`;
		logger?.warn(error);
		throw new VerificationError(VerificationErrorCode.Read, error);
	}
}
