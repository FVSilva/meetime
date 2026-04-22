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

    // SDRs recebem apenas o seu bloco (resolve por nome pois ownerEmail é null na API)
    for (const consultant of byConsultant.values()) {
      const sdr = await findSdrByName(prisma, consultant.name, adminEmails);
      if (!sdr?.phone) {
        console.log(`[Relatório] ⚠️  SDR não encontrado para "${consultant.name}" — sem envio individual`);
        continue;
      }

      const stats = calcStats(consultant.leads);
      await sendWhatsApp(sdr.phone, buildConsultantBlock(consultant.name, stats, sdr.name));
      console.log(`[Relatório] ✓ Bloco enviado para SDR: ${sdr.name}`);
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
