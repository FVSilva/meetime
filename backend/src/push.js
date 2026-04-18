const express = require('express');
const webpush = require('web-push');
const router = express.Router();

// Configura VAPID uma vez na importação
webpush.setVapidDetails(
  process.env.VAPID_EMAIL || 'mailto:admin@meetime.com.br',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

function db(req) { return req.app.get('prisma'); }

/** GET /api/push/vapid-public-key — frontend busca a chave pública */
router.get('/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

/** POST /api/push/subscribe — salva a subscription do browser */
router.post('/push/subscribe', async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Subscription inválida' });
  }

  await db(req).pushSubscription.upsert({
    where:  { endpoint },
    update: { p256dh: keys.p256dh, auth: keys.auth, userAgent: req.headers['user-agent'] },
    create: { endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: req.headers['user-agent'] },
  });

  res.json({ ok: true });
});

/** DELETE /api/push/unsubscribe */
router.delete('/push/unsubscribe', async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint obrigatório' });
  await db(req).pushSubscription.deleteMany({ where: { endpoint } }).catch(() => {});
  res.json({ ok: true });
});

/**
 * Envia push para TODOS os dispositivos inscritos.
 * Chamado pelos webhook handlers.
 */
async function sendPushToAll(prisma, payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;

  const subs = await prisma.pushSubscription.findMany();
  if (subs.length === 0) return;

  const data = JSON.stringify(payload);

  const results = await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        data
      ).catch(async err => {
        // Remove subscriptions expiradas/inválidas
        if (err.statusCode === 404 || err.statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => {});
        }
        throw err;
      })
    )
  );

  const ok  = results.filter(r => r.status === 'fulfilled').length;
  const err = results.filter(r => r.status === 'rejected').length;
  console.log(`[Push] Enviado para ${ok}/${subs.length} dispositivos${err ? ` (${err} falhas)` : ''}`);
}

module.exports = { router, sendPushToAll };
