const { testSupabaseConnection } = require('./supabase');

const connectDB = async () => {
  try {
    await testSupabaseConnection();
    console.log('Supabase conectado e tabelas principais verificadas.');
  } catch (error) {
    console.error(`Erro de conexão Supabase: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
