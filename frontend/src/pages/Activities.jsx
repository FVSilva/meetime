import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { CheckCircle, Clock, XCircle, Mail, Phone, MessageSquare, Calendar, ClipboardList } from 'lucide-react';

const TYPE_ICON = { call: Phone, email: Mail, whatsapp: MessageSquare, meeting: Calendar, task: ClipboardList };

const STATUS = {
  pending:   { label: 'Pendente',  icon: Clock,       color: 'text-yellow-400 bg-yellow-900/20 border border-yellow-800/30' },
  done:      { label: 'Concluída', icon: CheckCircle, color: 'text-green-400 bg-green-900/20 border border-green-800/30'   },
  cancelled: { label: 'Cancelada', icon: XCircle,     color: 'text-gray-500 bg-gray-900 border border-gray-800'            },
};

function formatDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

const DEMO = [
  { id: '1', lead: { name: 'Ana Souza',    company: 'TechCorp'      }, type: 'call',    title: 'Ligação de follow-up',          status: 'done',    scheduledAt: '2026-04-17T09:00:00Z', completedAt: '2026-04-17T09:15:00Z' },
  { id: '2', lead: { name: 'Bruno Lima',   company: 'Startup X'     }, type: 'email',   title: 'Enviar proposta comercial',     status: 'pending', scheduledAt: '2026-04-17T14:00:00Z' },
  { id: '3', lead: { name: 'Carla Mendes', company: 'Beta'          }, type: 'meeting', title: 'Demo do produto',               status: 'pending', scheduledAt: '2026-04-18T10:00:00Z' },
  { id: '4', lead: { name: 'Diego Ramos',  company: 'Alfa'          }, type: 'task',    title: 'Pesquisar histórico do cliente', status: 'done',    scheduledAt: '2026-04-15T08:00:00Z' },
];

export default function Activities() {
  const [status, setStatus] = useState('');
  const { data, loading } = useApi(`/activities?${status ? `status=${status}` : ''}`, [status]);
  const activities = data?.activities || DEMO;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-bold text-white">Atividades</h1>
        {!data && <span className="badge bg-red-900/30 text-red-400 border border-red-800/40">Demo</span>}
      </div>

      <div className="mb-5">
        <select className="select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      {loading && <p className="text-xs text-gray-600">Carregando…</p>}

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-900">
            <tr>
              {['Tipo', 'Atividade', 'Lead', 'Status', 'Agendado', 'Concluído'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-900">
            {activities.map(act => {
              const s = STATUS[act.status] || STATUS.pending;
              const SIcon = s.icon;
              const TIcon = TYPE_ICON[act.type] || ClipboardList;
              return (
                <tr key={act.id} className="hover:bg-gray-950 transition-colors">
                  <td className="px-4 py-3"><TIcon size={15} className="text-gray-600" /></td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-200">{act.title}</p>
                    {act.description && <p className="text-xs text-gray-600 line-clamp-1">{act.description}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-gray-300">{act.lead?.name || '—'}</p>
                    <p className="text-xs text-gray-600">{act.lead?.company || ''}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`flex items-center gap-1.5 w-fit text-xs font-medium px-2.5 py-1 rounded-full ${s.color}`}>
                      <SIcon size={11} /> {s.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{formatDate(act.scheduledAt)}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{formatDate(act.completedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
