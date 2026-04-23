require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const webhookRouter = require('./webhooks');
const dashboardRouter = require('./dashboard');
const usersRouter = require('./users');
const whatsappRouter = require('./whatsapp');
const { router: kanbanRouter, seedDefaultColumns } = require('./kanban');
const { router: pushRouter } = require('./push');
const axios = require('axios');
const { startSync } = require('./meetime-sync');
const { startHealthMonitor, getHealthStatus } = require('./health-monitor');
const { scheduleAt19h } = require('./daily-report');
const { init: initLogger } = require('./message-logger');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.set('prisma', prisma);

app.use('/webhook', webhookRouter);
app.use('/api', dashboardRouter);
app.use('/api', usersRouter);
app.use('/api', whatsappRouter);
app.use('/api', kanbanRouter);
app.use('/api', pushRouter);

// ── Health check detalhado ────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const status = getHealthStatus();
  res.status(status.ok === false ? 503 : 200).json(status);
});

app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: err.message });
});

async function start() {
  initLogger(prisma); // Compartilha instância do prisma com message-logger
  await seedDefaultColumns(prisma);

  app.listen(PORT, () => {
    console.log(`✅ Meetime backend rodando na porta ${PORT}`);
    console.log(`   Webhook URL: http://localhost:${PORT}/webhook/meetime`);
    console.log(`   Dashboard:   http://localhost:${PORT}/api/dashboard`);
    console.log(`   Health:      http://localhost:${PORT}/health`);
  });

  // Inicia jobs e pega os restarters
  const jobRestarters = startSync(prisma);

  // Inicia monitor de saúde com capacidade de reiniciar jobs
  startHealthMonitor(prisma, jobRestarters);

  // Relatório diário às 19h BRT
  scheduleAt19h(prisma);

  // ── Keep-alive: auto-ping a cada 4 min para não dormir no Render free ────────
  // Render dorme após 15 min sem requisições; combinado com UptimeRobot (5 min)
  // garante que o servidor fique acordado 24/7
  const selfUrl = process.env.RENDER_EXTERNAL_URL;
  if (selfUrl) {
    setInterval(() => {
      axios.get(`${selfUrl}/health`).catch(() => {});
    }, 4 * 60 * 1000);
    console.log(`[KeepAlive] Auto-ping ativo → ${selfUrl}/health (a cada 4 min)`);
  }
}

start().catch(console.error);

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
