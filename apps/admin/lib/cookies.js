// Cookie names shared between edge middleware and the Node auth layer —
// one spelling, or a rename desyncs them into a redirect loop.
export const SESSION_COOKIE = 'ucc_admin_id_token';
export const PKCE_COOKIE = 'ucc_admin_pkce';
