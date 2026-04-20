/**
 * meetime-sync.js
 *
 * Dois jobs que rodam em background:
 *
 * 1. POLLING DE LEADS (a cada 2 min)
 *    - Busca leads criados após a última verificação via API Meetime
 *    - Salva no banco e notifica WhatsApp + Google Chat + Push
 *
 * 2. MONITOR DE INATIVIDADE (a cada 5 min)
 *    - Verifica leads ativos sem atividade há ≥ 30 min
 *    - Alerta apenas usuários com role=admin
 *    - Evita spam: só re-alerta após 30 min do último alerta
 */

const axios = require('axios');
const { notifyNewLead, sendWhatsApp, sendGoogleChat } = require('./notifications');
const { sendPushToLeadOwner, sendPushToAdmins } = require('./push');

const MEETIME_API_BASE = 'https://api.meetime.com.br/v2';
const POLL_INTERVAL_MS   = 2 * 60 * 1000;  // 2 minutos
const INACTIVITY_MS      = 5 * 60 * 1000;  // checar a cada 5 min
const INACTIVE_THRESHOLD = 30 * 60 * 1000; // 30 minutos sem atividade

// Guarda o timestamp da última checagem de leads
let lastLeadCheck = new Date(Date.now() - POLL_INTERVAL_MS);

// ── Cliente Meetime API ──────────────────────────────────────────────────────

function meetimeApi() {
  const token = process.env.MEETIME_API_TOKEN;
  if (!token) throw new Error('MEETIME_API_TOKEN não configurado no .env');

  return axios.create({
    baseURL: MEETIME_API_BASE,
    headers: {
      authorization: token, // Meetime usa token direto sem "Bearer"
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
}

// ── Job 1: Polling de novos leads ────────────────────────────────────────────

async function pollNewLeads(prisma) {
  try {
    const since = lastLeadCheck.toISOString();
    lastLeadCheck = new Date(); // atualiza antes de buscar (evita duplicatas em falha)

    const api = meetimeApi();
    const res = await api.get('/leads', {
      params: {
        lead_created_after: since,
        limit: 100,
        start: 0,
      },
    });

    // A API pode retornar { leads: [...] } ou diretamente um array
    const leads = Array.isArray(res.data) ? res.data : (res.data.leads || res.data.data || []);

    if (leads.length === 0) return;

    console.log(`[Sync] ${leads.length} novo(s) lead(s) encontrado(s) via API`);

    for (const item of leads) {
      await processApiLead(prisma, item);
    }
  } catch (err) {
    if (err.message === 'MEETIME_API_TOKEN não configurado no .env') {
      // Silencia — token não configurado ainda
      return;
    }
    console.error('[Sync] Erro ao buscar leads:', err.response?.data || err.message);
  }
}

async function fetchProspection(externalId, api) {
  try {
    const res = await api.get('/prospections', {
      params: { lead_id: externalId, limit: 1 },
    });
    const items = Array.isArray(res.data) ? res.data : (res.data?.data || []);
    return items[0] || null;
  } catch {
    return null;
  }
}

async function processApiLead(prisma, data) {
  const externalId = String(data.id);

  // Meetime API usa lead_name, lead_email, lead_company etc.
  const name      = data.lead_name    || data.name        || data.contact_name || 'Sem nome';
  const email     = data.lead_email   || data.email       || null;
  const phone     = data.primaryPhoneString || data.phonesString?.split(',')[0]?.trim()
                  || data.phone || data.mobile || null;
  const company   = data.lead_company || data.company     || data.account?.name || null;
  const enteredAt = data.lead_created_date || data.created_at
    ? new Date(data.lead_created_date || data.created_at)
    : new Date();

  // Busca responsável e cadência na prospecção
  const api = meetimeApi();
  const prosp = await fetchProspection(externalId, api);
  const assignedTo = prosp?.owner_name || data.assigned_to?.name  || null;
  const ownerEmail = data.assigned_to?.email || data.owner?.email  || null;
  const cadence    = prosp?.cadence    || null;
  const source     = prosp?.lead_base  || data.source || data.nomeDaBase || null;

  // Evita duplicatas
  const existing = await prisma.lead.findUnique({ where: { externalId } });
  if (existing) return;

  const lead = await prisma.lead.create({
    data: {
      externalId,
      name,
      email,
      phone,
      company,
      source,
      assignedTo,
      ownerEmail,
      enteredAt,
      publicUrl: data.public_url || null,
    },
  });

  console.log(`[Sync] ✅ Lead salvo: ${lead.name} | ${ownerEmail || 'sem owner'}`);

  // Notifica
  await Promise.allSettled([
    notifyNewLead(lead, prisma, cadence),
    sendPushToLeadOwner(prisma, {
      title: '🔔 Novo Lead!',
      body:  `${lead.name}${lead.company ? ' · ' + lead.company : ''}`,
      url:   '/leads',
      tag:   `lead-${lead.id}`,
    }, ownerEmail),
  ]);
}

// ── Job 2: Monitor de inatividade (30 min) ───────────────────────────────────

async function checkInactiveLeads(prisma) {
  try {
    const now = new Date();
    const threshold = new Date(now - INACTIVE_THRESHOLD);

    // Leads ativos (não ganhos/perdidos) sem atividade há 30+ min
    // E que não receberam alerta nos últimos 30 min
    const staleLeads = await prisma.lead.findMany({
      where: {
        status: { notIn: ['won', 'lost'] },
        updatedAt: { lt: threshold },
        OR: [
          { lastInactiveAlertAt: null },
          { lastInactiveAlertAt: { lt: threshold } },
        ],
      },
    });

    if (staleLeads.length === 0) return;

    console.log(`[Inatividade] ${staleLeads.length} lead(s) parado(s) há 30+ min`);

    // Busca apenas admins ativos
    const admins = await prisma.user.findMany({
      where: { role: 'admin', active: true },
    });

    for (const lead of staleLeads) {
      const minutesInactive = Math.round((now - lead.updatedAt) / 60000);
      await notifyLeadInactive(lead, minutesInactive, admins, prisma);

      // Marca o alerta
      await prisma.lead.update({
        where: { id: lead.id },
        data:  { lastInactiveAlertAt: now },
      });
    }
  } catch (err) {
    console.error('[Inatividade] Erro:', err.message);
  }
}

async function notifyLeadInactive(lead, minutes, admins, prisma) {
  const msg = buildInactiveMessage(lead, minutes);

  const tasks = [sendGoogleChat(msg)];

  if (admins.length > 0) {
    for (const admin of admins) {
      tasks.push(sendWhatsApp(admin.phone, `Olá *${admin.name}*!\n\n${msg}`));
    }
  } else {
    // Fallback: NOTIF_PHONES do .env
    const phones = (process.env.NOTIF_PHONES || '').split(',').map(p => p.trim()).filter(Boolean);
    for (const phone of phones) {
      tasks.push(sendWhatsApp(phone, msg));
    }
  }

  tasks.push(
    sendPushToAdmins(prisma, {
      title: '⏰ Lead parado há ' + minutes + ' min',
      body:  `${lead.name}${lead.company ? ' · ' + lead.company : ''} — sem atividade`,
      url:   '/kanban',
      tag:   `inactive-${lead.id}`,
    })
  );

  await Promise.allSettled(tasks);
  console.log(`[Inatividade] ⚠️  Alerta enviado: ${lead.name} (${minutes} min parado)`);
}

function buildInactiveMessage(lead, minutes) {
  return [
    `⏰ *Lead parado há ${minutes} minutos!*`,
    ``,
    `👤 *${lead.name}*`,
    lead.company ? `🏢 ${lead.company}` : null,
    lead.email   ? `📧 ${lead.email}`   : null,
    lead.phone   ? `📱 ${lead.phone}`   : null,
    `📊 Status: ${lead.status}`,
    lead.assignedTo ? `👥 Resp.: ${lead.assignedTo}` : null,
    ``,
    `⚡ Nenhuma ação registrada nos últimos ${minutes} min!`,
    `🔗 ${lead.publicUrl || 'https://app.meetime.com.br/prospection'}`,
  ].filter(Boolean).join('\n');
}

// ── Inicialização ────────────────────────────────────────────────────────────

function startSync(prisma) {
  console.log('[Sync] ▶  Polling de leads iniciado (a cada 2 min)');
  console.log('[Sync] ▶  Monitor de inatividade iniciado (alerta após 30 min)');

  // Executa imediatamente na primeira vez
  pollNewLeads(prisma);
  checkInactiveLeads(prisma);

  // Agenda os intervalos
  setInterval(() => pollNewLeads(prisma),      POLL_INTERVAL_MS);
  setInterval(() => checkInactiveLeads(prisma), INACTIVITY_MS);
}

module.exports = { startSync };
