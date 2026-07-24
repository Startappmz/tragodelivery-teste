const REQUIRED_TABLES = [
  'users',
  'vehicles',
  'driver_profiles',
  'clients',
  'orders',
  'trips',
  'expenses',
  'company_costs'
];

const getSupabaseConfig = () => {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!url) {
    throw new Error('SUPABASE_URL não está definido nas variáveis de ambiente.');
  }

  if (!key) {
    throw new Error('SUPABASE_SECRET_KEY não está definido nas variáveis de ambiente.');
  }

  return { url, key };
};

const getHeaders = (extra = {}) => {
  const { key } = getSupabaseConfig();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra
  };
};

const buildUrl = (path) => {
  const { url } = getSupabaseConfig();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${url}${normalizedPath}`;
};

const parseSupabaseError = async (response) => {
  const text = await response.text().catch(() => '');
  try {
    const json = JSON.parse(text);
    return json.message || json.error || text || response.statusText;
  } catch (_error) {
    return text || response.statusText;
  }
};

const supabaseRequest = async (path, options = {}) => {
  const response = await fetch(buildUrl(path), {
    ...options,
    headers: getHeaders(options.headers || {})
  });

  if (!response.ok) {
    const message = await parseSupabaseError(response);
    const error = new Error(`Supabase REST ${response.status}: ${message}`);
    error.statusCode = response.status;
    throw error;
  }

  if (response.status === 204) return null;

  const text = await response.text();
  return text ? JSON.parse(text) : null;
};

const testSupabaseConnection = async () => {
  for (const table of REQUIRED_TABLES) {
    await supabaseRequest(`/rest/v1/${table}?select=id&limit=1`, {
      method: 'GET',
      headers: { Prefer: 'count=exact' }
    });
  }
};

module.exports = {
  getSupabaseConfig,
  supabaseRequest,
  testSupabaseConnection
};
