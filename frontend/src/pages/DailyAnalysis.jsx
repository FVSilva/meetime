import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  TrendingUp, Users, CheckCircle, XCircle, Clock,
  ChevronLeft, ChevronRight, RefreshCw, Building2, User,
} from 'lucide-react';

// ── Helpers de data ────────────────────────────────────────────────────────

function toISO(d) { return d.toISOString().split('T')[0]; }

function fmtDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

// ── KPI card ───────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon: Icon, color }) {
  const colors = {
    gray:   'text-gray-400  bg-gray-900   border-gray-800',
    green:  'text-green-400 bg-green-900/20 border-green-800/40',
    red:    'text-red-400   bg-red-900/20   border-red-800/40',
    yellow: 'text-yellow-400 bg-yellow-900/20 border-yellow-800/40',
    blue:   'text-blue-400  bg-blue-900/20  border-blue-800/40',
  };
  return (
    <div className={`rounded-xl border p-4 flex items-start gap-3 ${colors[color] || colors.gray}`}>
      <div className="shrink-0 mt-0.5">
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 font-medium">{label}</p>
        <p className="text-2xl font-bold text-white mt-0.5">{value}</p>
        {sub && <p className="text-xs mt-0.5 opacity-70">{sub}</p>}
      </div>
    </div>
  );
}

// ── Funil visual (barras horizontais) ─────────────────────────────────────

const FUNNEL_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#22c55e'];

function FunnelBar({ stage, count, pct, color, maxCount }) {
  const width = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-24 shrink-0 text-right">{stage}</span>
      <div className="flex-1 bg-gray-900 rounded-full h-5 overflow-hidden">
        <div
          className="h-full rounded-full flex items-center justify-end pr-2 transition-all duration-500"
          style={{ width: `${Math.max(width, count > 0 ? 8 : 0)}%`, backgroundColor: color }}
        >
          {count > 0 && <span className="text-[10px] font-bold text-white">{count}</span>}
        </div>
      </div>
      <span className="text-xs text-gray-600 w-8 shrink-0">{pct}%</span>
    </div>
  );
}

// ── Card de consultor ──────────────────────────────────────────────────────

function ConsultantCard({ c }) {
  const maxCount = c.funnel[0]?.count || 1;
  return (
    <div className="bg-black border border-gray-900 rounded-xl p-4 hover:border-gray-800 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-red-900/30 border border-red-800/40
            flex items-center justify-center shrink-0">
            <User size={14} className="text-red-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{c.name}</p>
            <p className="text-xs text-gray-600">{c.total} lead{c.total !== 1 ? 's' : ''} no período</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-white">{c.conversionRate}%</p>
          <p className="text-[10px] text-gray-600">conversão</p>
        </div>
      </div>

      {/* Funil */}
      <div className="space-y-2 mb-4">
        {c.funnel.map((f, i) => (
          <FunnelBar key={f.stage} {...f} color={FUNNEL_COLORS[i]} maxCount={maxCount} />
        ))}
      </div>

      {/* Stats linha */}
      <div className="grid grid-cols-4 gap-2 pt-3 border-t border-gray-900">
        <Stat label="Recebidos" value={c.total}  color="text-gray-400" />
        <Stat label="Ganhos"    value={c.won}    color="text-green-400" />
        <Stat label="Perdidos"  value={c.lost}   color="text-red-400"
          sub={c.lost > 0 ? `PJ ${c.lostPJ} · PF ${c.lostPF}` : null} />
        <Stat label="Em aberto" value={c.open}   color="text-yellow-400" />
      </div>
    </div>
  );
}

function Stat({ label, value, color, sub }) {
  return (
    <div className="text-center">
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-gray-600 leading-tight">{label}</p>
      {sub && <p className="text-[9px] text-gray-700 leading-tight">{sub}</p>}
    </div>
  );
}

// ── Seletor de período ─────────────────────────────────────────────────────

function PeriodPicker({ from, to, onChange }) {
  const [editing, setEditing] = useState(false);
  const [tmp, setTmp] = useState({ from, to });

  function apply() {
    if (tmp.from > tmp.to) return;
    onChange(tmp.from, tmp.to);
    setEditing(false);
  }

  const presets = [
    { label: 'Hoje',     days: 0  },
    { label: 'Ontem',    days: -1 },
    { label: '7 dias',   days: -6 },
    { label: '30 dias',  days: -29 },
  ];

  function applyPreset(days) {
    const t = toISO(new Date());
    const f = addDays(t, days);
    onChange(f, t);
    setEditing(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => { setTmp({ from, to }); setEditing(v => !v); }}
        className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-lg
          px-3 py-2 text-sm text-gray-300 hover:border-gray-700 transition-colors"
      >
        <Clock size={14} className="text-gray-500" />
        {from === to ? fmtDate(from) : `${fmtDate(from)} → ${fmtDate(to)}`}
      </button>

      {editing && (
        <div className="absolute right-0 top-10 z-50 bg-gray-950 border border-gray-800 rounded-xl
          shadow-2xl p-4 w-72 space-y-3">
          {/* Presets */}
          <div className="flex flex-wrap gap-1.5">
            {presets.map(p => (
              <button key={p.label} onClick={() => applyPreset(p.days)}
                className="text-xs bg-gray-900 hover:bg-gray-800 border border-gray-800
                  text-gray-400 hover:text-white px-2.5 py-1 rounded-lg transition-colors">
                {p.label}
              </button>
            ))}
          </div>

          <div className="border-t border-gray-900 pt-3 space-y-2">
            <div>
              <label className="text-xs text-gray-600 block mb-1">De</label>
              <input type="date" value={tmp.from}
                max={tmp.to}
                onChange={e => setTmp(v => ({ ...v, from: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-800 text-white text-sm rounded-lg
                  px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-600
                  [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">Até</label>
              <input type="date" value={tmp.to}
                min={tmp.from} max={toISO(new Date())}
                onChange={e => setTmp(v => ({ ...v, to: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-800 text-white text-sm rounded-lg
                  px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-600
                  [color-scheme:dark]"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={apply}
              className="flex-1 bg-red-700 hover:bg-red-600 text-white text-sm py-1.5
                rounded-lg transition-colors font-medium">
              Aplicar
            </button>
            <button onClick={() => setEditing(false)}
              className="text-gray-500 hover:text-gray-300 text-sm px-3 transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Mini gráfico de barras (conversão por consultor) ──────────────────────

const BAR_TOOLTIP = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs">
      <p className="text-gray-300 font-medium mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.fill }}>
          {p.name}: <strong>{p.value}</strong>
        </p>
      ))}
    </div>
  );
};

// ── Página principal ───────────────────────────────────────────────────────

export default function DailyAnalysis() {
  const today = toISO(new Date());
  const [from, setFrom]     = useState(today);
  const [to, setTo]         = useState(today);
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (f, t) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics?from=${f}&to=${t}`);
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(from, to); }, [from, to, load]);

  function handlePeriod(f, t) {
    setFrom(f); setTo(t);
  }

  function shiftDay(n) {
    const f = addDays(from, n);
    const t = addDays(to, n);
    if (t > today) return;
    setFrom(f); setTo(t);
  }

  const s = data?.summary;
  const isToday = from === today && to === today;
  const periodLabel = from === to ? fmtDate(from) : `${fmtDate(from)} → ${fmtDate(to)}`;

  // Dados para gráfico de comparação entre consultores
  const chartData = (data?.consultants || []).map(c => ({
    name: c.name.split(' ')[0],
    Recebidos:   c.total,
    Ganhos:      c.won,
    Perdidos:    c.lost,
    'Em aberto': c.open,
  }));

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-900 shrink-0">
        <div>
          <h1 className="text-lg font-bold text-white">Análise Diária</h1>
          <p className="text-xs text-gray-600 mt-0.5">{periodLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Navegação de dia */}
          <div className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-lg p-0.5">
            <button onClick={() => shiftDay(-1)}
              className="p-1.5 text-gray-500 hover:text-white rounded-md transition-colors">
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs text-gray-400 px-1">{isToday ? 'Hoje' : periodLabel}</span>
            <button onClick={() => shiftDay(1)} disabled={to >= today}
              className="p-1.5 text-gray-500 hover:text-white rounded-md transition-colors disabled:opacity-30">
              <ChevronRight size={14} />
            </button>
          </div>

          <PeriodPicker from={from} to={to} onChange={handlePeriod} />

          <button onClick={() => load(from, to)}
            className="btn-ghost flex items-center gap-1.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-auto p-6 space-y-6">

        {loading && (
          <div className="flex items-center justify-center h-48 text-gray-600 text-sm gap-2">
            <RefreshCw size={16} className="animate-spin" /> Carregando...
          </div>
        )}

        {!loading && !data && (
          <div className="flex items-center justify-center h-48 text-gray-600 text-sm">
            Erro ao carregar dados. Verifique a conexão com o backend.
          </div>
        )}

        {!loading && data && (
          <>
            {/* KPIs do período */}
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
              <KpiCard icon={Users}       label="Leads recebidos" value={s.total}
                sub={`${data.consultants.length} consultor(es)`} color="gray" />
              <KpiCard icon={CheckCircle} label="Convertidos"     value={s.won}
                sub={`${s.conversionRate}% de conversão`} color="green" />
              <KpiCard icon={XCircle}     label="Perdidos"        value={s.lost}
                sub={s.lost > 0 ? `PJ: ${s.lostPJ} · PF: ${s.lostPF}` : 'Nenhum'}
                color="red" />
              <KpiCard icon={Clock}       label="Em aberto"       value={s.open}
                sub="sem desfecho ainda" color="yellow" />
              <KpiCard icon={TrendingUp}  label="Taxa de conversão" value={`${s.conversionRate}%`}
                sub={`${s.won} ganhos de ${s.total}`} color="blue" />
            </div>

            {/* Gráfico comparativo entre consultores */}
            {chartData.length > 0 && (
              <div className="bg-black border border-gray-900 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-gray-300 mb-4">
                  Comparativo por consultor
                </h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} barGap={2}>
                    <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} width={24} />
                    <Tooltip content={<BAR_TOOLTIP />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                    <Bar dataKey="Recebidos"   fill="#4b5563" radius={[4,4,0,0]} maxBarSize={32} />
                    <Bar dataKey="Ganhos"      fill="#22c55e" radius={[4,4,0,0]} maxBarSize={32} />
                    <Bar dataKey="Perdidos"    fill="#ef4444" radius={[4,4,0,0]} maxBarSize={32} />
                    <Bar dataKey="Em aberto"   fill="#eab308" radius={[4,4,0,0]} maxBarSize={32} />
                  </BarChart>
                </ResponsiveContainer>
                {/* Legenda */}
                <div className="flex items-center gap-4 mt-1 justify-center flex-wrap">
                  {[['Recebidos','#4b5563'],['Ganhos','#22c55e'],['Perdidos','#ef4444'],['Em aberto','#eab308']].map(([l,c]) => (
                    <span key={l} className="flex items-center gap-1.5 text-xs text-gray-500">
                      <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: c }} />
                      {l}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Cards por consultor com funil */}
            {data.consultants.length > 0 ? (
              <>
                <h2 className="text-sm font-semibold text-gray-400 flex items-center gap-2">
                  <Building2 size={14} /> Funil por consultor
                </h2>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {data.consultants.map(c => (
                    <ConsultantCard key={c.name} c={c} />
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-48 text-gray-700 gap-2">
                <Users size={32} className="text-gray-800" />
                <p className="text-sm">Nenhum lead no período selecionado</p>
                <p className="text-xs">Tente outro intervalo de datas</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
