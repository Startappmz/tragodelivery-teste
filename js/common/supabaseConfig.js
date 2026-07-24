/*
 * Configuração pública do Supabase para o front-end.
 *
 * Estes valores podem ficar no front-end porque são a URL do projecto
 * e a chave pública publishable/anon.
 *
 * NÃO uses aqui sb_secret nem service_role.
 */
window.TRAGO_SUPABASE_URL = 'https://kxpfuenotwqxmtcfbyid.supabase.co';
window.TRAGO_SUPABASE_ANON_KEY = 'sb_publishable_kJqJXmIiEVDKDKGIcZjXLQ_OYAwl-EX';

// Opcional: chave pública restrita do Google Maps JavaScript/Places API.

// Opcional: Client ID público do Google Identity Services para login/cadastro do cliente.
// Exemplo: window.TRAGO_GOOGLE_CLIENT_ID = 'SEU_CLIENT_ID.apps.googleusercontent.com';
window.TRAGO_GOOGLE_CLIENT_ID = window.TRAGO_GOOGLE_CLIENT_ID || '';
