export interface ClientRegistrationRequest {
	redirect_uris: string[];
	token_endpoint_auth_method: "client_secret_post";
	application_type: "native" | "web";
	grant_types: string[];
	response_types: string[];
	client_name?: string;
	client_uri?: string;
	scope?: string[];
}

export interface ClientRegistrationResponse {
	client_id: string;
	client_secret?: string;
	client_id_issued_at?: number;
	client_secret_expires_at?: number;
	redirect_uris: string[];
	grant_types: string[];
}

export interface OAuthServerMetadata {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	registration_endpoint?: string;
	response_types_supported?: string[];
	grant_types_supported?: string[];
	code_challenge_methods_supported?: string[];
	scopes_supported?: string[];
	token_endpoint_auth_methods_supported?: string[];
}

export interface TokenResponse {
	access_token: string;
	token_type: string;
	expires_in?: number;
	refresh_token?: string;
	scope?: string;
}

export interface AuthorizationRequestParams {
	client_id: string;
	response_type: "code";
	redirect_uri: string;
	scope: string;
	state: string;
	code_challenge: string;
	code_challenge_method: "S256";
}

export interface TokenRequestParams {
	grant_type: "authorization_code";
	code: string;
	redirect_uri: string;
	client_id: string;
	code_verifier: string;
	client_secret?: string;
}
