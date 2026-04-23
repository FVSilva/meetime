/**
 * message-logger.js
 *
 * Registra toda mensagem enviada (WhatsApp e Google Chat) no banco.
 * Usa instância própria do PrismaClient para não depender do req.app.
 * Falhas de log são silenciadas — nunca quebram a notificação principal.
 */

// Reutiliza a instância do prisma do index.js — evita múltiplas conexões PostgreSQL
let _prisma = null;

function init(prismaInstance) {
  _prisma = prismaInstance;
}

async function logMessage({ channel, to, toName, body, status = 'sent', error = null }) {
  if (!_prisma) return; // não inicializado ainda — silencia
  try {
    await _prisma.messageLog.create({
      data: { channel, to: String(to), toName: toName || null, body, status, error },
    });
  } catch {
    // silencia — log nunca pode derrubar a notificação
  }
}

module.exports = { init, logMessage };
