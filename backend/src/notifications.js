const axios = require('axios');
const { logMessage } = require('./message-logger');

// ── Evolution API (WhatsApp) ─────────────────────────────────────────────────

async function sendWhatsApp(phone, message) {
  const { EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE } = process.env;

  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY || !EVOLUTION_INSTANCE) {
    console.warn('[WhatsApp] Evolution API não configurada (EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE).');
    return;
  }

  const normalized = phone.replace(/\D/g, '');

  try {
    await axios.post(
      `${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
      {
        number: `${normalized}@s.whatsapp.net`,
        text: message,
        delay: 1000,
      },
      {
        headers: {
          apikey: EVOLUTION_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`[WhatsApp] ✓ Enviado para ${normalized}`);
    logMessage({ channel: 'whatsapp', to: normalized, body: message, status: 'sent' });
  } catch (err) {
    const errMsg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`[WhatsApp] ✗ Erro (${normalized}):`, errMsg);
    logMessage({ channel: 'whatsapp', to: normalized, body: message, status: 'failed', error: errMsg });
  }
}

// ── Google Chat ──────────────────────────────────────────────────────────────

async function sendGoogleChat(text) {
  const url = process.env.GOOGLE_CHAT_WEBHOOK_URL;
  if (!url) return;
  try {
    await axios.post(url, { text });
    logMessage({ channel: 'gchat', to: 'Google Chat', toName: 'Google Chat', body: text, status: 'sent' });
  } catch (err) {
    const errMsg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error('[GoogleChat] Erro:', errMsg);
    logMessage({ channel: 'gchat', to: 'Google Chat', toName: 'Google Chat', body: text, status: 'failed', error: errMsg });
  }
}

// ── Lógica de destinatários ──────────────────────────────────────────────────

/**
 * Decide quais usuários recebem a notificação para um dado lead:
 *
 *  - ADMIN → recebe TODOS os leads
 *  - SDR   → recebe apenas leads onde o ownerEmail bate com seu email
 *
 * Filtra apenas usuários ativos.
 */
// Normaliza: minúsculas + sem acento + sem caracteres especiais
function norm(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacríticos (ê→e, ã→a etc.)
    .replace(/[^a-z0-9\s]/g, '')     // remove qualquer caractere especial restante (^, °, etc.)
    .replace(/\s+/g, ' ')
    .trim();
}

// Verifica se dois nomes batem com várias estratégias:
// 1. Igualdade exata (normalizada)
// 2. Um começa com o outro (ex: "Rian Lima" ⊂ "Rian Lima Roda")
// 3. Primeiro nome + sobrenome (primeiras 2 palavras batem)
function namesMatch(a, b) {
  const na = norm(a);
  const nb = norm(b);

  if (!na || !nb) return false;

  // Estratégia 1: exato
  if (na === nb) return true;

  // Estratégia 2: prefixo (um contém o outro no início)
  if (na.startsWith(nb) || nb.startsWith(na)) return true;

  // Estratégia 3: primeiras 2 palavras batem (ex: "Kauê Brito" vs "Kauê Brito de Souza")
  const wordsA = na.split(' ').slice(0, 2).join(' ');
  const wordsB = nb.split(' ').slice(0, 2).join(' ');
  if (wordsA.length > 4 && wordsA === wordsB) return true;

  // Estratégia 4: primeiro nome bate E tem pelo menos 5 chars (evita falsos positivos)
  const firstA = na.split(' ')[0];
  const firstB = nb.split(' ')[0];
  if (firstA.length >= 5 && firstA === firstB) return true;

  return false;
}

async function resolveRecipients(prisma, ownerEmail, assignedTo) {
  const allUsers = await prisma.user.findMany({ where: { active: true } });

  if (allUsers.length === 0) {
    const phones = (process.env.NOTIF_PHONES || '').split(',').map(p => p.trim()).filter(Boolean);
    return phones.map(phone => ({ phone, source: 'env' }));
  }

  const recipients = [];
  let sdrFound = false;

  for (const user of allUsers) {
    if (user.role === 'admin') {
      recipients.push({ phone: user.phone, name: user.name, role: 'admin' });
    } else {
      const matchEmail = ownerEmail && norm(user.email) === norm(ownerEmail);
      const matchName  = !matchEmail && assignedTo && namesMatch(user.name, assignedTo);

      if (matchEmail || matchName) {
        recipients.push({ phone: user.phone, name: user.name, role: 'sdr' });
        sdrFound = true;
        console.log(`[Notif] ✓ SDR encontrado: "${user.name}" via ${matchEmail ? 'email' : 'nome'}`);
      }
    }
  }

  // Log de debug quando não encontra SDR — ajuda identificar problemas de nome
  if (!sdrFound && assignedTo) {
    const sdrs = allUsers.filter(u => u.role === 'sdr').map(u => `"${u.name}"`).join(', ');
    console.warn(`[Notif] ⚠️  Nenhum SDR encontrado para assignedTo="${assignedTo}". SDRs cadastrados: ${sdrs}`);
  }

  return recipients;
}

// ── Mensagens ────────────────────────────────────────────────────────────────

function buildLeadMessage(lead, recipientName = '', cadence = null) {
  const greeting = recipientName ? `Olá *${recipientName}*! ` : '';
  return [
    `🔔 ${greeting}*Novo Lead no Meetime!*`,
    ``,
    `👤 *${lead.name}*`,
    lead.company    ? `🏢 ${lead.company}`              : null,
    lead.email      ? `📧 ${lead.email}`                : null,
    lead.phone      ? `📱 ${lead.phone}`                : null,
    lead.assignedTo ? `👥 Resp.: *${lead.assignedTo}*`  : null,
    cadence         ? `📋 Cadência: ${cadence}`          : null,
    lead.source     ? `📂 Base: ${lead.source}`          : null,
    ``,
    `⚡ Faça o primeiro contato agora!`,
    `🔗 ${lead.publicUrl || 'https://app.meetime.com.br/prospection'}`,
  ].filter(l => l !== null).join('\n');
}

function buildActivityMessage(activity, lead, recipientName = '') {
  const greeting = recipientName ? `Olá *${recipientName}*! ` : '';
  return [
    `📋 ${greeting}*Nova Atividade no Meetime*`,
    ``,
    `Lead: *${lead.name}*`,
    `Tipo: ${activity.type}`,
    `Título: ${activity.title}`,
    activity.scheduledAt
      ? `Agendado: ${new Date(activity.scheduledAt).toLocaleString('pt-BR')}`
      : null,
  ].filter(l => l !== null).join('\n');
}

// ── Notificações públicas ────────────────────────────────────────────────────

async function notifyNewLead(lead, prisma, cadence = null) {
  const recipients = await resolveRecipients(prisma, lead.ownerEmail, lead.assignedTo);

  console.log(`[Notif] Novo lead "${lead.name}" → ${recipients.length} destinatário(s)`);

  const tasks = [sendGoogleChat(buildLeadMessage(lead, '', cadence))];
  for (const r of recipients) {
    tasks.push(sendWhatsApp(r.phone, buildLeadMessage(lead, r.name, cadence)));
  }

  await Promise.allSettled(tasks);
}

async function notifyNewActivity(activity, lead, prisma) {
  const recipients = await resolveRecipients(prisma, lead.ownerEmail, lead.assignedTo);

  console.log(`[Notif] Nova atividade "${activity.title}" → ${recipients.length} destinatário(s)`);

  const tasks = [];
  for (const r of recipients) {
    tasks.push(sendWhatsApp(r.phone, buildActivityMessage(activity, lead, r.name)));
  }

  await Promise.allSettled(tasks);
}

module.exports = { notifyNewLead, notifyNewActivity, sendWhatsApp, sendGoogleChat };
