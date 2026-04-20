/**
 * daily-report.js
 *
 * Relatório diário enviado às 19h para cada consultor V4 e para admins.
 * Cobre leads criados entre 08h e 18h do dia atual.
 *
 * Por consultor:
 *  - Total de leads recebidos
 *  - Convertidos (status = won)
 *  - Perdidos (status = lost), com breakdown PJ / PF
 *  - Em aberto (qualquer status ≠ won/lost)
 */

const { sendWhatsApp, sendGoogleChat } = require('./notifications');

// ── Heurística PJ / PF ─────────────────────────────────────────────────────
// Se o lead tem empresa preenchida → PJ (Pessoa Jurídica), caso contrário PF.
function isPJ(lead) { return !!lead.company; }

// ── Faixa horária do dia (08h–18h) ─────────────────────────────────────────
function todayWindow() {
  const now = new Date();
  const from = new Date(now);
  from.setHours(8, 0, 0, 0);
  const to = new Date(now);
  to.setHours(18, 0, 0, 0);
  return { from, to };
}

// ── Busca e agrupa leads ────────────────────────────────────────────────────
async function collectData(prisma) {
  const { from, to } = todayWindow();

  const leads = await prisma.lead.findMany({
    where: {
      enteredAt: { gte: from, lte: to },
      // Ignora fantasmas
      NOT: { name: { in: ['Sem nome', 'Lead desconhecido', 'Lead'] } },
      OR: [{ email: { not: null } }, { phone: { not: null } }],
    },
    select: {
      id: true,
      name: true,
      company: true,
      status: true,
      assignedTo: true,
      ownerEmail: true,
      enteredAt: true,
    },
  });

  // Agrupa por consultor (assignedTo)
  const byConsultant = new Map();

  for (const lead of leads) {
    const key = lead.assignedTo || '(sem responsável)';
    if (!byConsultant.has(key)) {
      byConsultant.set(key, {
        name:  key,
        email: lead.ownerEmail || null,
        leads: [],
      });
    }
    byConsultant.get(key).leads.push(lead);
  }

  return { leads, byConsultant };
}

// ── Calcula stats de um grupo de leads ─────────────────────────────────────
function calcStats(leads) {
  const won    = leads.filter(l => l.status === 'won');
  const lost   = leads.filter(l => l.status === 'lost');
  const open   = leads.filter(l => l.status !== 'won' && l.status !== 'lost');
  const lostPJ = lost.filter(isPJ).length;
  const lostPF = lost.filter(l => !isPJ(l)).length;
  return { total: leads.length, won: won.length, lost: lost.length, lostPJ, lostPF, open: open.length };
}

// ── Monta mensagem de um consultor ─────────────────────────────────────────
function buildConsultantBlock(consultantName, stats, greeting = '') {
  const header = greeting ? `Olá *${greeting}*! ` : '';
  const lostDetail = stats.lost > 0 ? ` _(PJ: ${stats.lostPJ} | PF: ${stats.lostPF})_` : '';
  return [
    `📊 ${header}*Relatório do dia — 08h às 18h*`,
    `📅 ${new Date().toLocaleDateString('pt-BR')}`,
    ``,
    `👤 *${consultantName}*`,
    `• Leads recebidos: *${stats.total}*`,
    `• ✅ Convertidos: *${stats.won}*`,
    `• ❌ Perdidos: *${stats.lost}*${lostDetail}`,
    `• ⏳ Em aberto: *${stats.open}*`,
  ].join('\n');
}

// ── Monta relatório completo (para admin e Google Chat) ─────────────────────
function buildFullReport(byConsultant, totalStats) {
  const date = new Date().toLocaleDateString('pt-BR');
  const lines = [
    `📊 *Relatório Diário — 08h às 18h*`,
    `📅 ${date}`,
    ``,
  ];

  for (const { name, leads } of byConsultant.values()) {
    const s = calcStats(leads);
    const lostDetail = s.lost > 0 ? ` (PJ: ${s.lostPJ} | PF: ${s.lostPF})` : '';
    lines.push(
      `👤 *${name}*`,
      `   Recebidos: ${s.total}  ·  Ganhos: ${s.won}  ·  Perdidos: ${s.lost}${lostDetail}  ·  Abertos: ${s.open}`,
      ``,
    );
  }

  const t = totalStats;
  const lostDetail = t.lost > 0 ? ` (PJ: ${t.lostPJ} | PF: ${t.lostPF})` : '';
  lines.push(
    `─────────────────────`,
    `📈 *Total Geral*`,
    `• Leads: *${t.total}*  ·  ✅ *${t.won}*  ·  ❌ *${t.lost}*${lostDetail}  ·  ⏳ *${t.open}*`,
  );

  return lines.join('\n');
}

// ── Dispara o relatório ─────────────────────────────────────────────────────
async function sendDailyReport(prisma) {
  console.log('[Relatório] ▶  Gerando relatório diário das 19h...');

  try {
    const { leads, byConsultant } = await collectData(prisma);

    if (leads.length === 0) {
      console.log('[Relatório] Nenhum lead no período 08h–18h. Relatório não enviado.');
      return;
    }

    // Stats globais
    const totalStats = calcStats(leads);

    // Relatório completo para admins + Google Chat
    const fullReport = buildFullReport(byConsultant, totalStats);
    await sendGoogleChat(fullReport);

    // Admins do banco
    const admins = await prisma.user.findMany({ where: { role: 'admin', active: true } });
    const adminPhones = new Set(admins.map(a => a.phone).filter(Boolean));
    const adminEmails = new Set(admins.map(a => a.email.toLowerCase()).filter(Boolean));

    for (const admin of admins) {
      if (admin.phone) {
        await sendWhatsApp(admin.phone, `Olá *${admin.name}*!\n\n${fullReport}`);
      }
    }

    // Consultores (SDR) — cada um recebe apenas o seu bloco
    for (const consultant of byConsultant.values()) {
      // Não manda duplicata para admins
      if (!consultant.email || adminEmails.has(consultant.email.toLowerCase())) continue;

      // Busca o usuário SDR pelo email do owner
      const sdr = await prisma.user.findFirst({
        where: { email: { equals: consultant.email, mode: 'insensitive' }, active: true },
      });

      if (!sdr?.phone) continue;

      const stats = calcStats(consultant.leads);
      const msg   = buildConsultantBlock(consultant.name, stats, sdr.name);
      await sendWhatsApp(sdr.phone, msg);
    }

    console.log(`[Relatório] ✅ Relatório enviado — ${leads.length} leads | ${byConsultant.size} consultor(es)`);
  } catch (err) {
    console.error('[Relatório] Erro ao gerar relatório:', err.message);
  }
}

// ── Agendamento às 19h todo dia ─────────────────────────────────────────────
function scheduleAt19h(prisma) {
  function msUntilNext19h() {
    const now  = new Date();
    const next = new Date(now);
    next.setHours(19, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1); // já passou, agenda para amanhã
    return next - now;
  }

  function schedule() {
    const delay = msUntilNext19h();
    const hh    = Math.round(delay / 3600000 * 10) / 10;
    console.log(`[Relatório] ⏰ Próximo relatório em ${hh}h (às 19:00)`);

    setTimeout(async () => {
      await sendDailyReport(prisma);
      schedule(); // reagenda para o próximo dia
    }, delay);
  }

  schedule();
}

module.exports = { scheduleAt19h, sendDailyReport };
