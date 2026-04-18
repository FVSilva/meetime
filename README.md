# Meetime Integration

Backend Node.js + Dashboard React para integração com a plataforma Meetime.

## Funcionalidades

- **Webhooks** — recebe eventos de leads, ligações e atividades em tempo real
- **Notificações** — WhatsApp (Z-API) e Google Chat quando entra novo lead ou atividade
- **Transcrição** — Whisper transcreve as gravações automaticamente
- **Análise IA** — Claude gera resumo, sentimento, score e feedback para o SDR
- **Dashboard** — KPIs de tempo de resposta, taxa de contato e score médio
- **Leads** — tabela filtrável com painel lateral de detalhes
- **Ligações** — resumo, transcrição e feedback IA por ligação
- **Atividades** — histórico de todas as atividades do CRM

---

## Pré-requisitos

- Node.js 18+
- Conta Meetime com acesso à API
- (Opcional) Conta Z-API para notificações WhatsApp
- (Opcional) Google Chat com webhook configurado
- (Opcional) OpenAI API Key para transcrição Whisper
- (Opcional) Anthropic API Key para análise Claude

---

## Instalação

### 1. Backend

```bash
cd backend
cp .env.example .env
# Preencha o .env com suas credenciais
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Acesse: http://localhost:5173

---

## Configurar o Webhook no Meetime

1. No painel Meetime: **Configurações → Integrações → Webhooks**
2. Adicione a URL: `https://seu-dominio.com/webhook/meetime`
3. Selecione os eventos: `lead.created`, `lead.updated`, `call.completed`, `activity.created`, `activity.updated`, `activity.completed`

### Testando localmente com ngrok

```bash
npx ngrok http 3001
# Copie a URL https://xxxx.ngrok.io e configure no Meetime como:
# https://xxxx.ngrok.io/webhook/meetime
```

---

## Variáveis de ambiente (.env)

| Variável | Descrição |
|---|---|
| `MEETIME_API_TOKEN` | Token da API Meetime (Configurações → API) |
| `OPENAI_API_KEY` | Chave OpenAI para transcrição Whisper |
| `ANTHROPIC_API_KEY` | Chave Anthropic para análise Claude |
| `ZAPI_INSTANCE_ID` | ID da instância Z-API (WhatsApp) |
| `ZAPI_TOKEN` | Token Z-API |
| `NOTIF_PHONES` | Números DDI+DDD+número separados por vírgula |
| `GOOGLE_CHAT_WEBHOOK_URL` | URL do webhook do Google Chat |

---

## Estrutura do projeto

```
meetime/
├── backend/
│   ├── src/
│   │   ├── index.js          # Servidor Express
│   │   ├── webhooks.js       # Handlers dos eventos Meetime
│   │   ├── notifications.js  # WhatsApp + Google Chat
│   │   ├── transcription.js  # Whisper + Claude
│   │   └── dashboard.js      # API REST para o frontend
│   └── prisma/
│       └── schema.prisma     # Schema do banco (SQLite)
└── frontend/
    └── src/
        ├── pages/
        │   ├── Dashboard.jsx  # KPIs e gráficos
        │   ├── Leads.jsx      # Lista e detalhes de leads
        │   ├── Calls.jsx      # Ligações com IA
        │   └── Activities.jsx # Atividades
        └── components/
            └── Sidebar.jsx
```
