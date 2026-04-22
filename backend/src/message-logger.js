/**
 * message-logger.js
 *
 * Registra toda mensagem enviada (WhatsApp e Google Chat) no banco.
 * Usa instância própria do PrismaClient para não depender do req.app.
 * Falhas de log são silenciadas — nunca quebram a notificação principal.
 */

const { PrismaClient } = require('@prisma/client');

let _prisma = null;
function db() {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}

async function logMessage({ channel, to, toName, body, status = 'sent', error = null }) {
  try {
    await db().messageLog.create({
      data: { channel, to: String(to), toName: toName || null, body, status, error },
    });
  } catch {
    // silencia — log nunca pode derrubar a notificação
  }
}

module.exports = { logMessage };
