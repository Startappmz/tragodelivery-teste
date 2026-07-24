const bcrypt = require('bcryptjs');

async function hashMyPassword() {
    const password = 'admin123'; // Defina a senha do seu admin aqui
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    console.log('--- HASH PARA O ADMIN ---');
    console.log('Senha Original:', password);
    console.log('O seu HASH (para colar na tabela users do Supabase) é:');
    console.log(hash);
    console.log('---------------------------');
}

hashMyPassword();