const express = require('express');
const webpush  = require('web-push');
const router   = express.Router();

webpush.setVapidDetails(
  process.env.VAPID_EMAIL       || 'mailto:admin@meetime.com.br',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

function db(req) { return req.app.get('prisma'); }

// ── Rotas ────────────────────────────────────────────────────────────────────

/** GET /api/push/vapid-public-key */
router.get('/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

/**
 * POST /api/push/subscribe
 * Body: { endpoint, keys: { p256dh, auth }, userEmail }
 */
router.post('/push/subscribe', async (req, res) => {
  const { endpoint, keys, userEmail } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Subscription inválida' });
  }

  await db(req).pushSubscription.upsert({
    where:  { endpoint },
    update: {
      p256dh:    keys.p256dh,
      auth:      keys.auth,
      userEmail: userEmail || null,
      userAgent: req.headers['user-agent'],
    },
    create: {
      endpoint,
      p256dh:    keys.p256dh,
      auth:      keys.auth,
      userEmail: userEmail || null,
      userAgent: req.headers['user-agent'],
    },
  });

  console.log(`[Push] ✅ Inscrito: ${userEmail || 'anônimo'}`);
  res.json({ ok: true });
});

/** DELETE /api/push/unsubscribe */
router.delete('/push/unsubscribe', async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint obrigatório' });
  await db(req).pushSubscription.deleteMany({ where: { endpoint } }).catch(() => {});
  res.json({ ok: true });
});

// ── Funções internas de envio ─────────────────────────────────────────────────

async function _send(sub, payload) {
  return webpush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    JSON.stringify(payload)
  );
}

async function _dispatch(prisma, subs, payload, label) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  if (subs.length === 0) return;

  const results = await Promise.allSettled(
    subs.map(sub =>
      _send(sub, payload).catch(async err => {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => {});
        }
        throw err;
      })
    )
  );

  const ok  = results.filter(r => r.status === 'fulfilled').length;
  const fail = results.filter(r => r.status === 'rejected').length;
  if (ok > 0 || fail > 0) {
    console.log(`[Push] ${label} → ${ok}/${subs.length}${fail ? ` (${fail} falhas)` : ''}`);
  }
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Envia para TODOS os dispositivos inscritos.
 * Usado apenas como fallback quando não há usuários cadastrados.
 */
async function sendPushToAll(prisma, payload) {
  const subs = await prisma.pushSubscription.findMany();
  await _dispatch(prisma, subs, payload, 'todos');
}

/**
 * Envia apenas para dispositivos de usuários com role=admin.
 * Se não houver admins com push, cai no fallback (todos).
 */
async function sendPushToAdmins(prisma, payload) {
  // Busca emails dos admins
  const admins = await prisma.user.findMany({ where: { role: 'admin', active: true } });

  if (admins.length === 0) {
    // Sem admins cadastrados → envia para todos
    return sendPushToAll(prisma, payload);
  }

  const adminEmails = admins.map(a => a.email.toLowerCase());
  const subs = await prisma.pushSubscription.findMany({
    where: { userEmail: { in: adminEmails } },
  });

  if (subs.length === 0) {
    // Admins existem mas nenhum tem push ativo → envia para todos inscritos
    return sendPushToAll(prisma, payload);
  }

  await _dispatch(prisma, subs, payload, 'admins');
}

/**
 * Envia para admins + para o SDR dono do lead (ownerEmail com @v4company.com).
 * Usado quando chega um novo lead.
 */
async function sendPushToLeadOwner(prisma, payload, ownerEmail) {
  const adminUsers = await prisma.user.findMany({ where: { role: 'admin', active: true } });
  const adminEmails = adminUsers.map(a => a.email.toLowerCase());

  // Inclui o owner se tiver email @v4company.com
  const targets = new Set(adminEmails);
  if (ownerEmail && ownerEmail.toLowerCase().includes('@v4company.com')) {
    targets.add(ownerEmail.toLowerCase());
  }

  if (targets.size === 0) {
    return sendPushToAll(prisma, payload);
  }

  const subs = await prisma.pushSubscription.findMany({
    where: { userEmail: { in: Array.from(targets) } },
  });

  if (subs.length === 0) {
    return sendPushToAll(prisma, payload);
  }

  await _dispatch(prisma, subs, payload, `admins + owner(${ownerEmail || '-'})`);
}

module.exports = { router, sendPushToAll, sendPushToAdmins, sendPushToLeadOwner };
