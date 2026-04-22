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
const { startSync } = require('./meetime-sync');
const { startHealthMonitor, getHealthStatus } = require('./health-monitor');

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
}

start().catch(console.error);

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
