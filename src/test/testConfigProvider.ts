import { ConfigProvider } from "../logger";

export class TestConfigProvider implements ConfigProvider {
	private verbose = false;
	private callbacks: Array<() => void> = [];

	setVerbose(verbose: boolean): void {
		if (this.verbose !== verbose) {
			this.verbose = verbose;
			this.callbacks.forEach((cb) => cb());
		}
	}

	getVerbose(): boolean {
		return this.verbose;
	}

	onVerboseChange(callback: () => void): { dispose: () => void } {
		this.callbacks.push(callback);
		return {
			dispose: () => {
				const index = this.callbacks.indexOf(callback);
				if (index >= 0) {
					this.callbacks.splice(index, 1);
				}
			},
		};
	}
}
