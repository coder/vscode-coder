import type { InternalAxiosRequestConfig } from "axios";

export enum HttpClientLogLevel {
	NONE,
	BASIC,
	HEADERS,
	BODY,
}

export interface RequestMeta {
	requestId: string;
	startedAt: number;
}

export type RequestConfigWithMeta = InternalAxiosRequestConfig & {
	metadata?: RequestMeta;
	rawRequestSize?: number;
	rawResponseSize?: number;
};
