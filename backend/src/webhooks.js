const express = require('express');
const router = express.Router();
const { notifyNewLead } = require('./notifications');
const { processCallRecording } = require('./transcription');
const { sendPushToLeadOwner } = require('./push');

// Helper para pegar prisma do app
function db(req) {
  return req.app.get('prisma');
}

/**
 * Endpoint principal de webhook da Meetime.
 * Configure no painel Meetime apontando para: POST /webhook/meetime
 *
 * Eventos suportados (conforme painel Meetime):
 *   lead.won              → Lead Ganho      → marca status won + notifica
 *   lead.lost             → Lead Perdido    → marca status lost + notifica
 *   call.started          → Ligação iniciada
 *   call.completed        → Ligação finalizada → transcreve + analisa
 *   call.updated          → Ligação atualizada
 *   activity.flow.done    → Atividade Flow Feita   → salva + notifica
 *   activity.flow.ignored → Atividade Flow Ignorada → salva
 *
 * Obs: "lead chegando" NÃO é um evento de webhook disponível.
 *      Novos leads são detectados via polling da API (meetime-sync.js).
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
    // ── Leads ─────────────────────────────────────────────
    case 'lead.won':
      await handleLeadStatusChange(prisma, data, 'won', '🏆 Lead Ganho');
      break;
    case 'lead.lost':
      await handleLeadStatusChange(prisma, data, 'lost', '❌ Lead Perdido');
      break;

    // ── Ligações ──────────────────────────────────────────
    case 'call.started':
      await handleCallStarted(prisma, data);
      break;
    case 'call.completed':
      await handleCallCompleted(prisma, data);
      break;
    case 'call.updated':
      await handleCallUpdatedEvent(prisma, data);
      break;

    // ── Atividades Flow ───────────────────────────────────
    case 'activity.flow.done':
      await handleFlowActivity(prisma, data, 'done');
      break;
    case 'activity.flow.ignored':
      await handleFlowActivity(prisma, data, 'ignored');
      break;

    // ── Legados (mantidos por compatibilidade) ────────────
    case 'lead.created':
      await handleLeadCreated(prisma, data);
      break;
    case 'lead.updated':
      await handleLeadUpdated(prisma, data);
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

  const leadData = {
    name:       data.name        || 'Sem nome',
    email:      data.email       || null,
    phone:      data.phone       || data.mobile || null,
    company:    data.company     || data.account?.name || null,
    source:     data.source      || null,
    assignedTo: data.assigned_to?.name || data.owner?.name || null,
    ownerEmail,
  };

  const lead = await prisma.lead.upsert({
    where:  { externalId: String(data.id) },
    update: { ...leadData, updatedAt: new Date() },
    create: { externalId: String(data.id), ...leadData, enteredAt: data.created_at ? new Date(data.created_at) : new Date() },
  });

  console.log(`[Lead] Criado: ${lead.name} | owner: ${ownerEmail || 'sem email'}`);
  await Promise.all([
    notifyNewLead(lead, prisma),
    sendPushToLeadOwner(prisma, {
      title: '🔔 Novo Lead!',
      body:  `${lead.name}${lead.company ? ' · ' + lead.company : ''}`,
      url:   '/leads',
      tag:   `lead-${lead.id}`,
    }, ownerEmail),
  ]);
}

const TERMINAL_STATUS = ['won', 'lost'];

async function handleLeadUpdated(prisma, data) {
  const existing = await prisma.lead.findUnique({ where: { externalId: String(data.id) } });
  if (!existing) {
    await handleLeadCreated(prisma, data);
    return;
  }

  // Proteção: nunca retrocede de won/lost para status anterior
  // Status só avança via handleLeadStatusChange (lead.won / lead.lost)
  let newStatus = existing.status;
  if (data.status && !TERMINAL_STATUS.includes(existing.status)) {
    newStatus = data.status; // só aceita mudança se ainda não estiver em terminal
  }

  const updates = {
    name:       data.name        || existing.name,
    email:      data.email       || existing.email,
    phone:      data.phone       || data.mobile || existing.phone,
    company:    data.company     || existing.company,
    status:     newStatus,
    assignedTo: data.assigned_to?.name || existing.assignedTo,
    ownerEmail: data.assigned_to?.email || data.owner?.email || existing.ownerEmail,
    updatedAt:  new Date(),
  };

  if (newStatus === 'contacted' && !existing.firstContactAt) {
    updates.firstContactAt  = new Date();
    updates.responseTimeSec = Math.round((new Date() - existing.enteredAt) / 1000);
  }

  await prisma.lead.update({ where: { id: existing.id }, data: updates });
  console.log(`[Lead] Atualizado: ${existing.name} [${existing.status} → ${newStatus}]`);
}

async function handleCallCompleted(prisma, data) {
  const lead = await prisma.lead.findUnique({ where: { externalId: String(data.lead_id || data.contact_id) } });

  if (!lead) {
    console.warn(`[Call] Lead ${data.lead_id} não encontrado no banco — evento ignorado.`);
    return;
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

  const lead = await prisma.lead.findUnique({ where: { externalId: String(leadId) } });

  if (!lead) {
    console.warn(`[Activity] Lead ${leadId} não encontrado no banco — evento ignorado.`);
    return;
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
}

// ── Handlers novos ──────────────────────────────────────────────────────────

async function handleLeadStatusChange(prisma, data, newStatus, label) {
  const externalId = String(data.id || data.lead_id);
  const lead = await prisma.lead.findUnique({ where: { externalId } });

  if (!lead) {
    console.warn(`[Webhook] ${label}: lead ${externalId} não encontrado — evento ignorado.`);
    return;
  }

  // Nunca retrocede de status terminal
  if (['won', 'lost'].includes(lead.status) && lead.status !== newStatus) {
    console.warn(`[Webhook] ${label}: lead ${lead.name} já está em "${lead.status}" — sem regressão.`);
    return;
  }

  await prisma.lead.update({
    where: { id: lead.id },
    data:  { status: newStatus, updatedAt: new Date() },
  });

  console.log(`[Webhook] ${label}: ${lead.name}`);
}

async function handleCallStarted(prisma, data) {
  const leadExternalId = String(data.lead_id || data.contact_id || '');
  const lead = leadExternalId
    ? await prisma.lead.findUnique({ where: { externalId: leadExternalId } })
    : null;

  if (!lead) {
    console.warn(`[Call] Lead ${leadExternalId} não encontrado — call.started ignorado.`);
    return;
  }

  await prisma.call.upsert({
    where: { externalId: String(data.id) },
    update: {},
    create: {
      externalId:  String(data.id),
      leadId:      lead.id,
      duration:    0,
      recordingUrl: null,
      calledAt:    data.started_at ? new Date(data.started_at) : new Date(),
    },
  });

  // Marca o lead como "em contato" se for o primeiro
  if (!lead.firstContactAt) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        firstContactAt:  new Date(),
        status:          'contacted',
        responseTimeSec: Math.round((new Date() - lead.enteredAt) / 1000),
      },
    });
  }

  console.log(`[Webhook] 📞 Ligação iniciada para: ${lead.name}`);
}

async function handleCallUpdatedEvent(prisma, data) {
  const call = await prisma.call.findUnique({ where: { externalId: String(data.id) } });
  if (!call) return;

  await prisma.call.update({
    where: { id: call.id },
    data: {
      duration:     data.duration     || call.duration,
      recordingUrl: data.recording_url || call.recordingUrl,
      updatedAt:    new Date(),
    },
  });

  console.log(`[Webhook] Ligação atualizada: ${call.id}`);
}

async function handleFlowActivity(prisma, data, outcome) {
  // outcome: 'done' | 'ignored'
  const leadId = data.lead_id || data.contact_id;
  const lead = leadId
    ? await prisma.lead.findUnique({ where: { externalId: String(leadId) } })
    : null;

  if (!lead) {
    console.warn(`[Flow] Lead ${leadId} não encontrado — activity.flow.${outcome} ignorado.`);
    return;
  }

  const activity = await prisma.activity.upsert({
    where: { externalId: String(data.id) },
    update: {
      status:      outcome === 'done' ? 'done' : 'cancelled',
      completedAt: new Date(),
      updatedAt:   new Date(),
    },
    create: {
      externalId:  String(data.id),
      leadId:      lead.id,
      type:        data.type || 'flow',
      title:       data.title || data.subject || 'Atividade Flow',
      description: data.description || null,
      scheduledAt: data.scheduled_at ? new Date(data.scheduled_at) : null,
      status:      outcome === 'done' ? 'done' : 'cancelled',
      completedAt: new Date(),
    },
  });

  // Atualiza o updatedAt do lead para reset do contador de inatividade
  await prisma.lead.update({
    where: { id: lead.id },
    data:  { updatedAt: new Date() },
  });

  const icon = outcome === 'done' ? '✅' : '⏭️';
  console.log(`[Webhook] ${icon} Flow ${outcome}: ${activity.title} — ${lead.name}`);

  // Sem notificação para flow — alertas apenas para novos leads
}

// ── Handlers existentes ──────────────────────────────────────────────────────

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
