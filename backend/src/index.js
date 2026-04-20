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

app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: err.message });
});

async function start() {
  // Cria colunas padrão na primeira vez
  await seedDefaultColumns(prisma);

  app.listen(PORT, () => {
    console.log(`✅ Meetime backend rodando na porta ${PORT}`);
    console.log(`   Webhook URL: http://localhost:${PORT}/webhook/meetime`);
    console.log(`   Dashboard:   http://localhost:${PORT}/api/dashboard`);
  });

  // Inicia polling de leads + monitor de inatividade
  startSync(prisma);
}

start().catch(console.error);

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
