const express = require('express');
const router = express.Router();

function db(req) { return req.app.get('prisma'); }

/** GET /api/users */
router.get('/users', async (req, res) => {
  const users = await db(req).user.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(users);
});

/** POST /api/users */
router.post('/users', async (req, res) => {
  const { name, email, phone, role } = req.body;

  if (!name || !email || !phone) {
    return res.status(400).json({ error: 'name, email e phone são obrigatórios' });
  }

  try {
    const user = await db(req).user.create({
      data: {
        name,
        email: email.toLowerCase().trim(),
        phone: phone.replace(/\D/g, ''),
        role: role === 'admin' ? 'admin' : 'sdr',
      },
    });
    res.status(201).json(user);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Este email já está cadastrado' });
    }
    throw err;
  }
});

/** PATCH /api/users/:id */
router.patch('/users/:id', async (req, res) => {
  const { name, email, phone, role, active } = req.body;
  const data = {};
  if (name  !== undefined) data.name   = name;
  if (email !== undefined) data.email  = email.toLowerCase().trim();
  if (phone !== undefined) data.phone  = phone.replace(/\D/g, '');
  if (role  !== undefined) data.role   = role === 'admin' ? 'admin' : 'sdr';
  if (active!== undefined) data.active = Boolean(active);

  const user = await db(req).user.update({ where: { id: req.params.id }, data });
  res.json(user);
});

/** DELETE /api/users/:id */
router.delete('/users/:id', async (req, res) => {
  await db(req).user.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
