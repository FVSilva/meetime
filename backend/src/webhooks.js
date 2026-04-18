const express = require('express');
const router = express.Router();
const { notifyNewLead, notifyNewActivity } = require('./notifications');
const { processCallRecording } = require('./transcription');
const { sendPushToAll } = require('./push');

// Helper para pegar prisma do app
function db(req) {
  return req.app.get('prisma');
}

/**
 * Endpoint principal de webhook da Meetime.
 * Configure no painel Meetime apontando para: POST /webhook/meetime
 *
 * Eventos suportados:
 *   lead.created      → notifica SDRs + salva lead
 *   lead.updated      → atualiza lead
 *   call.completed    → transcreve + analisa + salva
 *   activity.created  → notifica SDRs + salva atividade
 *   activity.updated  → atualiza atividade
 *   activity.completed→ marca como concluída
 */
router.post('/meetime', async (req, res) => {
  const prisma = db(req);
  const { event, data } = req.body;

  if (!event || !data) {
    return res.status(400).json({ error: 'Payload inválido: esperado { event, data }' });
  }

  // Salva o evento bruto para auditoria
  await prisma.webhookEvent.create({
    data: {
      eventType: event,
      payload: JSON.stringify(req.body),
    },
  }).catch(err => console.error('[Webhook] Erro ao salvar evento:', err.message));

  console.log(`[Webhook] Evento recebido: ${event}`);

  // Responde imediatamente (não bloqueia o Meetime)
  res.json({ received: true });

  // Processa de forma assíncrona
  handleEvent(prisma, event, data).catch(err =>
    console.error(`[Webhook] Erro ao processar ${event}:`, err.message)
  );
});

async function handleEvent(prisma, event, data) {
  switch (event) {
    case 'lead.created':
      await handleLeadCreated(prisma, data);
      break;
    case 'lead.updated':
      await handleLeadUpdated(prisma, data);
      break;
    case 'call.completed':
      await handleCallCompleted(prisma, data);
      break;
    case 'activity.created':
      await handleActivityCreated(prisma, data);
      break;
    case 'activity.updated':
    case 'activity.completed':
      await handleActivityUpdated(prisma, data, event);
      break;
    default:
      console.log(`[Webhook] Evento não mapeado: ${event}`);
  }
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleLeadCreated(prisma, data) {
  // Meetime pode mandar o owner em diferentes campos dependendo da versão
  const ownerEmail = data.assigned_to?.email || data.owner?.email || null;

  const lead = await prisma.lead.upsert({
    where: { externalId: String(data.id) },
    update: {},
    create: {
      externalId: String(data.id),
      name:       data.name        || 'Sem nome',
      email:      data.email       || null,
      phone:      data.phone       || data.mobile || null,
      company:    data.company     || data.account?.name || null,
      source:     data.source      || null,
      assignedTo: data.assigned_to?.name || data.owner?.name || null,
      ownerEmail,
      enteredAt:  data.created_at ? new Date(data.created_at) : new Date(),
    },
  });

  console.log(`[Lead] Criado: ${lead.name} | owner: ${ownerEmail || 'sem email'}`);
  await Promise.all([
    notifyNewLead(lead, prisma),
    sendPushToAll(prisma, {
      title: '🔔 Novo Lead!',
      body:  `${lead.name}${lead.company ? ' · ' + lead.company : ''}`,
      url:   '/leads',
      tag:   `lead-${lead.id}`,
    }),
  ]);
}

async function handleLeadUpdated(prisma, data) {
  const existing = await prisma.lead.findUnique({ where: { externalId: String(data.id) } });
  if (!existing) {
    await handleLeadCreated(prisma, data);
    return;
  }

  // Detecta primeiro contato
  const updates = {
    name:       data.name        || existing.name,
    email:      data.email       || existing.email,
    phone:      data.phone       || data.mobile || existing.phone,
    company:    data.company     || existing.company,
    status:     data.status      || existing.status,
    assignedTo: data.assigned_to?.name || existing.assignedTo,
    ownerEmail: data.assigned_to?.email || data.owner?.email || existing.ownerEmail,
    updatedAt:  new Date(),
  };

  if (data.status === 'contacted' && !existing.firstContactAt) {
    updates.firstContactAt = new Date();
    updates.responseTimeSec = Math.round(
      (new Date() - existing.enteredAt) / 1000
    );
  }

  await prisma.lead.update({ where: { id: existing.id }, data: updates });
  console.log(`[Lead] Atualizado: ${existing.name}`);
}

async function handleCallCompleted(prisma, data) {
  // Garante que o lead existe
  let lead = await prisma.lead.findUnique({ where: { externalId: String(data.lead_id || data.contact_id) } });

  if (!lead) {
    console.warn(`[Call] Lead ${data.lead_id} não encontrado no banco, criando rascunho.`);
    lead = await prisma.lead.create({
      data: {
        externalId: String(data.lead_id || data.contact_id || `call-${data.id}`),
        name: data.contact_name || 'Lead desconhecido',
        enteredAt: new Date(),
      },
    });
  }

  // Cria o registro da ligação
  const call = await prisma.call.upsert({
    where: { externalId: String(data.id) },
    update: { duration: data.duration, recordingUrl: data.recording_url },
    create: {
      externalId:   String(data.id),
      leadId:       lead.id,
      duration:     data.duration || 0,
      recordingUrl: data.recording_url || null,
      calledAt:     data.started_at ? new Date(data.started_at) : new Date(),
    },
  });

  // Se tem gravação, processa em background
  if (data.recording_url) {
    try {
      const result = await processCallRecording(data.recording_url, lead.name);

      await prisma.call.update({
        where: { id: call.id },
        data: {
          transcription: result.transcription,
          summary:       result.summary,
          sentiment:     result.sentiment,
          score:         result.score,
          feedback:      result.feedback,
        },
      });

      // Atualiza status do lead se for primeiro contato
      if (!lead.firstContactAt) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            firstContactAt: new Date(),
            status: 'contacted',
            responseTimeSec: Math.round((new Date() - lead.enteredAt) / 1000),
          },
        });
      }

      console.log(`[Call] Ligação ${call.id} processada. Score: ${result.score}`);
    } catch (err) {
      console.error(`[Call] Erro na transcrição:`, err.message);
      await prisma.call.update({
        where: { id: call.id },
        data: { feedback: `Erro na transcrição: ${err.message}` },
      });
    }
  }
}

async function handleActivityCreated(prisma, data) {
  const leadId = data.lead_id || data.contact_id;

  let lead = await prisma.lead.findUnique({ where: { externalId: String(leadId) } });

  if (!lead) {
    lead = await prisma.lead.create({
      data: {
        externalId: String(leadId || `act-${data.id}`),
        name: data.contact_name || 'Lead desconhecido',
        enteredAt: new Date(),
      },
    });
  }

  const activity = await prisma.activity.upsert({
    where: { externalId: String(data.id) },
    update: {},
    create: {
      externalId:  String(data.id),
      leadId:      lead.id,
      type:        data.type || data.kind || 'task',
      title:       data.title || data.subject || 'Atividade',
      description: data.description || null,
      scheduledAt: data.scheduled_at ? new Date(data.scheduled_at) : null,
      status:      'pending',
    },
  });

  console.log(`[Activity] Criada: ${activity.title} para ${lead.name}`);
  await Promise.all([
    notifyNewActivity(activity, lead, prisma),
    sendPushToAll(prisma, {
      title: '📋 Nova Atividade',
      body:  `${activity.title} · ${lead.name}`,
      url:   '/activities',
      tag:   `activity-${activity.id}`,
    }),
  ]);
}

async function handleActivityUpdated(prisma, data, event) {
  const existing = await prisma.activity.findUnique({ where: { externalId: String(data.id) } });

  if (!existing) {
    await handleActivityCreated(prisma, data);
    return;
  }

  await prisma.activity.update({
    where: { id: existing.id },
    data: {
      status:      event === 'activity.completed' ? 'done' : (data.status || existing.status),
      completedAt: event === 'activity.completed' ? new Date() : existing.completedAt,
      description: data.description || existing.description,
      updatedAt:   new Date(),
    },
  });

  console.log(`[Activity] Atualizada: ${existing.title} → ${event}`);
}

module.exports = router;
