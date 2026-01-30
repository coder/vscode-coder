// Message passing types - simple generic interface
export interface WebviewMessage<T = unknown> {
	type: string;
	data?: T;
}
