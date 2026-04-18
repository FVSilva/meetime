const express = require('express');
const router = express.Router();

function db(req) {
  return req.app.get('prisma');
}

/**
 * GET /api/dashboard
 * KPIs principais para o card do dashboard
 */
router.get('/dashboard', async (req, res) => {
  const prisma = db(req);

  const [
    totalLeads,
    contactedLeads,
    avgResponseSec,
    avgScore,
    leadsLast7Days,
    callsLast7Days,
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { firstContactAt: { not: null } } }),
    prisma.lead.aggregate({
      _avg: { responseTimeSec: true },
      where: { responseTimeSec: { not: null } },
    }),
    prisma.call.aggregate({
      _avg: { score: true },
      where: { score: { not: null } },
    }),
    // Leads por dia nos últimos 7 dias
    prisma.$queryRaw`
      SELECT date(enteredAt) as day, count(*) as total
      FROM Lead
      WHERE enteredAt >= datetime('now', '-7 days')
      GROUP BY day
      ORDER BY day ASC
    `,
    // Ligações por dia nos últimos 7 dias
    prisma.$queryRaw`
      SELECT date(calledAt) as day, count(*) as total, avg(score) as avgScore
      FROM Call
      WHERE calledAt >= datetime('now', '-7 days')
      GROUP BY day
      ORDER BY day ASC
    `,
  ]);

  const contactRate = totalLeads > 0
    ? Math.round((contactedLeads / totalLeads) * 100)
    : 0;

  res.json({
    kpis: {
      totalLeads,
      contactedLeads,
      contactRate,
      avgResponseSec: Math.round(avgResponseSec._avg.responseTimeSec || 0),
      avgScore: Math.round(avgScore._avg.score || 0),
    },
    charts: {
      leadsPerDay: leadsLast7Days,
      callsPerDay: callsLast7Days,
    },
  });
});

/**
 * GET /api/leads
 * Lista paginada de leads com filtros
 */
router.get('/leads', async (req, res) => {
  const prisma = db(req);
  const { status, page = '1', limit = '20', search } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

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
      take: parseInt(limit),
      orderBy: { enteredAt: 'desc' },
      include: {
        _count: { select: { activities: true, calls: true } },
      },
    }),
    prisma.lead.count({ where }),
  ]);

  res.json({ leads, total, page: parseInt(page), limit: parseInt(limit) });
});

/**
 * GET /api/leads/:id
 * Detalhes do lead com atividades e ligações
 */
router.get('/leads/:id', async (req, res) => {
  const prisma = db(req);

  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id },
    include: {
      activities: { orderBy: { createdAt: 'desc' } },
      calls:      { orderBy: { calledAt: 'desc' } },
    },
  });

  if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
  res.json(lead);
});

/**
 * GET /api/calls
 * Lista paginada de ligações com análise IA
 */
router.get('/calls', async (req, res) => {
  const prisma = db(req);
  const { page = '1', limit = '20', sentiment } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = {};
  if (sentiment) where.sentiment = sentiment;

  const [calls, total] = await Promise.all([
    prisma.call.findMany({
      where,
      skip,
      take: parseInt(limit),
      orderBy: { calledAt: 'desc' },
      include: { lead: { select: { name: true, company: true } } },
    }),
    prisma.call.count({ where }),
  ]);

  res.json({ calls, total, page: parseInt(page), limit: parseInt(limit) });
});

/**
 * GET /api/calls/:id
 * Detalhes de uma ligação (transcrição, resumo, feedback)
 */
router.get('/calls/:id', async (req, res) => {
  const prisma = db(req);

  const call = await prisma.call.findUnique({
    where: { id: req.params.id },
    include: { lead: true },
  });

  if (!call) return res.status(404).json({ error: 'Ligação não encontrada' });
  res.json(call);
});

/**
 * PATCH /api/leads/:id/status
 * Move o lead para uma nova coluna (drag manual ou webhook)
 */
router.patch('/leads/:id/status', async (req, res) => {
  const prisma = db(req);
  const { status } = req.body;

  const validStatuses = ['new', 'contacted', 'qualified', 'won', 'lost'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status inválido. Use: ${validStatuses.join(', ')}` });
  }

  const updates = { status, updatedAt: new Date() };

  // Se for o primeiro contato, registra o tempo
  if (status === 'contacted') {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (lead && !lead.firstContactAt) {
      updates.firstContactAt = new Date();
      updates.responseTimeSec = Math.round((new Date() - lead.enteredAt) / 1000);
    }
  }

  const lead = await prisma.lead.update({
    where: { id: req.params.id },
    data: updates,
  });

  res.json(lead);
});

/**
 * GET /api/activities
 */
router.get('/activities', async (req, res) => {
  const prisma = db(req);
  const { status, page = '1', limit = '20' } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = {};
  if (status) where.status = status;

  const [activities, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      skip,
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
      include: { lead: { select: { name: true, company: true } } },
    }),
    prisma.activity.count({ where }),
  ]);

  res.json({ activities, total });
});

module.exports = router;
