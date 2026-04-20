const axios = require('axios');

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
  } catch (err) {
    console.error(`[WhatsApp] ✗ Erro (${normalized}):`, err.response?.data || err.message);
  }
}

// ── Google Chat ──────────────────────────────────────────────────────────────

async function sendGoogleChat(text) {
  const url = process.env.GOOGLE_CHAT_WEBHOOK_URL;
  if (!url) return;
  try {
    await axios.post(url, { text });
  } catch (err) {
    console.error('[GoogleChat] Erro:', err.response?.data || err.message);
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
async function resolveRecipients(prisma, ownerEmail) {
  const allUsers = await prisma.user.findMany({ where: { active: true } });

  if (allUsers.length === 0) {
    // Fallback: usa NOTIF_PHONES do .env (compatibilidade com a config antiga)
    const phones = (process.env.NOTIF_PHONES || '').split(',').map(p => p.trim()).filter(Boolean);
    return phones.map(phone => ({ phone, source: 'env' }));
  }

  const recipients = [];

  for (const user of allUsers) {
    if (user.role === 'admin') {
      // Admins recebem tudo
      recipients.push({ phone: user.phone, name: user.name, role: 'admin' });
    } else if (ownerEmail && user.email.toLowerCase() === ownerEmail.toLowerCase()) {
      // SDR recebe apenas se for o dono do lead
      recipients.push({ phone: user.phone, name: user.name, role: 'sdr' });
    }
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
  const recipients = await resolveRecipients(prisma, lead.ownerEmail);

  console.log(`[Notif] Novo lead "${lead.name}" → ${recipients.length} destinatário(s)`);

  const tasks = [sendGoogleChat(buildLeadMessage(lead, '', cadence))];
  for (const r of recipients) {
    tasks.push(sendWhatsApp(r.phone, buildLeadMessage(lead, r.name, cadence)));
  }

  await Promise.allSettled(tasks);
}

async function notifyNewActivity(activity, lead, prisma) {
  const recipients = await resolveRecipients(prisma, lead.ownerEmail);

  console.log(`[Notif] Nova atividade "${activity.title}" → ${recipients.length} destinatário(s)`);

  const tasks = [];
  for (const r of recipients) {
    tasks.push(sendWhatsApp(r.phone, buildActivityMessage(activity, lead, r.name)));
  }

  await Promise.allSettled(tasks);
}

module.exports = { notifyNewLead, notifyNewActivity, sendWhatsApp, sendGoogleChat };
