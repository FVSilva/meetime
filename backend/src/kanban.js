const express = require('express');
const router = express.Router();

function db(req) { return req.app.get('prisma'); }

// Colunas padrão criadas na primeira vez
const DEFAULT_COLUMNS = [
  { name: 'Novos',        slug: 'new',       colorKey: 'gray',   position: 0 },
  { name: 'Contatados',   slug: 'contacted', colorKey: 'red',    position: 1 },
  { name: 'Qualificados', slug: 'qualified', colorKey: 'yellow', position: 2 },
  { name: 'Ganhos',       slug: 'won',       colorKey: 'green',  position: 3 },
  { name: 'Perdidos',     slug: 'lost',      colorKey: 'dark',   position: 4 },
];

/**
 * Garante que as colunas padrão existam.
 * Chamado no startup do servidor.
 */
async function seedDefaultColumns(prisma) {
  const count = await prisma.kanbanColumn.count();
  if (count === 0) {
    await prisma.kanbanColumn.createMany({ data: DEFAULT_COLUMNS });
    console.log('[Kanban] Colunas padrão criadas.');
  }
}

/** GET /api/kanban/columns */
router.get('/kanban/columns', async (req, res) => {
  const cols = await db(req).kanbanColumn.findMany({ orderBy: { position: 'asc' } });
  res.json(cols);
});

/** POST /api/kanban/columns */
router.post('/kanban/columns', async (req, res) => {
  const { name, colorKey = 'gray' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });

  // Gera slug único a partir do nome
  const base = name.trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  let slug = base;
  let suffix = 1;
  while (await db(req).kanbanColumn.findUnique({ where: { slug } })) {
    slug = `${base}-${suffix++}`;
  }

  // Posição = última + 1
  const last = await db(req).kanbanColumn.findFirst({ orderBy: { position: 'desc' } });
  const position = (last?.position ?? -1) + 1;

  const col = await db(req).kanbanColumn.create({
    data: { name: name.trim(), slug, colorKey, position },
  });
  res.status(201).json(col);
});

/** PATCH /api/kanban/columns/:id */
router.patch('/kanban/columns/:id', async (req, res) => {
  const { name, colorKey, position } = req.body;
  const data = { updatedAt: new Date() };
  if (name     !== undefined) data.name     = name.trim();
  if (colorKey !== undefined) data.colorKey = colorKey;
  if (position !== undefined) data.position = position;

  const col = await db(req).kanbanColumn.update({ where: { id: req.params.id }, data });
  res.json(col);
});

/** DELETE /api/kanban/columns/:id */
router.delete('/kanban/columns/:id', async (req, res) => {
  const prisma = db(req);

  const col = await prisma.kanbanColumn.findUnique({ where: { id: req.params.id } });
  if (!col) return res.status(404).json({ error: 'Coluna não encontrada' });

  // Move leads dessa coluna para "new" antes de excluir
  await prisma.lead.updateMany({
    where: { status: col.slug },
    data:  { status: 'new' },
  });

  await prisma.kanbanColumn.delete({ where: { id: req.params.id } });
  res.json({ ok: true, movedLeads: true });
});

/** PATCH /api/kanban/columns/reorder — recebe array de { id, position } */
router.patch('/kanban/reorder', async (req, res) => {
  const { order } = req.body; // [{ id, position }, ...]
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order deve ser um array' });

  await Promise.all(
    order.map(({ id, position }) =>
      db(req).kanbanColumn.update({ where: { id }, data: { position } })
    )
  );
  res.json({ ok: true });
});

module.exports = { router, seedDefaultColumns };
