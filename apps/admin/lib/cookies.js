// Cookie names shared between edge middleware and the Node auth layer —
// one spelling, or a rename desyncs them into a redirect loop.
export const SESSION_COOKIE = 'ucc_admin_id_token';
export const ACCESS_COOKIE = 'ucc_admin_access_token'; // self-service Cognito calls (/profile)
export const PKCE_COOKIE = 'ucc_admin_pkce';
