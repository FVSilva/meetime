/**
 * daily-report.js
 *
 * Relatório diário enviado às 19h BRT (22h UTC no Render).
 * Cobre leads criados entre 00h e 19h do dia atual.
 *
 * Conteúdo:
 *  - Por consultor: total, ganhos, perdidos (PJ/PF), em aberto
 *  - Seção de leads inativos: abertos sem nenhuma atividade registrada
 */

const { sendWhatsApp, sendGoogleChat } = require('./notifications');

// ── Resolução de SDR por nome (ownerEmail é sempre null na API Meetime) ───────
function norm(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function namesMatch(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.startsWith(nb) || nb.startsWith(na)) return true;
  const wordsA = na.split(' ').slice(0, 2).join(' ');
  const wordsB = nb.split(' ').slice(0, 2).join(' ');
  if (wordsA.length > 4 && wordsA === wordsB) return true;
  const firstA = na.split(' ')[0], firstB = nb.split(' ')[0];
  if (firstA.length >= 5 && firstA === firstB) return true;
  if (na.length >= 6 && Math.abs(na.length - nb.length) <= 2 && levenshtein(na, nb) <= 1) return true;
  return false;
}

async function findSdrByName(prisma, consultantName, adminEmails) {
  const sdrs = await prisma.user.findMany({
    where: { role: 'sdr', active: true },
  });
  const match = sdrs.find(u =>
    namesMatch(u.name, consultantName) &&
    !adminEmails.has(u.email.toLowerCase())
  );
  return match || null;
}

// ── Heurística PJ / PF ─────────────────────────────────────────────────────
function isPJ(lead) { return !!lead.company; }

// ── Janela do dia (00h–19h BRT, ajustado para UTC no Render) ───────────────
function todayWindow() {
  const now = new Date();
  // Render roda em UTC; BRT = UTC-3
  // 00h BRT = 03h UTC | 19h BRT = 22h UTC
  const from = new Date(now);
  from.setUTCHours(3, 0, 0, 0);
  // Se ainda não passaram 03h UTC (= 00h BRT), usa o dia anterior
  if (from > now) from.setDate(from.getDate() - 1);

  const to = new Date(now);
  return { from, to };
}

// ── Busca leads do dia ──────────────────────────────────────────────────────
async function collectLeadsOfDay(prisma) {
  const { from, to } = todayWindow();

  return prisma.lead.findMany({
    where: {
      enteredAt: { gte: from, lte: to },
      NOT: { name: { in: ['Sem nome', 'Lead desconhecido', 'Lead'] } },
      OR: [{ email: { not: null } }, { phone: { not: null } }],
    },
    select: {
      id: true, name: true, company: true, status: true,
      assignedTo: true, ownerEmail: true, enteredAt: true,
    },
  });
}

// ── Busca stats de atividade do dia (ligações, emails, mensagens) ──────────
async function collectActivityStats(prisma) {
  const { from, to } = todayWindow();

  const [calls, activities, messages] = await Promise.all([
    // Ligações feitas hoje
    prisma.call.count({ where: { calledAt: { gte: from, lte: to } } }),

    // Atividades concluídas hoje (emails, tarefas, etc.)
    prisma.activity.findMany({
      where: { completedAt: { gte: from, lte: to } },
      select: { type: true },
    }),

    // Mensagens disparadas pelo sistema hoje (WhatsApp + GChat)
    prisma.messageLog.groupBy({
      by: ['channel', 'status'],
      where: { sentAt: { gte: from, lte: to } },
      _count: true,
    }),
  ]);

  const emailCount    = activities.filter(a => (a.type || '').toLowerCase().includes('email')).length;
  const activityCount = activities.length;

  const whatsApp = messages.filter(m => m.channel === 'whatsapp' && m.status === 'sent').reduce((s, m) => s + (m._count._all ?? m._count ?? 0), 0);
  const gchat    = messages.filter(m => m.channel === 'gchat'    && m.status === 'sent').reduce((s, m) => s + (m._count._all ?? m._count ?? 0), 0);
  const failed   = messages.filter(m => m.status === 'failed').reduce((s, m) => s + (m._count._all ?? m._count ?? 0), 0);

  return { calls, emailCount, activityCount, whatsApp, gchat, failed };
}

// ── Busca leads inativos — apenas dos últimos 30 dias, sem atividades ──────
async function collectInactiveLeads(prisma) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return prisma.lead.findMany({
    where: {
      status:     { notIn: ['won', 'lost'] },
      activities: { none: {} },
      enteredAt:  { gte: thirtyDaysAgo }, // ignora leads antigos
      NOT: { name: { in: ['Sem nome', 'Lead desconhecido', 'Lead'] } },
      OR: [{ email: { not: null } }, { phone: { not: null } }],
    },
    select: {
      id: true, name: true, company: true, status: true,
      assignedTo: true, enteredAt: true,
    },
    orderBy: { enteredAt: 'desc' }, // mais recentes primeiro
    take: 20,
  });
}

// ── Stats e funil de um grupo de leads ─────────────────────────────────────
function calcStats(leads) {
  const won       = leads.filter(l => l.status === 'won');
  const lost      = leads.filter(l => l.status === 'lost');
  const open      = leads.filter(l => l.status !== 'won' && l.status !== 'lost');
  const contacted = leads.filter(l => ['contacted','qualified','won','lost'].includes(l.status));
  const qualified = leads.filter(l => ['qualified','won'].includes(l.status));
  const lostPJ    = lost.filter(isPJ).length;
  const lostPF    = lost.filter(l => !isPJ(l)).length;
  const total     = leads.length;
  const pct = n  => total > 0 ? Math.round((n / total) * 100) : 0;
  return {
    total, open: open.length,
    won:       won.length,
    lost:      lost.length, lostPJ, lostPF,
    contacted: contacted.length,
    qualified: qualified.length,
    conversionRate: pct(won.length),
    contactRate:    pct(contacted.length),
    qualifiedRate:  pct(qualified.length),
  };
}

// ── Mensagem para um consultor (SDR) ───────────────────────────────────────
function buildConsultantBlock(consultantName, stats, greeting = '') {
  const header     = greeting ? `Olá *${greeting}*! ` : '';
  const lostDetail = stats.lost > 0 ? ` (PJ: ${stats.lostPJ} | PF: ${stats.lostPF})` : '';
  return [
    `📊 ${header}*Seu relatório do dia*`,
    `📅 ${new Date().toLocaleDateString('pt-BR')}`,
    ``,
    `👤 *${consultantName}*`,
    `• 📥 Leads recebidos: *${stats.total}*`,
    `• 📞 Contatados: *${stats.contacted}* (${stats.contactRate}%)`,
    `• 🎯 Qualificados: *${stats.qualified}* (${stats.qualifiedRate}%)`,
    `• 🏆 Convertidos: *${stats.won}* (${stats.conversionRate}%)`,
    `• ❌ Perdidos: *${stats.lost}*${lostDetail}`,
    `• ⏳ Em aberto: *${stats.open}*`,
  ].join('\n');
}

// ── Bloco de um consultor no relatório do admin ─────────────────────────────
function buildConsultantBlockAdmin(name, stats) {
  const lostDetail = stats.lost > 0 ? ` (PJ: ${stats.lostPJ} | PF: ${stats.lostPF})` : '';
  return [
    `👤 *${name}*  ·  Taxa: *${stats.conversionRate}%*`,
    `   📥 ${stats.total}  📞 ${stats.contacted} (${stats.contactRate}%)  🎯 ${stats.qualified} (${stats.qualifiedRate}%)  🏆 ${stats.won}  ❌ ${stats.lost}${lostDetail}`,
  ].join('\n');
}

// ── Relatório completo (admins + GChat) ────────────────────────────────────
function buildFullReport(byConsultant, totalStats, inactiveLeads, actStats) {
  const date  = new Date().toLocaleDateString('pt-BR');
  const lines = [
    `📊 *Análise Diária — ${date}*`,
    ``,
    `📈 *Resumo Geral*`,
    `• Leads: *${totalStats.total}*  ·  📞 *${totalStats.contacted}* (${totalStats.contactRate}%)`,
    `• 🎯 Qualificados: *${totalStats.qualified}* (${totalStats.qualifiedRate}%)`,
    `• 🏆 Convertidos: *${totalStats.won}* (${totalStats.conversionRate}%)`,
    `• ❌ Perdidos: *${totalStats.lost}*${totalStats.lost > 0 ? ` (PJ: ${totalStats.lostPJ} | PF: ${totalStats.lostPF})` : ''}`,
    `• ⏳ Em aberto: *${totalStats.open}*`,
    ``,
    `─────────────────────`,
    `👥 *Por Consultor*`,
    ``,
  ];

  // Bloco por consultor (ordenado por total desc)
  const sorted = [...byConsultant.values()].sort((a, b) => b.leads.length - a.leads.length);
  for (const { name, leads } of sorted) {
    const s = calcStats(leads);
    lines.push(buildConsultantBlockAdmin(name, s), ``);
  }

  // Atividade do dia
  lines.push(
    `─────────────────────`,
    `📡 *Atividade do dia*`,
    `• 📞 Ligações: *${actStats.calls}*`,
    `• 📧 E-mails/Atividades: *${actStats.activityCount}*`,
    `• 💬 WhatsApp enviados: *${actStats.whatsApp}*${actStats.failed > 0 ? `  ⚠️ ${actStats.failed} falha(s)` : ''}`,
  );

  // Leads inativos
  lines.push(`─────────────────────`);
  if (inactiveLeads.length > 0) {
    lines.push(`⚠️ *Leads sem atividade (${inactiveLeads.length})*`, ``);
    for (const lead of inactiveLeads) {
      const hours = Math.round((Date.now() - new Date(lead.enteredAt)) / 3600000);
      const resp  = lead.assignedTo ? ` · ${lead.assignedTo}` : '';
      lines.push(`• *${lead.name}*${lead.company ? ` (${lead.company})` : ''}${resp} — ${hours}h`);
    }
  } else {
    lines.push(`✅ *Nenhum lead inativo!*`);
  }

  return lines.join('\n');
}

// ── Dispara o relatório ─────────────────────────────────────────────────────
async function sendDailyReport(prisma) {
  console.log('[Relatório] ▶  Gerando relatório diário das 19h...');

  try {
    const [leads, inactiveLeads, actStats] = await Promise.all([
      collectLeadsOfDay(prisma),
      collectInactiveLeads(prisma),
      collectActivityStats(prisma),
    ]);

    // Agrupa por consultor — ignora assignedTo que seja email (ex: adriano@v4company.com)
    const isEmail = v => typeof v === 'string' && v.includes('@');
    const byConsultant = new Map();
    for (const lead of leads) {
      if (isEmail(lead.assignedTo)) continue; // ignora leads com email no lugar de nome
      const key = lead.assignedTo || '(sem responsável)';
      if (!byConsultant.has(key)) {
        byConsultant.set(key, { name: key, email: lead.ownerEmail || null, leads: [] });
      }
      byConsultant.get(key).leads.push(lead);
    }

    const totalStats = calcStats(leads);
    const fullReport = buildFullReport(byConsultant, totalStats, inactiveLeads, actStats);

    // Admins recebem relatório completo (WhatsApp + GChat)
    const admins = await prisma.user.findMany({ where: { role: 'admin', active: true } });
    const adminEmails = new Set(admins.map(a => a.email.toLowerCase()).filter(Boolean));

    await sendGoogleChat(fullReport);

    for (const admin of admins) {
      if (admin.phone) {
        await sendWhatsApp(admin.phone, `Olá *${admin.name}*!\n\n${fullReport}`);
      }
    }

    // SDRs não recebem relatório diário — apenas admins

    console.log(`[Relatório] ✅ Enviado — ${leads.length} lead(s) do dia | ${inactiveLeads.length} inativos`);
  } catch (err) {
    console.error('[Relatório] Erro:', err.message);
  }
}

// ── Agendamento às 19h BRT (= 22h UTC no Render) ───────────────────────────

// Chave no DB para controlar se o relatório do dia já foi enviado
const REPORT_KEY = 'daily_report_sent';

async function wasReportSentToday(prisma) {
  try {
    const todayUTC22 = new Date();
    todayUTC22.setUTCHours(22, 0, 0, 0);
    // Se ainda não chegou às 22h UTC hoje, usa referência de ontem
    if (todayUTC22 > new Date()) todayUTC22.setDate(todayUTC22.getDate() - 1);

    const sent = await prisma.messageLog.findFirst({
      where: {
        channel: 'gchat',
        body:    { contains: 'Análise Diária' },
        sentAt:  { gte: todayUTC22 },
      },
    });
    return !!sent;
  } catch {
    return false;
  }
}

function scheduleAt19h(prisma) {
  function msUntilNext19hBRT() {
    const now  = new Date();
    const next = new Date(now);
    next.setUTCHours(22, 0, 0, 0); // 22h UTC = 19h BRT
    if (next <= now) next.setDate(next.getDate() + 1);
    return next - now;
  }

  async function schedule() {
    // Verifica se o servidor reiniciou depois das 19h BRT e o relatório não foi enviado
    const nowUTCHour = new Date().getUTCHours();
    const brtHour    = (nowUTCHour - 3 + 24) % 24;
    if (brtHour >= 19) {
      const alreadySent = await wasReportSentToday(prisma);
      if (!alreadySent) {
        console.log('[Relatório] ⚠️  Servidor reiniciou após 19h — enviando relatório agora...');
        await sendDailyReport(prisma).catch(console.error);
      }
    }

    const delay = msUntilNext19hBRT();
    const hh    = (delay / 3600000).toFixed(1);
    console.log(`[Relatório] ⏰ Próximo relatório em ${hh}h (às 19:00 BRT / 22:00 UTC)`);

    setTimeout(async () => {
      await sendDailyReport(prisma);
      schedule(); // reagenda para o próximo dia
    }, delay);
  }

  schedule();
}

module.exports = { scheduleAt19h, sendDailyReport };
