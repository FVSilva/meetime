import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { ThumbsUp, ThumbsDown, Minus, Phone } from 'lucide-react';

const SENTIMENT = {
  positive: { label: 'Positivo', icon: ThumbsUp,   color: 'text-green-400 bg-green-900/30 border border-green-800/30'  },
  neutral:  { label: 'Neutro',   icon: Minus,       color: 'text-gray-400 bg-gray-900 border border-gray-800'           },
  negative: { label: 'Negativo', icon: ThumbsDown,  color: 'text-red-400 bg-red-900/30 border border-red-800/30'        },
};

function ScoreBadge({ score }) {
  if (!score) return <span className="text-gray-700 text-sm">—</span>;
  const color = score >= 75 ? 'text-green-400' : score >= 50 ? 'text-yellow-500' : 'text-red-500';
  return (
    <span className={`font-bold text-xl ${color}`}>
      {score}<span className="text-xs font-normal text-gray-600">/100</span>
    </span>
  );
}

function formatDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatDuration(sec) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const DEMO_CALLS = [
  { id: '1', lead: { name: 'Ana Souza', company: 'TechCorp' },     calledAt: '2026-04-17T09:15:00Z', duration: 342, score: 82, sentiment: 'positive', summary: 'Cliente demonstrou interesse no produto, solicitou proposta comercial. Reunião agendada para próxima semana.', transcription: 'SDR: Olá Ana, tudo bem? Aqui é João da Meetime...\nAna: Oi João, pode falar sim!', feedback: 'Ótima abertura e boa gestão do tempo. Para melhorar: aprofunde mais o levantamento de necessidades antes de falar do produto.' },
  { id: '2', lead: { name: 'Bruno Lima', company: 'Startup X' },   calledAt: '2026-04-17T10:45:00Z', duration: 87,  score: 45, sentiment: 'negative', summary: 'Lead sem interesse no momento. Retornar em 3 meses.',                                                           transcription: 'SDR: Bom dia Bruno...\nBruno: Desculpe, não tenho interesse agora.',            feedback: 'Ligue em horários alternativos. Tente compreender a objeção antes de encerrar a ligação.' },
  { id: '3', lead: { name: 'Carla Mendes', company: 'Beta' },      calledAt: '2026-04-16T15:00:00Z', duration: 612, score: 91, sentiment: 'positive', summary: 'Excelente conversa. Lead qualificado, envia contrato até sexta.',                                                transcription: 'SDR: Carla, como foi sua experiência com o trial?...',                           feedback: 'Ligação exemplar. Boa cadência, perguntas abertas, fechamento assertivo.' },
];

export default function Calls() {
  const [sentiment, setSentiment] = useState('');
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('summary');

  const params = new URLSearchParams();
  if (sentiment) params.set('sentiment', sentiment);

  const { data, loading } = useApi(`/calls?${params}`, [sentiment]);
  const calls = data?.calls || DEMO_CALLS;
  const current = calls.find(c => c.id === selected);

  return (
    <div className="flex h-full">
      {/* Lista */}
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-lg font-bold text-white">Ligações</h1>
          {!data && <span className="badge bg-red-900/30 text-red-400 border border-red-800/40">Demo</span>}
        </div>

        <div className="flex gap-3 mb-5">
          <select className="select" value={sentiment} onChange={e => setSentiment(e.target.value)}>
            <option value="">Todos os sentimentos</option>
            {Object.entries(SENTIMENT).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>

        {loading && <p className="text-xs text-gray-600">Carregando…</p>}

        <div className="space-y-3">
          {calls.map(call => {
            const s = SENTIMENT[call.sentiment] || SENTIMENT.neutral;
            const SIcon = s.icon;
            return (
              <div
                key={call.id}
                onClick={() => { setSelected(call.id === selected ? null : call.id); setTab('summary'); }}
                className={`card cursor-pointer transition-all hover:border-red-900/60 ${selected === call.id ? 'border-red-700/50 bg-red-950/10' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-gray-900 border border-gray-800 rounded-lg">
                      <Phone size={16} className="text-gray-500" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-100">{call.lead?.name || '—'}</p>
                      <p className="text-xs text-gray-600">
                        {call.lead?.company || ''} · {formatDate(call.calledAt)} · {formatDuration(call.duration)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${s.color}`}>
                      <SIcon size={11} /> {s.label}
                    </span>
                    <ScoreBadge score={call.score} />
                  </div>
                </div>
                {call.summary && (
                  <p className="mt-3 text-sm text-gray-500 line-clamp-2">{call.summary}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Painel de detalhes */}
      {selected && current && (
        <aside className="w-96 border-l border-gray-900 bg-black flex flex-col">
          <div className="p-5 border-b border-gray-900">
            <div className="flex items-center justify-between mb-1">
              <p className="font-semibold text-white">{current.lead?.name}</p>
              <button onClick={() => setSelected(null)} className="text-xs text-gray-600 hover:text-gray-400">✕</button>
            </div>
            <p className="text-xs text-gray-600">{formatDate(current.calledAt)} · {formatDuration(current.duration)}</p>

            {/* Tabs */}
            <div className="flex gap-1 mt-4">
              {[
                { key: 'summary',    label: 'Resumo'      },
                { key: 'transcript', label: 'Transcrição' },
                { key: 'feedback',   label: 'Feedback IA' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                    tab === key
                      ? 'bg-red-700 text-white'
                      : 'text-gray-500 hover:bg-gray-900 hover:text-gray-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {tab === 'summary' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <ScoreBadge score={current.score} />
                  {current.sentiment && (() => {
                    const s = SENTIMENT[current.sentiment];
                    const SI = s.icon;
                    return (
                      <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${s.color}`}>
                        <SI size={11} /> {s.label}
                      </span>
                    );
                  })()}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Resumo</p>
                  <p className="text-sm text-gray-300 leading-relaxed">
                    {current.summary || 'Resumo não disponível ainda.'}
                  </p>
                </div>
              </div>
            )}

            {tab === 'transcript' && (
              <div>
                <p className="text-xs font-semibold text-gray-600 uppercase mb-3">Transcrição</p>
                <pre className="text-xs text-gray-400 whitespace-pre-wrap leading-relaxed font-sans">
                  {current.transcription || 'Transcrição sendo processada…'}
                </pre>
              </div>
            )}

            {tab === 'feedback' && (
              <div>
                <p className="text-xs font-semibold text-gray-600 uppercase mb-3">Feedback para o SDR</p>
                <div className="bg-red-950/20 border border-red-900/40 rounded-lg p-4">
                  <p className="text-sm text-gray-300 leading-relaxed">
                    {current.feedback || 'Feedback será gerado após o processamento da ligação.'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
