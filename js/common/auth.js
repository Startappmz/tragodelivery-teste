/*
 * Ficheiro: js/common/auth.js
 *
 * Versão CORRIGIDA E BLINDADA
 * - Protecção contra múltiplos logins
 * - Tratamento de erro 429 (rate limit)
 * - Evita loops e estados inconsistentes
 * - CORREÇÃO: Apenas UMA função getAuthHeaders, sempre com role explícito
 */

let loginInProgress = false;

/**
 * Verifica se um utilizador (admin ou motorista) está autenticado.
 */
function checkAuth(role) {
    let token = null;
    let loginPage = 'login.html';

    if (role === 'admin') {
        token = localStorage.getItem('adminToken');
        loginPage = 'login.html';
    } else if (role === 'driver') {
        token = localStorage.getItem('driverToken');
        loginPage = 'login-motorista.html';
    } else {
        console.error('checkAuth: role inválido:', role);
        return false;
    }

    const tokenInvalid =
        !token ||
        token === 'undefined' ||
        token === 'null' ||
        token.trim() === '';

    if (tokenInvalid) {
        console.warn('Token inválido → redirecionando');

        setTimeout(() => {
            if (!window.location.pathname.includes(loginPage)) {
                window.location.replace(loginPage);
            }
        }, 50);

        return false;
    }

    return true;
}

/**
 * Obtém o token correto baseado no role passado como parâmetro.
 * @param {string} role - 'admin' ou 'driver'
 * @returns {string|null} O token ou null
 */
function getAuthToken(role) {
    if (role === 'admin') {
        return localStorage.getItem('adminToken');
    } else if (role === 'driver') {
        return localStorage.getItem('driverToken');
    }
    return null;
}

/**
 * Headers de autenticação seguros.
 * @param {string} role - 'admin' ou 'driver' (obrigatório)
 * @returns {Object} Headers com Authorization
 */
function getAuthHeaders(role) {
    const token = getAuthToken(role);
    if (!token) return {};
    return {
        'Authorization': `Bearer ${token}`
    };
}

/**
 * Processa login (admin ou motorista).
 */
async function handleLogin(e, role) {
    e.preventDefault();

    if (loginInProgress) return;
    loginInProgress = true;

    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');

    const email = form.querySelector('#email').value.trim();
    const password = form.querySelector('#password').value;

    submitButton.disabled = true;
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A entrar...';

    try {
        const response = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, role })
        });

        // RATE LIMIT → parar tudo
        if (response.status === 429) {
            throw new Error(
                'Demasiadas tentativas a partir deste IP. Aguarde alguns minutos antes de tentar novamente.'
            );
        }

        const data = await readJsonResponse(response);

        if (!response.ok) {
            throw new Error(data.message || 'Erro no login');
        }

        // Guardar token conforme o role
        if (role === 'admin') {
            const token =
    data.token ||
    data.accessToken ||
    data.jwt ||
    data?.data?.token ||
    data?.user?.token;

if (!token) {
    console.error('A resposta de autenticação não incluiu um token.');
    throw new Error('Falha de autenticação: token não recebido do servidor.');
}

localStorage.setItem('adminToken', token);
            localStorage.setItem('adminName', data.user?.nome || 'Admin');
            window.location.replace('index.html');
        } else {
            const token =
    data.token ||
    data.accessToken ||
    data.jwt ||
    data?.data?.token ||
    data?.user?.token;

if (!token) {
    console.error('A resposta de autenticação não incluiu um token.');
    throw new Error('Falha de autenticação: token não recebido do servidor.');
}

localStorage.setItem('driverToken', token);
            localStorage.setItem('driverName', data.user?.nome || 'Motorista');
            localStorage.setItem('driverId', data.user?._id || data.user?.id || '');
            window.location.replace('painel-de-entrega.html');
        }

    } catch (error) {
        console.error('Falha no login:', error);

        if (typeof showCustomAlert === 'function') {
            showCustomAlert('Erro de Login', error.message, 'error');
        } else if (window.TragoFeedback) {
            window.TragoFeedback.alert({ title: 'Erro de login', message: error.message, type: 'error' });
        } else {
            console.error(`[TraGo] Erro de login: ${error.message}`);
        }

    } finally {
        loginInProgress = false;
        submitButton.disabled = false;
        submitButton.innerHTML = role === 'admin' ? 'Entrar' : 'Iniciar Turno';
    }
}


/* --- Restauração de password por email nos logins --- */
let passwordResetRequestInProgress = false;
let passwordResetConfirmInProgress = false;

function setPasswordResetStep(step) {
    const confirmSection = document.getElementById('reset-confirm-section');
    const requestActions = document.querySelector('.reset-request-actions');
    const instructions = document.getElementById('reset-instructions');
    const emailInput = document.getElementById('reset-email');
    const codeInput = document.getElementById('reset-code');
    const passwordInput = document.getElementById('reset-new-password');

    const isConfirm = step === 'confirm';
    confirmSection?.classList.toggle('hidden', !isConfirm);
    requestActions?.classList.toggle('hidden', isConfirm);

    if (emailInput) emailInput.readOnly = isConfirm;
    if (codeInput) codeInput.required = isConfirm;
    if (passwordInput) passwordInput.required = isConfirm;

    if (instructions) {
        instructions.textContent = isConfirm
            ? 'Enviámos um código temporário para o email indicado. Introduza o código e defina a nova password.'
            : 'Introduza o email da conta. Enviaremos um código temporário para esse email.';
    }
}

function openPasswordResetModal(role) {
    const modal = document.getElementById('password-reset-modal');
    const roleInput = document.getElementById('reset-role');
    const emailInput = document.getElementById('reset-email');
    const form = document.getElementById('password-reset-form');

    if (!modal || !roleInput || !form) return;

    form.reset();
    roleInput.value = role;
    setPasswordResetStep('request');

    const loginEmail = document.getElementById('email')?.value?.trim();
    if (loginEmail && emailInput) emailInput.value = loginEmail;

    modal.classList.remove('hidden');
    setTimeout(() => emailInput?.focus?.(), 40);
}

function closePasswordResetModal() {
    const modal = document.getElementById('password-reset-modal');
    const form = document.getElementById('password-reset-form');
    if (form) form.reset();
    setPasswordResetStep('request');
    if (modal) modal.classList.add('hidden');
}

async function requestPasswordResetCode() {
    if (passwordResetRequestInProgress) return;

    const role = document.getElementById('reset-role')?.value;
    const email = document.getElementById('reset-email')?.value?.trim();
    const button = document.getElementById('reset-request-code-btn');

    if (!role || !email) {
        showCustomAlert('Dados em falta', 'Introduza o email da conta para receber o código.', 'error');
        return;
    }

    passwordResetRequestInProgress = true;
    const originalHtml = button?.innerHTML;
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A enviar...';
    }

    try {
        const response = await fetch(`${API_URL}/api/auth/request-password-reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, role })
        });

        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Não foi possível enviar o código de restauração.');

        setPasswordResetStep('confirm');
        document.getElementById('reset-code')?.focus?.();
        showCustomAlert('Código enviado', data.message || 'Se o email existir, receberá um código de restauração.', 'success');
    } catch (error) {
        console.error('Falha ao pedir código de restauração:', error);
        showCustomAlert('Erro', error.message || 'Erro ao enviar código de restauração.', 'error');
    } finally {
        passwordResetRequestInProgress = false;
        if (button) {
            button.disabled = false;
            button.innerHTML = originalHtml || 'Enviar código';
        }
    }
}

async function handlePasswordReset(event) {
    event.preventDefault();
    if (passwordResetConfirmInProgress) return;

    const form = event.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const role = document.getElementById('reset-role')?.value || form.dataset.resetRole;
    const email = document.getElementById('reset-email')?.value?.trim();
    const code = document.getElementById('reset-code')?.value?.trim();
    const newPassword = document.getElementById('reset-new-password')?.value;

    if (!role || !email || !code || !newPassword) {
        showCustomAlert('Dados em falta', 'Preencha o email, o código recebido e a nova password.', 'error');
        return;
    }

    if (String(newPassword).length < 8) {
        showCustomAlert('Password fraca', 'A nova password deve ter pelo menos 8 caracteres.', 'error');
        return;
    }

    passwordResetConfirmInProgress = true;
    const originalHtml = submitButton?.innerHTML;
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> A actualizar...';
    }

    try {
        const response = await fetch(`${API_URL}/api/auth/confirm-password-reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, role, code, newPassword })
        });

        const data = await readJsonResponse(response);
        if (!response.ok) throw new Error(data.message || 'Não foi possível restaurar a password.');

        closePasswordResetModal();
        showCustomAlert('Password actualizada', data.message || 'A password foi actualizada com sucesso. Já pode iniciar sessão.', 'success');
    } catch (error) {
        console.error('Falha ao confirmar restauração de password:', error);
        showCustomAlert('Erro', error.message || 'Erro ao restaurar password.', 'error');
    } finally {
        passwordResetConfirmInProgress = false;
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.innerHTML = originalHtml || 'Actualizar password';
        }
    }
}

function installPasswordResetHandlers() {
    document.querySelectorAll('.btn-open-password-reset').forEach((button) => {
        button.addEventListener('click', () => openPasswordResetModal(button.dataset.resetRole || 'admin'));
    });

    document.getElementById('reset-request-code-btn')?.addEventListener('click', requestPasswordResetCode);

    const form = document.getElementById('password-reset-form');
    if (form) form.addEventListener('submit', handlePasswordReset);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installPasswordResetHandlers);
} else {
    installPasswordResetHandlers();
}

let auth401ValidationPromise = null;

async function handle401Safely(role) {
    const tokenKey = role === 'admin' ? 'adminToken' : 'driverToken';
    const token = localStorage.getItem(tokenKey);

    if (!token) {
        await handleLogout(role);
        return false;
    }

    if (auth401ValidationPromise) return auth401ValidationPromise;

    auth401ValidationPromise = (async () => {
        try {
            const response = await fetch(`${API_URL}/api/auth/me`, {
                method: 'GET',
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store'
            });
            if (response.status === 401 || response.status === 403) {
                await handleLogout(role);
                return false;
            }
            if (!response.ok) {
                console.warn(`A validação da sessão ${role} respondeu com ${response.status}; a sessão local foi preservada.`);
                return true;
            }
            return true;
        } catch (error) {
            console.warn(`Não foi possível validar a sessão ${role}; a sessão local foi preservada para nova tentativa.`, error);
            return true;
        } finally {
            auth401ValidationPromise = null;
        }
    })();

    return auth401ValidationPromise;
}

/**
 * Logout seguro.
 * Para motorista, força offline no backend antes de limpar o token.
 */
let logoutInProgress = false;
async function handleLogout(role) {
    if (logoutInProgress) return;
    logoutInProgress = true;

    const token = getAuthToken(role);
    const loginPage = role === 'admin' ? 'login.html' : 'login-motorista.html';

    try {
        if (role === 'driver') {
            await Promise.race([
                window.TragoDriverTracking?.shutdown?.({ keepalive: false }) || Promise.resolve(),
                new Promise((resolve) => setTimeout(resolve, 1800))
            ]);
        }

        if (token) {
            await Promise.race([
                fetch(`${API_URL}/api/auth/logout`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                    keepalive: true
                }).catch(() => null),
                new Promise((resolve) => setTimeout(resolve, 1500))
            ]);
        }
    } finally {
        if (role === 'admin') {
            localStorage.removeItem('adminToken');
            localStorage.removeItem('adminName');
        } else {
            localStorage.removeItem('driverToken');
            localStorage.removeItem('driverName');
            localStorage.removeItem('driverId');
        }
        window.location.replace(loginPage);
    }
}
