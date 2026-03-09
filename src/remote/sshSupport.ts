import * as childProcess from "child_process";

/** Check if the local SSH installation supports the `SetEnv` directive. */
export function sshSupportsSetEnv(): boolean {
	try {
		// Run `ssh -V` to get the version string.
		const spawned = childProcess.spawnSync("ssh", ["-V"]);
		// The version string outputs to stderr.
		return sshVersionSupportsSetEnv(spawned.stderr.toString().trim());
	} catch {
		return false;
	}
}

/**
 * Check if an SSH version string supports the `SetEnv` directive.
 * Requires OpenSSH 7.8 or later.
 */
export function sshVersionSupportsSetEnv(sshVersionString: string): boolean {
	const match = /OpenSSH.*_([\d.]+)[^,]*/.exec(sshVersionString);
	if (match?.[1]) {
		const installedVersion = match[1];
		const parts = installedVersion.split(".");
		if (parts.length < 2) {
			return false;
		}
		// 7.8 is the first version that supports SetEnv
		const major = Number.parseInt(parts[0], 10);
		const minor = Number.parseInt(parts[1], 10);
		if (major < 7) {
			return false;
		}
		if (major === 7 && minor < 8) {
			return false;
		}
		return true;
	}
	return false;
}

/**
 * Compute the effective SSH properties for a given host by evaluating
 * all matching Host blocks in the provided SSH config.
 */
export function computeSshProperties(
	host: string,
	config: string,
): Record<string, string> {
	let currentConfig:
		| {
				Host: string;
				properties: Record<string, string>;
		  }
		| undefined;
	const configs: Array<typeof currentConfig> = [];
	config.split("\n").forEach((line) => {
		line = line.trim();
		if (line === "") {
			return;
		}
		// The capture group here will include the captured portion in the array
		// which we need to join them back up with their original values.  The first
		// separate is ignored since it splits the key and value but is not part of
		// the value itself.
		const [key, _, ...valueParts] = line.split(/(\s+|=)/);
		if (key.startsWith("#")) {
			// Ignore comments!
			return;
		}
		if (key === "Host") {
			if (currentConfig) {
				configs.push(currentConfig);
			}
			currentConfig = {
				Host: valueParts.join(""),
				properties: {},
			};
			return;
		}
		if (!currentConfig) {
			return;
		}
		currentConfig.properties[key] = valueParts.join("");
	});
	if (currentConfig) {
		configs.push(currentConfig);
	}

	const merged: Record<string, string> = {};
	configs.reverse().forEach((config) => {
		if (!config) {
			return;
		}

		// In OpenSSH * matches any number of characters and ? matches exactly one.
		if (
			!new RegExp(
				"^" +
					config?.Host.replace(/\./g, "\\.")
						.replace(/\*/g, ".*")
						.replace(/\?/g, ".") +
					"$",
			).test(host)
		) {
			return;
		}
		Object.assign(merged, config.properties);
	});
	return merged;
}
