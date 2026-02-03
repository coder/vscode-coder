// IPC Protocol - Type-safe webview communication
export {
	defineCommand,
	defineNotification,
	defineRequest,
	type DataOf,
	type IpcCommand,
	type IpcMessageBase,
	type IpcNotification,
	type IpcRequest,
	type IpcResponse,
	type ParamsOf,
	type ResponseOf,
} from "./protocol";

export { useIpc, type UseIpcOptions } from "./useIpc";
