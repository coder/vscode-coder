import { emitTimed, type EmitFn } from "./emit";

/** Correlation handle: parent and all child phase events share one `traceId`. */
export class Trace {
	public static readonly NOOP = new Trace("", "", () => {
		/* Off-mode tracer; phases run their fn but emit nothing. */
	});

	constructor(
		private readonly parentEventName: string,
		public readonly traceId: string,
		private readonly emit: EmitFn,
	) {}

	phase<T>(
		phaseName: string,
		fn: () => Promise<T>,
		properties: Record<string, string> = {},
	): Promise<T> {
		return emitTimed(
			this.emit,
			`${this.parentEventName}.phase`,
			fn,
			{ ...properties, phase: phaseName },
			this.traceId,
		);
	}
}
