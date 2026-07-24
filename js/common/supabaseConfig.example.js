/*
 * Copia este ficheiro para js/common/supabaseConfig.js e inclui-o no HTML antes de js/common/api.js,
 * ou define estas variáveis directamente num script inline.
 *
 * ATENÇÃO:
 * - Usa aqui apenas a chave pública anon/publishable.
 * - Nunca coloques sb_secret ou service_role no front-end.
 */
window.TRAGO_SUPABASE_URL = 'https://kxpfuenotwqxmtcfbyid.supabase.co';
window.TRAGO_SUPABASE_ANON_KEY = 'sb_publishable_kJqJXmIiEVDKDKGIcZjXLQ_OYAwl-EX';

// Opcional: browser key restrita por domínio para Google Maps JavaScript + Places API.
// Geocoding gratuito: não precisa de chave Google no front-end; o backend usa TRAGO_ORS_API_KEY nas Edge Function Secrets.
