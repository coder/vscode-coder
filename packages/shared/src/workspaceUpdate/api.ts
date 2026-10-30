/**
 * Workspace Update API - Type-safe message definitions for the parameter
 * form shown when updating a workspace to the latest template version.
 */

import { defineCommand, defineRequest } from "../ipc/protocol";

import type { DynamicParametersResponse } from "coder/site/src/api/typesGenerated";

import type { ParameterValues, WorkspaceUpdateInit } from "./types";

export const WorkspaceUpdateApi = {
	// Requests
	init: defineRequest<void, WorkspaceUpdateInit>("workspaceUpdate/init"),
	evaluate: defineRequest<ParameterValues, DynamicParametersResponse>(
		"workspaceUpdate/evaluate",
	),
	// Commands
	submit: defineCommand<ParameterValues>("workspaceUpdate/submit"),
	cancel: defineCommand<void>("workspaceUpdate/cancel"),
} as const;
