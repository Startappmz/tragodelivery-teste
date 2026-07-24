/*
 * Ficheiro: js/common/api.js
 * Configuração central da API.
 *
 * Fase 2 Supabase:
 * - Se definires window.TRAGO_API_URL, esse valor tem prioridade.
 * - Caso contrário, se definires window.TRAGO_SUPABASE_URL, o sistema chama:
 *   https://PROJECT_REF.supabase.co/functions/v1/api
 * - Em ambiente local Supabase CLI, usa:
 *   http://localhost:54321/functions/v1/api
 *
 * Exemplo no HTML, antes deste ficheiro:
 * <script>
 *   window.TRAGO_SUPABASE_URL = 'https://SEU_PROJECT_REF.supabase.co';
 *   window.TRAGO_SUPABASE_ANON_KEY = 'SUA_CHAVE_PUBLIC_ANON_OU_PUBLISHABLE';
 * </script>
 */

window.TRAGO_SUPABASE_URL = window.TRAGO_SUPABASE_URL || '';
window.TRAGO_SUPABASE_ANON_KEY = window.TRAGO_SUPABASE_ANON_KEY || '';

const normalizedSupabaseUrl = String(window.TRAGO_SUPABASE_URL || '').replace(/\/$/, '');

const API_URL = window.TRAGO_API_URL || (
  normalizedSupabaseUrl
    ? `${normalizedSupabaseUrl}/functions/v1/api`
    : (['localhost', '127.0.0.1'].includes(window.location.hostname)
      ? 'http://localhost:54321/functions/v1/api'
      : window.location.origin)
);
