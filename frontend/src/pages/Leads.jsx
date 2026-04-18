import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { Search, Clock, Phone, CheckCircle, XCircle, User } from 'lucide-react';

const STATUS_LABELS = {
  new:       { label: 'Novo',        color: 'bg-gray-800 text-gray-300'        },
  contacted: { label: 'Contatado',   color: 'bg-red-900/40 text-red-400'       },
  qualified: { label: 'Qualificado', color: 'bg-green-900/40 text-green-400'   },
  lost:      { label: 'Perdido',     color: 'bg-gray-900 text-gray-500'        },
  won:       { label: 'Ganho',       color: 'bg-green-800/40 text-green-300'   },
};

function formatTime(sec) {
  if (!sec) return '—';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)}h`;
}

function formatDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

const DEMO_LEADS = [
  { id: '1', name: 'Ana Souza',    company: 'TechCorp',      email: 'ana@techcorp.com',   status: 'contacted', enteredAt: '2026-04-17T09:00:00Z', responseTimeSec: 240,  _count: { calls: 2, activities: 3 } },
  { id: '2', name: 'Bruno Lima',   company: 'Startup X',     email: 'bruno@startupx.io',  status: 'new',       enteredAt: '2026-04-17T10:30:00Z', responseTimeSec: null, _count: { calls: 0, activities: 1 } },
  { id: '3', name: 'Carla Mendes', company: 'Indústria Beta', email: 'carla@beta.com',     status: 'qualified', enteredAt: '2026-04-16T14:00:00Z', responseTimeSec: 900,  _count: { calls: 3, activities: 5 } },
  { id: '4', name: 'Diego Ramos',  company: 'Comércio Alfa', email: 'diego@alfa.com',      status: 'lost',      enteredAt: '2026-04-15T08:00:00Z', responseTimeSec: 7200, _count: { calls: 1, activities: 2 } },
];

export default function Leads() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (search) params.set('search', search);

  const { data, loading } = useApi(`/leads?${params}`, [status, search]);
  const leads = data?.leads || DEMO_LEADS;

  const { data: detail } = useApi(selected ? `/leads/${selected}` : null, [selected]);

  return (
    <div className="flex h-full">
      {/* Lista */}
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-lg font-bold text-white">Leads</h1>
          {!data && <span className="badge bg-red-900/30 text-red-400 border border-red-800/40">Demo</span>}
        </div>

        {/* Filtros */}
        <div className="flex gap-3 mb-5">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
            <input
              className="input w-full pl-9"
              placeholder="Buscar nome, email, empresa…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select
            className="select"
            value={status}
            onChange={e => setStatus(e.target.value)}
          >
            <option value="">Todos os status</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>

        {loading && <p className="text-xs text-gray-600">Carregando…</p>}

        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-900">
              <tr>
                {['Lead', 'Status', 'Entrada', 'Resposta', 'Calls', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-900">
              {leads.map(lead => {
                const s = STATUS_LABELS[lead.status] || STATUS_LABELS.new;
                return (
                  <tr
                    key={lead.id}
                    onClick={() => setSelected(lead.id === selected ? null : lead.id)}
                    className={`cursor-pointer transition-colors ${selected === lead.id ? 'bg-red-950/20' : 'hover:bg-gray-950'}`}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-100">{lead.name}</p>
                      <p className="text-xs text-gray-600">{lead.company || lead.email || '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${s.color}`}>{s.label}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(lead.enteredAt)}</td>
                    <td className="px-4 py-3">
                      {lead.responseTimeSec ? (
                        <span className={`font-medium text-sm ${lead.responseTimeSec <= 300 ? 'text-green-500' : lead.responseTimeSec <= 1800 ? 'text-yellow-500' : 'text-red-500'}`}>
                          {formatTime(lead.responseTimeSec)}
                        </span>
                      ) : (
                        <span className="text-gray-700 text-xs">Aguardando</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-sm">{lead._count?.calls ?? 0}</td>
                    <td className="px-4 py-3 text-red-600 text-xs">Ver →</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Painel lateral */}
      {selected && (
        <aside className="w-80 border-l border-gray-900 bg-black overflow-y-auto p-5">
          <button onClick={() => setSelected(null)} className="text-xs text-gray-600 hover:text-gray-400 mb-4">
            ✕ Fechar
          </button>

          {detail ? (
            <>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-full bg-red-900/30 border border-red-800/40 flex items-center justify-center">
                  <User size={16} className="text-red-400" />
                </div>
                <div>
                  <p className="font-semibold text-white">{detail.name}</p>
                  <p className="text-xs text-gray-600">{detail.company || '—'}</p>
                </div>
              </div>

              <dl className="space-y-2 text-sm mb-5">
                {[
                  ['Email',          detail.email],
                  ['Telefone',       detail.phone],
                  ['Responsável',    detail.assignedTo],
                  ['Owner Email',    detail.ownerEmail],
                  ['Fonte',          detail.source],
                  ['Entrada',        formatDate(detail.enteredAt)],
                  ['Primeiro contato', formatDate(detail.firstContactAt)],
                  ['Tempo resposta', formatTime(detail.responseTimeSec)],
                ].map(([k, v]) => v ? (
                  <div key={k} className="flex justify-between gap-2 border-b border-gray-900 pb-2">
                    <dt className="text-gray-600 shrink-0">{k}</dt>
                    <dd className="font-medium text-gray-300 text-right break-all">{v}</dd>
                  </div>
                ) : null)}
              </dl>

              {detail.calls?.length > 0 && (
                <>
                  <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Ligações</p>
                  <div className="space-y-2 mb-4">
                    {detail.calls.slice(0, 5).map(c => (
                      <div key={c.id} className="bg-gray-950 border border-gray-900 rounded-lg p-3 text-xs">
                        <div className="flex justify-between mb-1">
                          <span className="text-gray-600">{formatDate(c.calledAt)}</span>
                          {c.score && <span className="font-bold text-red-400">{c.score}/100</span>}
                        </div>
                        {c.summary && <p className="text-gray-500 line-clamp-2">{c.summary}</p>}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {detail.activities?.length > 0 && (
                <>
                  <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Atividades</p>
                  <div className="space-y-1">
                    {detail.activities.slice(0, 5).map(a => (
                      <div key={a.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-gray-900">
                        {a.status === 'done'
                          ? <CheckCircle size={13} className="text-green-500 shrink-0" />
                          : <XCircle size={13} className="text-gray-700 shrink-0" />}
                        <span className="flex-1 text-gray-400">{a.title}</span>
                        <span className="text-gray-700">{formatDate(a.scheduledAt)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <p className="text-xs text-gray-600">Carregando…</p>
          )}
        </aside>
      )}
    </div>
  );
}
