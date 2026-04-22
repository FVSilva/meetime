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

// ── Busca leads inativos (qualquer data, sem atividades, em aberto) ─────────
async function collectInactiveLeads(prisma) {
  return prisma.lead.findMany({
    where: {
      status:     { notIn: ['won', 'lost'] },
      activities: { none: {} },
      NOT: { name: { in: ['Sem nome', 'Lead desconhecido', 'Lead'] } },
      OR: [{ email: { not: null } }, { phone: { not: null } }],
    },
    select: {
      id: true, name: true, company: true, status: true,
      assignedTo: true, enteredAt: true,
    },
    orderBy: { enteredAt: 'asc' },
    take: 30, // limita para não poluir a mensagem
  });
}

// ── Stats de um grupo de leads ──────────────────────────────────────────────
function calcStats(leads) {
  const won    = leads.filter(l => l.status === 'won');
  const lost   = leads.filter(l => l.status === 'lost');
  const open   = leads.filter(l => l.status !== 'won' && l.status !== 'lost');
  const lostPJ = lost.filter(isPJ).length;
  const lostPF = lost.filter(l => !isPJ(l)).length;
  return { total: leads.length, won: won.length, lost: lost.length, lostPJ, lostPF, open: open.length };
}

// ── Mensagem para um consultor (SDR) ───────────────────────────────────────
function buildConsultantBlock(consultantName, stats, greeting = '') {
  const header = greeting ? `Olá *${greeting}*! ` : '';
  const lostDetail = stats.lost > 0 ? ` _(PJ: ${stats.lostPJ} | PF: ${stats.lostPF})_` : '';
  return [
    `📊 ${header}*Relatório do dia*`,
    `📅 ${new Date().toLocaleDateString('pt-BR')}`,
    ``,
    `👤 *${consultantName}*`,
    `• Leads recebidos: *${stats.total}*`,
    `• ✅ Convertidos: *${stats.won}*`,
    `• ❌ Perdidos: *${stats.lost}*${lostDetail}`,
    `• ⏳ Em aberto: *${stats.open}*`,
  ].join('\n');
}

// ── Relatório completo (admins + GChat) ────────────────────────────────────
function buildFullReport(byConsultant, totalStats, inactiveLeads) {
  const date  = new Date().toLocaleDateString('pt-BR');
  const lines = [
    `📊 *Relatório Diário — ${date}*`,
    ``,
  ];

  // Bloco por consultor
  for (const { name, leads } of byConsultant.values()) {
    const s = calcStats(leads);
    const lostDetail = s.lost > 0 ? ` (PJ: ${s.lostPJ} | PF: ${s.lostPF})` : '';
    lines.push(
      `👤 *${name}*`,
      `   Recebidos: ${s.total}  ·  ✅ ${s.won}  ·  ❌ ${s.lost}${lostDetail}  ·  ⏳ ${s.open}`,
      ``,
    );
  }

  // Total geral
  const t = totalStats;
  const lostDetail = t.lost > 0 ? ` (PJ: ${t.lostPJ} | PF: ${t.lostPF})` : '';
  lines.push(
    `─────────────────────`,
    `📈 *Total Geral*`,
    `• Leads: *${t.total}*  ·  ✅ *${t.won}*  ·  ❌ *${t.lost}*${lostDetail}  ·  ⏳ *${t.open}*`,
  );

  // Seção de leads inativos
  if (inactiveLeads.length > 0) {
    lines.push(``, `─────────────────────`, `⚠️ *Leads sem atividade (${inactiveLeads.length})*`, ``);
    for (const lead of inactiveLeads) {
      const hours = Math.round((Date.now() - new Date(lead.enteredAt)) / 3600000);
      const resp  = lead.assignedTo ? ` · ${lead.assignedTo}` : '';
      lines.push(`• *${lead.name}*${lead.company ? ` (${lead.company})` : ''}${resp} — ${hours}h sem contato`);
    }
  } else {
    lines.push(``, `✅ *Nenhum lead inativo!*`);
  }

  return lines.join('\n');
}

// ── Dispara o relatório ─────────────────────────────────────────────────────
async function sendDailyReport(prisma) {
  console.log('[Relatório] ▶  Gerando relatório diário das 19h...');

  try {
    const leads         = await collectLeadsOfDay(prisma);
    const inactiveLeads = await collectInactiveLeads(prisma);

    // Agrupa por consultor
    const byConsultant = new Map();
    for (const lead of leads) {
      const key = lead.assignedTo || '(sem responsável)';
      if (!byConsultant.has(key)) {
        byConsultant.set(key, { name: key, email: lead.ownerEmail || null, leads: [] });
      }
      byConsultant.get(key).leads.push(lead);
    }

    const totalStats = calcStats(leads);
    const fullReport = buildFullReport(byConsultant, totalStats, inactiveLeads);

    // Admins recebem relatório completo (WhatsApp + GChat)
    const admins = await prisma.user.findMany({ where: { role: 'admin', active: true } });
    const adminEmails = new Set(admins.map(a => a.email.toLowerCase()).filter(Boolean));

    await sendGoogleChat(fullReport);

    for (const admin of admins) {
      if (admin.phone) {
        await sendWhatsApp(admin.phone, `Olá *${admin.name}*!\n\n${fullReport}`);
      }
    }

    // SDRs recebem apenas o seu bloco (sem lista de inativos)
    for (const consultant of byConsultant.values()) {
      if (!consultant.email || adminEmails.has(consultant.email.toLowerCase())) continue;

      const sdr = await prisma.user.findFirst({
        where: { email: { equals: consultant.email, mode: 'insensitive' }, active: true },
      });
      if (!sdr?.phone) continue;

      const stats = calcStats(consultant.leads);
      await sendWhatsApp(sdr.phone, buildConsultantBlock(consultant.name, stats, sdr.name));
    }

    console.log(`[Relatório] ✅ Enviado — ${leads.length} lead(s) do dia | ${inactiveLeads.length} inativos`);
  } catch (err) {
    console.error('[Relatório] Erro:', err.message);
  }
}

// ── Agendamento às 19h BRT (= 22h UTC no Render) ───────────────────────────
function scheduleAt19h(prisma) {
  function msUntilNext19hBRT() {
    const now  = new Date();
    const next = new Date(now);
    next.setUTCHours(22, 0, 0, 0); // 22h UTC = 19h BRT
    if (next <= now) next.setDate(next.getDate() + 1);
    return next - now;
  }

  function schedule() {
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
