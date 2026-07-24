(function exposeTragoHttp(global) {
  'use strict';

  async function readJsonResponse(response, fallback = {}) {
    if (!response || typeof response.text !== 'function') {
      throw new TypeError('Resposta HTTP inválida.');
    }

    let text;
    try {
      text = await response.text();
    } catch (error) {
      const failure = new Error('A resposta do servidor não pôde ser lida. Actualize a página e tente novamente.');
      failure.status = Number(response.status || 0);
      failure.cause = error;
      throw failure;
    }

    if (!String(text || '').trim()) return fallback;

    try {
      return JSON.parse(text);
    } catch (error) {
      const failure = new Error(`O servidor devolveu uma resposta inválida${response.status ? ` (${response.status})` : ''}.`);
      failure.status = Number(response.status || 0);
      failure.cause = error;
      throw failure;
    }
  }

  global.TragoHttp = Object.freeze({ readJsonResponse });
  global.readJsonResponse = readJsonResponse;
})(window);
