const express = require('express');
const router = express.Router();

function db(req) { return req.app.get('prisma'); }

// ── Helpers de agrupamento por dia (funciona com SQLite e PostgreSQL) ─────────

function toDay(date) {
  return new Date(date).toISOString().split('T')[0]; // "2026-04-20"
}

function last7Days() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }
  return days;
}

function groupByDay(rows, dateField) {
  const map = {};
  for (const row of rows) {
    const day = toDay(row[dateField]);
    map[day] = (map[day] || 0) + 1;
  }
  return last7Days().map(day => ({ day, total: map[day] || 0 }));
}

function groupCallsByDay(calls) {
  const map = {};
  for (const call of calls) {
    const day = toDay(call.calledAt);
    if (!map[day]) map[day] = { total: 0, scoreSum: 0, scoreCount: 0 };
    map[day].total++;
    if (call.score != null) { map[day].scoreSum += call.score; map[day].scoreCount++; }
  }
  return last7Days().map(day => ({
    day,
    total:    map[day]?.total    || 0,
    avgScore: map[day]?.scoreCount
      ? Math.round(map[day].scoreSum / map[day].scoreCount)
      : 0,
  }));
}

// ── GET /api/dashboard ────────────────────────────────────────────────────────

router.get('/dashboard', async (req, res) => {
  const prisma = db(req);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalLeads,
    contactedLeads,
    avgResponseAgg,
    avgScoreAgg,
    leadsRaw,
    callsRaw,
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { firstContactAt: { not: null } } }),
    prisma.lead.aggregate({ _avg: { responseTimeSec: true }, where: { responseTimeSec: { not: null } } }),
    prisma.call.aggregate({ _avg: { score: true }, where: { score: { not: null } } }),
    prisma.lead.findMany({ where: { enteredAt: { gte: since7d } }, select: { enteredAt: true } }),
    prisma.call.findMany({ where: { calledAt:  { gte: since7d } }, select: { calledAt: true, score: true } }),
  ]);

  res.json({
    kpis: {
      totalLeads,
      contactedLeads,
      contactRate:    totalLeads > 0 ? Math.round((contactedLeads / totalLeads) * 100) : 0,
      avgResponseSec: Math.round(avgResponseAgg._avg.responseTimeSec || 0),
      avgScore:       Math.round(avgScoreAgg._avg.score || 0),
    },
    charts: {
      leadsPerDay: groupByDay(leadsRaw, 'enteredAt'),
      callsPerDay: groupCallsByDay(callsRaw),
    },
  });
});

// ── GET /api/leads ────────────────────────────────────────────────────────────

router.get('/leads', async (req, res) => {
  const prisma = db(req);
  const pgNum  = Math.max(1, parseInt(req.query.page)  || 1);
  const pgSize = Math.min(500, Math.max(1, parseInt(req.query.limit) || 20));
  const skip   = (pgNum - 1) * pgSize;
  const { status, search } = req.query;

  const where = {};
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { name:    { contains: search } },
      { email:   { contains: search } },
      { company: { contains: search } },
    ];
  }

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      skip,
      take: pgSize,
      orderBy: { enteredAt: 'desc' },
      include: { _count: { select: { activities: true, calls: true } } },
    }),
    prisma.lead.count({ where }),
  ]);

  res.json({ leads, total, page: pgNum, limit: pgSize });
});

// ── GET /api/leads/:id ────────────────────────────────────────────────────────

router.get('/leads/:id', async (req, res) => {
  const lead = await db(req).lead.findUnique({
    where: { id: req.params.id },
    include: {
      activities: { orderBy: { createdAt: 'desc' } },
      calls:      { orderBy: { calledAt:  'desc' } },
    },
  });
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
  res.json(lead);
});

// ── GET /api/calls ────────────────────────────────────────────────────────────

router.get('/calls', async (req, res) => {
  const prisma = db(req);
  const pgNum  = Math.max(1, parseInt(req.query.page)  || 1);
  const pgSize = Math.min(200, Math.max(1, parseInt(req.query.limit) || 20));
  const skip   = (pgNum - 1) * pgSize;
  const { sentiment } = req.query;

  const where = {};
  if (sentiment) where.sentiment = sentiment;

  const [calls, total] = await Promise.all([
    prisma.call.findMany({
      where, skip, take: pgSize,
      orderBy: { calledAt: 'desc' },
      include: { lead: { select: { name: true, company: true } } },
    }),
    prisma.call.count({ where }),
  ]);

  res.json({ calls, total, page: pgNum, limit: pgSize });
});

// ── GET /api/calls/:id ────────────────────────────────────────────────────────

router.get('/calls/:id', async (req, res) => {
  const call = await db(req).call.findUnique({
    where: { id: req.params.id },
    include: { lead: true },
  });
  if (!call) return res.status(404).json({ error: 'Ligação não encontrada' });
  res.json(call);
});

// ── GET /api/analytics ───────────────────────────────────────────────────────
// ?from=YYYY-MM-DD&to=YYYY-MM-DD  (padrão: hoje)

router.get('/analytics', async (req, res) => {
  const prisma = db(req);

  // Janela do período
  const todayStr = new Date().toISOString().split('T')[0];
  const fromStr  = req.query.from || todayStr;
  const toStr    = req.query.to   || todayStr;

  const from = new Date(`${fromStr}T00:00:00.000Z`);
  const to   = new Date(`${toStr}T23:59:59.999Z`);

  // Todos os leads do período (sem filtro de hora, para o calendário livre)
  const leads = await prisma.lead.findMany({
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

  // Heurística PJ/PF
  const isPJ = l => !!l.company;

  // Stats globais
  function calcStats(arr) {
    const won    = arr.filter(l => l.status === 'won').length;
    const lost   = arr.filter(l => l.status === 'lost').length;
    const open   = arr.filter(l => l.status !== 'won' && l.status !== 'lost').length;
    const lostPJ = arr.filter(l => l.status === 'lost' && isPJ(l)).length;
    const lostPF = arr.filter(l => l.status === 'lost' && !isPJ(l)).length;
    const total  = arr.length;
    return { total, won, lost, lostPJ, lostPF, open,
             conversionRate: total > 0 ? Math.round((won / total) * 100) : 0 };
  }

  // Funil por consultor: conta leads em cada estágio acumulativo
  function buildFunnel(arr) {
    const contacted = arr.filter(l => ['contacted','qualified','won','lost'].includes(l.status)).length;
    const qualified = arr.filter(l => ['qualified','won'].includes(l.status)).length;
    const won       = arr.filter(l => l.status === 'won').length;
    return [
      { stage: 'Recebidos',   count: arr.length,  pct: 100 },
      { stage: 'Contatados',  count: contacted,   pct: arr.length > 0 ? Math.round(contacted / arr.length * 100) : 0 },
      { stage: 'Qualificados',count: qualified,   pct: arr.length > 0 ? Math.round(qualified / arr.length * 100) : 0 },
      { stage: 'Convertidos', count: won,         pct: arr.length > 0 ? Math.round(won       / arr.length * 100) : 0 },
    ];
  }

  // Agrupa por consultor
  const map = new Map();
  for (const lead of leads) {
    const key = lead.assignedTo || '(sem responsável)';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(lead);
  }

  const consultants = [...map.entries()]
    .map(([name, arr]) => ({ name, ...calcStats(arr), funnel: buildFunnel(arr) }))
    .sort((a, b) => b.total - a.total);

  res.json({
    period: { from: fromStr, to: toStr },
    summary: calcStats(leads),
    consultants,
  });
});

// ── PATCH /api/leads/:id/status ───────────────────────────────────────────────

router.patch('/leads/:id/status', async (req, res) => {
  const prisma = db(req);
  const { status } = req.body;

  // Aceita qualquer slug de coluna Kanban (não só os 5 padrões)
  if (!status || typeof status !== 'string') {
    return res.status(400).json({ error: 'status é obrigatório' });
  }

  const updates = { status, updatedAt: new Date() };

  if (status === 'contacted') {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (lead && !lead.firstContactAt) {
      updates.firstContactAt  = new Date();
      updates.responseTimeSec = Math.round((new Date() - lead.enteredAt) / 1000);
    }
  }

  const lead = await prisma.lead.update({ where: { id: req.params.id }, data: updates });
  res.json(lead);
});

// ── GET /api/activities ───────────────────────────────────────────────────────

router.get('/activities', async (req, res) => {
  const prisma = db(req);
  const pgNum  = Math.max(1, parseInt(req.query.page)  || 1);
  const pgSize = Math.min(200, Math.max(1, parseInt(req.query.limit) || 20));
  const skip   = (pgNum - 1) * pgSize;
  const { status } = req.query;

  const where = {};
  if (status) where.status = status;

  const [activities, total] = await Promise.all([
    prisma.activity.findMany({
      where, skip, take: pgSize,
      orderBy: { createdAt: 'desc' },
      include: { lead: { select: { name: true, company: true } } },
    }),
    prisma.activity.count({ where }),
  ]);

  res.json({ activities, total });
});

// ── GET /api/messages ─────────────────────────────────────────────────────────
// ?channel=whatsapp|gchat  &status=sent|failed  &page=1  &limit=50

router.get('/messages', async (req, res) => {
  const prisma = db(req);
  const { channel, status, page = '1', limit = '50', to } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = {};
  if (channel) where.channel = channel;
  if (status)  where.status  = status;
  if (to)      where.to      = { contains: to };

  const [messages, total] = await Promise.all([
    prisma.messageLog.findMany({
      where,
      skip,
      take:    parseInt(limit),
      orderBy: { sentAt: 'desc' },
    }),
    prisma.messageLog.count({ where }),
  ]);

  // Resolve nome do destinatário pelo telefone (se não tiver)
  const phones = [...new Set(messages.filter(m => !m.toName && m.channel === 'whatsapp').map(m => m.to))];
  let userMap = {};
  if (phones.length > 0) {
    const users = await prisma.user.findMany({
      where: { phone: { in: phones } },
      select: { phone: true, name: true },
    });
    userMap = Object.fromEntries(users.map(u => [u.phone, u.name]));
  }

  const enriched = messages.map(m => ({
    ...m,
    toName: m.toName || userMap[m.to] || m.to,
  }));

  res.json({ messages: enriched, total, page: parseInt(page), limit: parseInt(limit) });
});

// ── GET /api/messages/conversations ──────────────────────────────────────────
// Agrupa por destinatário para o painel lateral estilo WhatsApp

router.get('/messages/conversations', async (req, res) => {
  const prisma = db(req);

  const all = await prisma.messageLog.findMany({
    orderBy: { sentAt: 'desc' },
    take: 1000,
  });

  // Resolve nomes
  const phones = [...new Set(all.filter(m => m.channel === 'whatsapp').map(m => m.to))];
  const users  = phones.length > 0
    ? await prisma.user.findMany({ where: { phone: { in: phones } }, select: { phone: true, name: true } })
    : [];
  const userMap = Object.fromEntries(users.map(u => [u.phone, u.name]));

  // Agrupa por destinatário
  const convMap = new Map();
  for (const m of all) {
    const key  = m.to;
    const name = m.toName || userMap[m.to] || m.to;
    if (!convMap.has(key)) {
      convMap.set(key, { to: key, toName: name, channel: m.channel, lastMessage: m.body, lastAt: m.sentAt, unread: 0, total: 0, failed: 0 });
    }
    const conv = convMap.get(key);
    conv.total++;
    if (m.status === 'failed') conv.failed++;
  }

  const conversations = [...convMap.values()].sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
  res.json(conversations);
});

module.exports = router;
