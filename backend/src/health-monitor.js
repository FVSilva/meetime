/**
 * health-monitor.js
 *
 * Monitora a saúde dos jobs em background e do sistema em geral.
 * A cada 10 minutos verifica:
 *   - Banco de dados (conexão)
 *   - API Meetime (token + conectividade)
 *   - Heartbeats dos jobs (poll de leads, atualizações, inatividade)
 *
 * Se algum job ficou sem executar por mais de 2 ciclos esperados,
 * ele é reiniciado automaticamente e admins são alertados.
 *
 * Expõe o estado via getHealthStatus() — usado pelo endpoint /health.
 */

const axios = require('axios');
const { sendWhatsApp, sendGoogleChat } = require('./notifications');

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // checa a cada 10 min

// ── Registro de heartbeats ────────────────────────────────────────────────────
// Cada job chama reportHeartbeat(jobName) após executar com sucesso.

const heartbeats = {
  pollNewLeads:     { last: null, maxGapMs: 6  * 60 * 1000 },  // tolerância: 6 min (ciclo 2 min)
  pollUpdatedLeads: { last: null, maxGapMs: 12 * 60 * 1000 },  // tolerância: 12 min (ciclo 5 min)
};

function reportHeartbeat(jobName) {
  if (heartbeats[jobName]) {
    heartbeats[jobName].last = new Date();
  }
}

// ── Estado global de saúde ────────────────────────────────────────────────────

const healthState = {
  db:      { ok: null, checkedAt: null, error: null },
  api:     { ok: null, checkedAt: null, error: null },
  jobs:    {},
  startedAt: new Date(),
  lastCheck: null,
};

// ── Verificações ──────────────────────────────────────────────────────────────

async function checkDatabase(prisma) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    healthState.db = { ok: true, checkedAt: new Date(), error: null };
    return true;
  } catch (err) {
    healthState.db = { ok: false, checkedAt: new Date(), error: err.message };
    return false;
  }
}

async function checkMeetimeApi() {
  const token = process.env.MEETIME_API_TOKEN;
  if (!token) {
    healthState.api = { ok: false, checkedAt: new Date(), error: 'Token não configurado' };
    return false;
  }
  try {
    await axios.get('https://api.meetime.com.br/v2/leads', {
      headers: { authorization: token, 'Content-Type': 'application/json' },
      params:  { limit: 1 },
      timeout: 10000,
    });
    healthState.api = { ok: true, checkedAt: new Date(), error: null };
    return true;
  } catch (err) {
    const status = err.response?.status;
    // 401/403 = token inválido, outros = API fora
    const error = status === 401 || status === 403
      ? `Token inválido (HTTP ${status})`
      : `API indisponível (${err.message})`;
    healthState.api = { ok: false, checkedAt: new Date(), error };
    return false;
  }
}

function checkJobs() {
  const now     = Date.now();
  const results = {};
  const stale   = [];

  for (const [name, cfg] of Object.entries(heartbeats)) {
    const last    = cfg.last ? cfg.last.getTime() : null;
    const gap     = last ? now - last : null;
    const ok      = last !== null && gap <= cfg.maxGapMs;
    const lastStr = last ? new Date(last).toISOString() : 'nunca executou';

    results[name] = { ok, last: lastStr, gapSec: gap ? Math.round(gap / 1000) : null };
    if (!ok) stale.push(name);
  }

  healthState.jobs = results;
  return stale; // jobs com problema
}

// ── Alerta de falha ───────────────────────────────────────────────────────────

async function alertAdmins(prisma, problems) {
  const lines = [
    `🚨 *Alerta de Sistema — Meetime CRM*`,
    ``,
    ...problems.map(p => `• ${p}`),
    ``,
    `🕐 ${new Date().toLocaleString('pt-BR')}`,
    `🔗 ${process.env.FRONTEND_URL || 'https://meetime-v2.vercel.app'}`,
  ];
  const msg = lines.join('\n');

  try {
    await sendGoogleChat(msg);
  } catch {}

  try {
    const admins = await prisma.user.findMany({ where: { role: 'admin', active: true } });
    for (const admin of admins) {
      if (admin.phone) await sendWhatsApp(admin.phone, `Olá *${admin.name}*!\n\n${msg}`).catch(() => {});
    }
  } catch {}
}

// ── Runner principal ──────────────────────────────────────────────────────────

async function runHealthCheck(prisma, jobRestarters) {
  healthState.lastCheck = new Date();
  const problems = [];

  // 1. Banco de dados
  const dbOk = await checkDatabase(prisma);
  if (!dbOk) problems.push(`❌ Banco de dados offline: ${healthState.db.error}`);

  // 2. API Meetime
  const apiOk = await checkMeetimeApi();
  if (!apiOk) problems.push(`❌ API Meetime: ${healthState.api.error}`);

  // 3. Jobs
  const staleJobs = checkJobs();
  for (const job of staleJobs) {
    const h = heartbeats[job];
    const last = h.last ? `última execução: ${h.last.toLocaleString('pt-BR')}` : 'nunca executou';
    problems.push(`⚠️ Job "${job}" parou de responder (${last})`);

    // Reinicia o job automaticamente se tiver restarter registrado
    if (jobRestarters[job]) {
      console.warn(`[Health] ♻️  Reiniciando job: ${job}`);
      try { jobRestarters[job](); } catch (e) { console.error(`[Health] Erro ao reiniciar ${job}:`, e.message); }
    }
  }

  if (problems.length > 0) {
    console.warn('[Health] ⚠️  Problemas detectados:', problems);
    await alertAdmins(prisma, problems).catch(() => {});
  } else {
    console.log('[Health] ✅ Todos os sistemas operacionais');
  }
}

// ── API pública ───────────────────────────────────────────────────────────────

function getHealthStatus() {
  const uptime = Math.round((Date.now() - healthState.startedAt.getTime()) / 1000);
  return {
    ok:        healthState.db.ok && healthState.api.ok,
    uptime,
    startedAt: healthState.startedAt.toISOString(),
    lastCheck: healthState.lastCheck?.toISOString() || null,
    db:        healthState.db,
    api:       healthState.api,
    jobs:      healthState.jobs,
  };
}

// ── Inicialização ─────────────────────────────────────────────────────────────

function startHealthMonitor(prisma, jobRestarters = {}) {
  console.log('[Health] ▶  Monitor de saúde iniciado (a cada 10 min)');

  // Primeira checagem após 2 min (dá tempo dos jobs iniciarem)
  setTimeout(() => {
    runHealthCheck(prisma, jobRestarters).catch(console.error);
    setInterval(() => runHealthCheck(prisma, jobRestarters).catch(console.error), CHECK_INTERVAL_MS);
  }, 2 * 60 * 1000);
}

module.exports = { startHealthMonitor, reportHeartbeat, getHealthStatus };
