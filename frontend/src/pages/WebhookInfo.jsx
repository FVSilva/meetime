import { useState } from 'react';
import { Copy, Check, Webhook, Zap } from 'lucide-react';

const EVENTS = [
  { event: 'lead.created',       desc: 'Novo lead criado no CRM'                  },
  { event: 'lead.updated',       desc: 'Lead atualizado (status, responsável...)'  },
  { event: 'call.completed',     desc: 'Ligação finalizada — inicia transcrição'   },
  { event: 'activity.created',   desc: 'Nova atividade gerada'                     },
  { event: 'activity.updated',   desc: 'Atividade atualizada'                      },
  { event: 'activity.completed', desc: 'Atividade marcada como concluída'          },
];

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handle} className="p-1.5 text-gray-600 hover:text-red-400 transition-colors">
      {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
    </button>
  );
}

function CodeBlock({ children }) {
  return (
    <div className="flex items-center justify-between bg-black border border-gray-900 rounded-lg px-4 py-3 font-mono text-sm text-gray-300">
      <span>{children}</span>
      <CopyButton text={children} />
    </div>
  );
}

export default function WebhookInfo() {
  const backendUrl = window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : `https://${window.location.hostname}`;

  const webhookUrl = `${backendUrl}/webhook/meetime`;

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-bold text-white">Configuração do Webhook</h1>
        <p className="text-sm text-gray-600 mt-1">
          Configure este endpoint no painel Meetime para receber eventos em tempo real.
        </p>
      </div>

      {/* URL */}
      <div className="card space-y-3">
        <div className="flex items-center gap-2 mb-3">
          <Webhook size={16} className="text-red-500" />
          <h2 className="text-sm font-semibold text-white">URL do Webhook</h2>
        </div>

        <div>
          <p className="text-xs text-gray-600 mb-1.5">Método: <span className="text-red-400 font-medium">POST</span></p>
          <CodeBlock>{webhookUrl}</CodeBlock>
        </div>

        <div className="bg-yellow-900/10 border border-yellow-800/30 rounded-lg p-3 text-xs text-yellow-400">
          <strong>Teste local com ngrok:</strong><br />
          <span className="font-mono text-yellow-300">npx ngrok http 3001</span>
          <br />Use a URL gerada no lugar de localhost.
        </div>
      </div>

      {/* Passos */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Zap size={16} className="text-red-500" />
          <h2 className="text-sm font-semibold text-white">Como configurar no Meetime</h2>
        </div>

        {[
          { n: 1, text: 'Acesse o painel Meetime → Configurações → Integrações → Webhooks' },
          { n: 2, text: 'Clique em "Adicionar Webhook"' },
          { n: 3, text: 'Cole a URL acima no campo de endpoint' },
          { n: 4, text: 'Selecione os eventos abaixo e salve' },
        ].map(({ n, text }) => (
          <div key={n} className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-red-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
              {n}
            </div>
            <p className="text-sm text-gray-400 pt-0.5">{text}</p>
          </div>
        ))}
      </div>

      {/* Eventos */}
      <div className="card">
        <h2 className="text-sm font-semibold text-white mb-3">Eventos para Assinar</h2>
        <div className="space-y-2">
          {EVENTS.map(({ event, desc }) => (
            <div key={event} className="flex items-center justify-between py-2 border-b border-gray-900 last:border-0">
              <div>
                <p className="font-mono text-sm text-red-400">{event}</p>
                <p className="text-xs text-gray-600">{desc}</p>
              </div>
              <CopyButton text={event} />
            </div>
          ))}
        </div>
      </div>

      {/* Payload de exemplo */}
      <div className="card">
        <h2 className="text-sm font-semibold text-white mb-3">Exemplo de Payload (lead.created)</h2>
        <pre className="text-xs text-gray-400 leading-relaxed overflow-x-auto">
{`{
  "event": "lead.created",
  "data": {
    "id": "12345",
    "name": "João Silva",
    "email": "joao@empresa.com",
    "phone": "11999999999",
    "company": "Empresa Ltda",
    "source": "site",
    "assigned_to": {
      "name": "Ana SDR",
      "email": "ana@v4company.com.br"
    },
    "created_at": "2026-04-17T10:00:00Z"
  }
}`}
        </pre>
      </div>
    </div>
  );
}
