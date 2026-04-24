/**
 * meetime-sync.js
 *
 * Três jobs em background:
 *
 * 1. POLLING DE NOVOS LEADS (a cada 2 min)
 *    - Busca leads criados após a última verificação via API Meetime
 *    - Salva no banco e notifica WhatsApp + Google Chat + Push
 *
 * 2. POLLING DE ATUALIZAÇÕES (a cada 5 min)
 *    - Busca leads atualizados no Meetime após a última sync
 *    - Atualiza nome, empresa, responsável, cadência, status (won/lost)
 *    - Garante consistência mesmo que webhooks falhem
 *
 * 3. MONITOR DE INATIVIDADE (a cada 15 min)
 *    - Verifica leads ativos criados há ≥ 3h sem nenhuma atividade registrada
 *    - Alerta admins via WhatsApp + Google Chat + Push
 *    - Evita spam: só re-alerta após 3h do último alerta
 */

const axios = require('axios');
const { notifyNewLead } = require('./notifications');
const { sendPushToLeadOwner, sendPushToAdmins } = require('./push');
const { reportHeartbeat } = require('./health-monitor');

const MEETIME_API_BASE   = 'https://api.meetime.com.br/v2';
const TERMINAL_STATUS    = ['won', 'lost']; // status que nunca retrocedem
const POLL_INTERVAL_MS   = 2  * 60 * 1000;  // novos leads: a cada 2 min
const UPDATE_INTERVAL_MS = 5  * 60 * 1000;  // atualizações: a cada 5 min

let lastLeadCheck  = new Date(Date.now() - POLL_INTERVAL_MS);
let lastUpdateSync = new Date(Date.now() - UPDATE_INTERVAL_MS);

// ── Cliente Meetime API ──────────────────────────────────────────────────────

function meetimeApi() {
  const token = process.env.MEETIME_API_TOKEN;
  if (!token) throw new Error('MEETIME_API_TOKEN não configurado no .env');

  return axios.create({
    baseURL: MEETIME_API_BASE,
    headers: {
      authorization: token,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
}

// ── Prospection & Activities ─────────────────────────────────────────────────

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

// Verifica se há atividades registradas no Meetime para este lead
async function fetchHasActivity(externalId, api) {
  try {
    const res = await api.get('/activities', {
      params: { lead_id: externalId, limit: 1 },
    });
    const items = Array.isArray(res.data) ? res.data : (res.data?.data || []);
    return items.length > 0;
  } catch {
    return false; // endpoint pode não existir ou ter outra estrutura
  }
}

// Mapeia status da prospecção Meetime → nosso status
// won/lost: mapeamento explícito
// null: nenhuma mudança de status (mantém o atual ou aplica lógica de atividades)
function mapProspStatus(prosp) {
  if (!prosp) return null;
  const s = (prosp.status || '').toLowerCase();
  const r = (prosp.result  || '').toLowerCase();
  if (s === 'won' || s === 'finished_positive' || r === 'positive' || r === 'won') return 'won';
  if (s === 'lost' || s === 'finished_negative' || s === 'disqualified' ||
      r === 'negative' || r === 'lost') return 'lost';
  return null;
}

// ── Job 1: Polling de novos leads ────────────────────────────────────────────

async function pollNewLeads(prisma) {
  try {
    const since    = lastLeadCheck.toISOString();
    const api      = meetimeApi();
    const res      = await api.get('/leads', {
      params: { lead_created_after: since, limit: 100, start: 0 },
    });

    // Só avança o cursor APÓS a requisição ter sucesso — evita perder leads se falhar
    lastLeadCheck  = new Date();
    const leads    = Array.isArray(res.data) ? res.data : (res.data.leads || res.data.data || []);
    reportHeartbeat('pollNewLeads');
    if (leads.length === 0) return;

    console.log(`[Sync] ${leads.length} novo(s) lead(s) encontrado(s)`);
    for (const item of leads) {
      await processApiLead(prisma, item);
    }
  } catch (err) {
    if (err.message === 'MEETIME_API_TOKEN não configurado no .env') return;
    console.error('[Sync] Erro ao buscar novos leads:', err.response?.data || err.message);
  }
}

async function processApiLead(prisma, data, { notify = true } = {}) {
  const externalId = String(data.id);
  const existing   = await prisma.lead.findUnique({ where: { externalId } });
  if (existing) return; // já existe, o job de update cuida

  const name      = data.lead_name    || data.name        || data.contact_name || 'Sem nome';
  const email     = data.lead_email   || data.email       || null;
  const phone     = data.primaryPhoneString || data.phonesString?.split(',')[0]?.trim()
                  || data.phone || data.mobile || null;
  const company   = data.lead_company || data.company     || data.account?.name || null;
  const enteredAt = data.lead_created_date || data.created_at
    ? new Date(data.lead_created_date || data.created_at)
    : new Date();

  const api        = meetimeApi();
  const prosp      = await fetchProspection(externalId, api);
  const assignedTo = prosp?.owner_name || data.assigned_to?.name  || null;
  const ownerEmail = data.assigned_to?.email || data.owner?.email  || null;
  const cadence    = prosp?.cadence    || null;
  const source     = prosp?.lead_base  || data.source || data.nomeDaBase || null;

  const lead = await prisma.lead.create({
    data: {
      externalId, name, email, phone, company,
      source, cadence, assignedTo, ownerEmail, enteredAt,
      publicUrl: data.public_url || null,
    },
  });

  console.log(`[Sync] ✅ Lead salvo: ${lead.name} | responsável: ${assignedTo || 'sem responsável'}`);

  if (notify) {
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
}

// ── Job 2: Polling de leads atualizados ──────────────────────────────────────

async function pollUpdatedLeads(prisma) {
  try {
    const since = lastUpdateSync.toISOString();
    lastUpdateSync = new Date();

    const api   = meetimeApi();
    let leads   = [];
    let source  = 'filtro por data';

    try {
      // Tenta com lead_updated_after (ideal)
      const res = await api.get('/leads', {
        params: { lead_updated_after: since, limit: 100, start: 0 },
      });
      leads = Array.isArray(res.data) ? res.data : (res.data.leads || res.data.data || []);
    } catch (e) {
      // Qualquer erro (400, 422, 500, timeout, etc.) → fallback aos 50 mais recentes
      source = `fallback (${e.response?.status || e.message})`;
      try {
        const res2 = await api.get('/leads', { params: { limit: 50, start: 0 } });
        leads = Array.isArray(res2.data) ? res2.data : (res2.data.leads || res2.data.data || []);
      } catch (e2) {
        console.error('[Sync] Fallback também falhou:', e2.response?.data || e2.message);
      }
    }

    reportHeartbeat('pollUpdatedLeads');
    if (leads.length === 0) return;

    console.log(`[Sync] 🔄 ${leads.length} lead(s) para sync (${source})`);
    for (const item of leads) {
      await syncLeadUpdate(prisma, item);
    }
  } catch (err) {
    if (err.message === 'MEETIME_API_TOKEN não configurado no .env') return;
    console.error('[Sync] Erro ao buscar leads atualizados:', err.response?.data || err.message);
  }
}

async function syncLeadUpdate(prisma, data) {
  const externalId = String(data.id);
  const existing   = await prisma.lead.findUnique({ where: { externalId } });

  if (!existing) {
    // Lead não está no banco — salva silenciosamente SEM notificar
    // (pode ser lead antigo encontrado pelo fallback do pollUpdatedLeads)
    await processApiLead(prisma, data, { notify: false });
    return;
  }

  // Busca prospecção atualizada
  const api   = meetimeApi();
  const prosp = await fetchProspection(externalId, api);

  // Campos que podem ter mudado no Meetime
  const name       = data.lead_name    || data.name        || existing.name;
  const email      = data.lead_email   || data.email       || existing.email;
  const phone      = data.primaryPhoneString || data.phonesString?.split(',')[0]?.trim()
                   || data.phone || existing.phone;
  const company    = data.lead_company || data.company     || existing.company;
  const assignedTo = prosp?.owner_name || data.assigned_to?.name || existing.assignedTo;
  const ownerEmail = data.assigned_to?.email || data.owner?.email || existing.ownerEmail;
  const cadence    = prosp?.cadence    || existing.cadence;
  const source     = prosp?.lead_base  || data.source || existing.source;
  const publicUrl  = data.public_url   || existing.publicUrl;

  // Status: won/lost vêm da prospecção — NUNCA retrocede de status terminal
  const mappedStatus = mapProspStatus(prosp);
  let newStatus = existing.status;

  if (mappedStatus && existing.status !== mappedStatus) {
    // Atualização definitiva: won ou lost (sempre tem prioridade)
    newStatus = mappedStatus;
  } else if (!TERMINAL_STATUS.includes(existing.status) && existing.status === 'new') {
    // Só detecta 'contacted' se ainda não estiver em status terminal
    const hasActivity = await fetchHasActivity(externalId, api);
    if (hasActivity) {
      newStatus = 'contacted';
      console.log(`[Sync] 📞 Lead contactado detectado via atividades: ${name}`);
    }
  }

  // Detecta se algo mudou de fato
  const changed =
    name       !== existing.name       ||
    email      !== existing.email      ||
    phone      !== existing.phone      ||
    company    !== existing.company    ||
    assignedTo !== existing.assignedTo ||
    ownerEmail !== existing.ownerEmail ||
    cadence    !== existing.cadence    ||
    source     !== existing.source     ||
    newStatus  !== existing.status;

  if (!changed) return; // nada a fazer

  const updateData = {
    name, email, phone, company,
    assignedTo, ownerEmail, cadence, source, publicUrl,
    status:    newStatus,
    updatedAt: new Date(),
  };

  // Se transicionando para 'contacted', registra o tempo de resposta
  if (newStatus === 'contacted' && !existing.firstContactAt) {
    updateData.firstContactAt  = new Date();
    updateData.responseTimeSec = Math.round((new Date() - existing.enteredAt) / 1000);
  }

  await prisma.lead.update({
    where: { id: existing.id },
    data:  updateData,
  });

  console.log(`[Sync] 🔄 Lead atualizado: ${name}${assignedTo ? ' → ' + assignedTo : ''}${newStatus !== existing.status ? ' [' + existing.status + ' → ' + newStatus + ']' : ''}`);
}


// ── Inicialização ────────────────────────────────────────────────────────────

function startSync(prisma) {
  console.log('[Sync] ▶  Polling de novos leads (a cada 2 min)');
  console.log('[Sync] ▶  Polling de atualizações (a cada 5 min)');

  // Executa imediatamente
  pollNewLeads(prisma);
  pollUpdatedLeads(prisma);

  const intervals = {
    pollNewLeads:     setInterval(() => pollNewLeads(prisma),     POLL_INTERVAL_MS),
    pollUpdatedLeads: setInterval(() => pollUpdatedLeads(prisma), UPDATE_INTERVAL_MS),
  };

  // Restarters: reinicia o intervalo do job se o health monitor detectar problema
  const jobRestarters = {
    pollNewLeads: () => {
      clearInterval(intervals.pollNewLeads);
      pollNewLeads(prisma);
      intervals.pollNewLeads = setInterval(() => pollNewLeads(prisma), POLL_INTERVAL_MS);
    },
    pollUpdatedLeads: () => {
      clearInterval(intervals.pollUpdatedLeads);
      pollUpdatedLeads(prisma);
      intervals.pollUpdatedLeads = setInterval(() => pollUpdatedLeads(prisma), UPDATE_INTERVAL_MS);
    },
  };

  return jobRestarters;
}

module.exports = { startSync };
