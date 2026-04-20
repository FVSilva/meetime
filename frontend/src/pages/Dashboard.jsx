import { useApi } from '../hooks/useApi';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { Users, Phone, Clock, Star } from 'lucide-react';

function KpiCard({ label, value, sub, icon: Icon, accent }) {
  return (
    <div className="card flex items-start gap-4">
      <div className={`p-3 rounded-xl shrink-0 ${accent}`}>
        <Icon size={18} className="text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-600 uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-white mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function formatResponseTime(sec) {
  if (!sec) return '—';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}min`;
  return `${(sec / 3600).toFixed(1)}h`;
}

// Gera dados demo com datas sempre atuais (últimos 7 dias)
function buildDemo() {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split('T')[0];
  });
  return {
    kpis: { totalLeads: 48, contactedLeads: 31, contactRate: 65, avgResponseSec: 420, avgScore: 74 },
    charts: {
      leadsPerDay: days.map((day, i) => ({ day, total: [5,8,4,11,7,9,4][i] })),
      callsPerDay: days.map((day, i) => ({ day, total: [3,6,2,8,5,7,3][i], avgScore: [70,75,68,80,72,78,74][i] })),
    },
  };
}
const DEMO = buildDemo();

const TT = {
  backgroundColor: '#0a0a0a',
  border: '1px solid #1a1a1a',
  borderRadius: 8,
  color: '#e5e7eb',
  fontSize: 12,
};

const dayLabel = (str) => {
  if (!str) return '';
  const [, , day] = str.split('-');
  return `Dia ${parseInt(day)}`;
};

export default function Dashboard() {
  const { data, loading, error } = useApi('/dashboard');
  const d = data || DEMO;
  const isDemo = !data;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Dashboard</h1>
          <p className="text-sm text-gray-600">Visão geral dos leads e atendimentos</p>
        </div>
        <div className="flex items-center gap-3">
          {isDemo && (
            <span className="badge bg-red-900/30 text-red-400 border border-red-800/40">
              Demo — conecte o backend
            </span>
          )}
          {loading && <span className="text-xs text-gray-600">Carregando…</span>}
          {error && <span className="text-xs text-red-500">Backend offline</span>}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total de Leads"       value={d.kpis.totalLeads}                                accent="bg-red-700"          icon={Users}  />
        <KpiCard label="Taxa de Contato"      value={`${d.kpis.contactRate}%`}  sub={`${d.kpis.contactedLeads} contatados`} accent="bg-red-900"   icon={Phone}  />
        <KpiCard label="Tempo Médio Resposta" value={formatResponseTime(d.kpis.avgResponseSec)}         sub="desde entrada do lead" accent="bg-gray-800"  icon={Clock}  />
        <KpiCard label="Score Médio IA"       value={d.kpis.avgScore ? `${d.kpis.avgScore}/100` : '—'} sub="avaliado pelo Claude"  accent="bg-gray-700"  icon={Star}   />
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-4">
            Leads por Dia — 7 dias
          </h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={d.charts.leadsPerDay} barSize={26}>
              <CartesianGrid strokeDasharray="3 3" stroke="#111" vertical={false} />
              <XAxis dataKey="day" tickFormatter={dayLabel} tick={{ fontSize: 11, fill: '#4b5563' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#4b5563' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TT} labelFormatter={dayLabel} formatter={(v) => [v, 'Leads']} cursor={{ fill: '#111' }} />
              <Bar dataKey="total" fill="#dc2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-4">
            Score de Ligações por Dia
          </h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={d.charts.callsPerDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="#111" vertical={false} />
              <XAxis dataKey="day" tickFormatter={dayLabel} tick={{ fontSize: 11, fill: '#4b5563' }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#4b5563' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TT} labelFormatter={dayLabel} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#6b7280' }} />
              <Line type="monotone" dataKey="avgScore" stroke="#ef4444" strokeWidth={2} dot={{ r: 3, fill: '#ef4444' }} name="Score Médio" />
              <Line type="monotone" dataKey="total"    stroke="#6b7280" strokeWidth={2} dot={{ r: 3, fill: '#6b7280' }} name="Ligações"    />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* SLA */}
      <div className="card">
        <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-4">Meta SLA de Resposta</h2>
        <div className="space-y-4">
          {[
            { label: 'Menos de 5 minutos',  target: 300  },
            { label: 'Menos de 30 minutos', target: 1800 },
            { label: 'Menos de 1 hora',     target: 3600 },
          ].map(({ label, target }) => {
            const avg = d.kpis.avgResponseSec || 0;
            const met = avg <= target;
            const pct = avg ? Math.min(100, Math.round((avg / target) * 100)) : 40;
            return (
              <div key={label}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-gray-500">{label}</span>
                  <span className={met ? 'text-green-500 font-medium' : 'text-red-500 font-medium'}>
                    {met ? '✓ Atingido' : `✗ ${formatResponseTime(avg)}`}
                  </span>
                </div>
                <div className="h-1.5 bg-gray-900 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${met ? 'bg-green-600' : 'bg-red-600'}`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
