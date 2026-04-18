import { useState, useEffect, useCallback, useRef } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, closestCorners,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Plus, Pencil, Trash2, Check, X, RefreshCw,
  Clock, Phone, Building2, GripVertical,
} from 'lucide-react';

// ── Paleta de cores ────────────────────────────────────────────────────────

const COLORS = {
  gray:   { border: 'border-gray-700',     dot: 'bg-gray-500',    count: 'bg-gray-800 text-gray-400',          swatch: 'bg-gray-500'    },
  red:    { border: 'border-red-700/60',   dot: 'bg-red-500',     count: 'bg-red-900/40 text-red-400',         swatch: 'bg-red-500'     },
  yellow: { border: 'border-yellow-600/60',dot: 'bg-yellow-500',  count: 'bg-yellow-900/40 text-yellow-400',   swatch: 'bg-yellow-500'  },
  green:  { border: 'border-green-700/60', dot: 'bg-green-500',   count: 'bg-green-900/40 text-green-400',     swatch: 'bg-green-500'   },
  blue:   { border: 'border-blue-700/60',  dot: 'bg-blue-400',    count: 'bg-blue-900/40 text-blue-400',       swatch: 'bg-blue-400'    },
  purple: { border: 'border-purple-700/60',dot: 'bg-purple-500',  count: 'bg-purple-900/40 text-purple-400',   swatch: 'bg-purple-500'  },
  orange: { border: 'border-orange-700/60',dot: 'bg-orange-500',  count: 'bg-orange-900/40 text-orange-400',   swatch: 'bg-orange-500'  },
  dark:   { border: 'border-gray-800',     dot: 'bg-gray-700',    count: 'bg-gray-900 text-gray-600',          swatch: 'bg-gray-700'    },
};

function colorOf(key) { return COLORS[key] || COLORS.gray; }

// ── Color picker ───────────────────────────────────────────────────────────

function ColorPicker({ value, onChange }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {Object.entries(COLORS).map(([key, c]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`w-5 h-5 rounded-full ${c.swatch} transition-transform hover:scale-110
            ${value === key ? 'ring-2 ring-white ring-offset-1 ring-offset-gray-950 scale-110' : ''}`}
        />
      ))}
    </div>
  );
}

// ── Card de lead ───────────────────────────────────────────────────────────

function LeadCard({ lead, isDragging }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging: isSelf } =
    useSortable({ id: lead.id });

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isSelf ? 0.3 : 1 };

  const rt = lead.responseTimeSec;
  const rtColor = !rt ? '' : rt <= 300 ? 'text-green-500' : rt <= 1800 ? 'text-yellow-500' : 'text-red-500';
  const rtLabel = !rt ? null : rt < 3600 ? `${Math.round(rt/60)}min` : `${(rt/3600).toFixed(1)}h`;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-gray-950 border border-gray-800 rounded-lg p-3 group
        hover:border-red-800/40 transition-all
        ${isDragging ? 'shadow-2xl shadow-black border-red-700/50 rotate-1 scale-105' : ''}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-100 text-sm truncate">{lead.name}</p>
          {lead.company && (
            <div className="flex items-center gap-1 mt-0.5">
              <Building2 size={10} className="text-gray-600 shrink-0" />
              <p className="text-xs text-gray-600 truncate">{lead.company}</p>
            </div>
          )}
        </div>
        <div {...attributes} {...listeners}
          className="shrink-0 text-gray-700 hover:text-gray-500 cursor-grab active:cursor-grabbing pt-0.5">
          <GripVertical size={13} />
        </div>
      </div>
      {(rtLabel || lead._count?.calls > 0 || lead.assignedTo) && (
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-gray-900">
          {rtLabel && (
            <span className={`flex items-center gap-1 text-xs ${rtColor}`}>
              <Clock size={10} />{rtLabel}
            </span>
          )}
          {lead._count?.calls > 0 && (
            <span className="flex items-center gap-1 text-xs text-gray-600">
              <Phone size={10} />{lead._count.calls}
            </span>
          )}
          {lead.assignedTo && (
            <span className="text-xs text-gray-700 truncate ml-auto">
              {lead.assignedTo.split(' ')[0]}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Header de coluna (editável) ────────────────────────────────────────────

function ColumnHeader({ col, leadCount, onSave, onDelete }) {
  const [editing, setEditing]     = useState(false);
  const [name, setName]           = useState(col.name);
  const [colorKey, setColorKey]   = useState(col.colorKey);
  const [deleting, setDeleting]   = useState(false);
  const inputRef                  = useRef();
  const c                         = colorOf(colorKey);

  function startEdit() { setName(col.name); setColorKey(col.colorKey); setEditing(true); }
  function cancel()    { setEditing(false); }

  async function save() {
    if (!name.trim()) return;
    await onSave(col.id, { name: name.trim(), colorKey });
    setEditing(false);
  }

  async function confirmDelete() {
    if (!deleting) { setDeleting(true); return; }
    await onDelete(col.id);
    setDeleting(false);
  }

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  if (editing) {
    return (
      <div className="px-3 pt-3 pb-2 space-y-2">
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
          className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded-lg px-2.5 py-1.5
            focus:outline-none focus:ring-2 focus:ring-red-600"
          placeholder="Nome da etapa"
        />
        <ColorPicker value={colorKey} onChange={setColorKey} />
        <div className="flex gap-1.5 pt-1">
          <button onClick={save} className="flex items-center gap-1 text-xs bg-red-700 hover:bg-red-600 text-white px-2.5 py-1 rounded-lg">
            <Check size={12} /> Salvar
          </button>
          <button onClick={cancel} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 px-2 py-1">
            <X size={12} /> Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between px-3 py-3 border-b border-gray-900 group/header">
      <div className="flex items-center gap-2 min-w-0">
        <div className={`w-2 h-2 rounded-full shrink-0 ${colorOf(col.colorKey).dot}`} />
        <span className="text-sm font-semibold text-gray-300 truncate">{col.name}</span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${colorOf(col.colorKey).count}`}>
          {leadCount}
        </span>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover/header:opacity-100 transition-opacity">
        <button onClick={startEdit}
          className="p-1 text-gray-600 hover:text-gray-300 rounded transition-colors" title="Editar">
          <Pencil size={12} />
        </button>
        <button
          onClick={confirmDelete}
          className={`p-1 rounded transition-colors ${deleting ? 'text-red-400 bg-red-900/30' : 'text-gray-600 hover:text-red-400'}`}
          title={deleting ? 'Clique novamente para confirmar' : 'Excluir coluna'}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

// ── Coluna ─────────────────────────────────────────────────────────────────

function Column({ col, leads, onSave, onDelete }) {
  const c = colorOf(col.colorKey);
  return (
    <div className={`flex flex-col w-64 shrink-0 bg-black rounded-xl border ${c.border}`}>
      <ColumnHeader col={col} leadCount={leads.length} onSave={onSave} onDelete={onDelete} />
      <div className="flex-1 p-2 space-y-2 min-h-28 overflow-y-auto max-h-[calc(100vh-200px)]">
        <SortableContext items={leads.map(l => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map(lead => <LeadCard key={lead.id} lead={lead} />)}
        </SortableContext>
        {leads.length === 0 && (
          <div className="h-16 flex items-center justify-center rounded-lg border border-dashed border-gray-900">
            <p className="text-xs text-gray-800">Sem leads</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Nova coluna ────────────────────────────────────────────────────────────

function NewColumnCard({ onCreate }) {
  const [open, setOpen]         = useState(false);
  const [name, setName]         = useState('');
  const [colorKey, setColorKey] = useState('gray');
  const [saving, setSaving]     = useState(false);
  const inputRef                = useRef();

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    await onCreate({ name: name.trim(), colorKey });
    setName(''); setColorKey('gray'); setOpen(false); setSaving(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 w-56 shrink-0 h-12 px-4 rounded-xl border border-dashed
          border-gray-800 text-gray-600 hover:border-red-800/50 hover:text-red-500 transition-colors text-sm"
      >
        <Plus size={16} /> Nova etapa
      </button>
    );
  }

  return (
    <div className="w-64 shrink-0 bg-black border border-red-800/40 rounded-xl p-4 space-y-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Nova etapa</p>
      <input
        ref={inputRef}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setOpen(false); }}
        className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded-lg px-3 py-2
          focus:outline-none focus:ring-2 focus:ring-red-600 placeholder-gray-600"
        placeholder="Ex: Em negociação"
      />
      <div>
        <p className="text-xs text-gray-600 mb-2">Cor</p>
        <ColorPicker value={colorKey} onChange={setColorKey} />
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={save} disabled={saving || !name.trim()}
          className="flex items-center gap-1.5 text-xs bg-red-700 hover:bg-red-600 disabled:opacity-50
            text-white px-3 py-1.5 rounded-lg transition-colors">
          <Check size={12} /> {saving ? 'Criando…' : 'Criar'}
        </button>
        <button onClick={() => setOpen(false)}
          className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 transition-colors">
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ── Kanban principal ───────────────────────────────────────────────────────

const DEMO_LEADS = [
  { id:'d1', name:'Ana Souza',    company:'TechCorp',  status:'new',       responseTimeSec:null, assignedTo:'João',  _count:{calls:0} },
  { id:'d2', name:'Bruno Lima',   company:'Startup X', status:'contacted', responseTimeSec:240,  assignedTo:'Maria', _count:{calls:1} },
  { id:'d3', name:'Carla Mendes', company:'Beta Ind.', status:'qualified', responseTimeSec:900,  assignedTo:'João',  _count:{calls:3} },
  { id:'d4', name:'Diego Ramos',  company:'Alfa Com.', status:'won',       responseTimeSec:600,  assignedTo:'Maria', _count:{calls:4} },
  { id:'d5', name:'Eva Costa',    company:'Nova Ltda', status:'new',       responseTimeSec:null, assignedTo:'João',  _count:{calls:0} },
];

export default function Kanban() {
  const [columns, setColumns]   = useState([]);
  const [leads, setLeads]       = useState([]);
  const [isDemo, setIsDemo]     = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const fetchAll = useCallback(async () => {
    try {
      const [colRes, leadRes] = await Promise.all([
        fetch('/api/kanban/columns'),
        fetch('/api/leads?limit=200'),
      ]);
      if (!colRes.ok || !leadRes.ok) throw new Error();
      const [cols, leadData] = await Promise.all([colRes.json(), leadRes.json()]);
      setColumns(cols);
      setLeads(leadData.leads || []);
      setIsDemo(false);
    } catch {
      setIsDemo(true);
      setLeads(DEMO_LEADS);
    }
    setLastUpdate(new Date());
  }, []);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 15000);
    return () => clearInterval(t);
  }, [fetchAll]);

  // Organiza leads por slug da coluna
  const byCol = columns.reduce((acc, col) => {
    acc[col.slug] = leads.filter(l => l.status === col.slug);
    return acc;
  }, {});

  const activeLead = activeId ? leads.find(l => l.id === activeId) : null;

  function colOfLead(leadId) {
    return columns.find(col => byCol[col.slug]?.some(l => l.id === leadId))?.slug;
  }

  function handleDragStart({ active }) { setActiveId(active.id); }

  async function handleDragEnd({ active, over }) {
    setActiveId(null);
    if (!over) return;
    const fromSlug = colOfLead(active.id);
    const toSlug   = columns.find(c => c.id === over.id || c.slug === over.id)?.slug
                  || colOfLead(over.id);
    if (!toSlug || fromSlug === toSlug) return;

    // Atualiza otimista
    setLeads(prev => prev.map(l => l.id === active.id ? { ...l, status: toSlug } : l));

    try {
      await fetch(`/api/leads/${active.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: toSlug }),
      });
    } catch { fetchAll(); }
  }

  async function handleSaveColumn(id, data) {
    await fetch(`/api/kanban/columns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    fetchAll();
  }

  async function handleDeleteColumn(id) {
    await fetch(`/api/kanban/columns/${id}`, { method: 'DELETE' });
    fetchAll();
  }

  async function handleCreateColumn(data) {
    await fetch('/api/kanban/columns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    fetchAll();
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-900 shrink-0">
        <div>
          <h1 className="text-lg font-bold text-white">Kanban</h1>
          <p className="text-xs text-gray-600 mt-0.5">
            Atualiza a cada 15s · {lastUpdate.toLocaleTimeString('pt-BR', { timeStyle: 'short' })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isDemo && <span className="badge bg-red-900/30 text-red-400 border border-red-800/40">Demo</span>}
          <button onClick={fetchAll} className="btn-ghost">
            <RefreshCw size={14} /> Atualizar
          </button>
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-4 h-full p-6 w-max">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {columns.map(col => (
              <Column
                key={col.id}
                col={col}
                leads={byCol[col.slug] || []}
                onSave={handleSaveColumn}
                onDelete={handleDeleteColumn}
              />
            ))}

            <DragOverlay>
              {activeLead ? <LeadCard lead={activeLead} isDragging /> : null}
            </DragOverlay>
          </DndContext>

          {/* Botão de nova coluna (fora do DndContext para não virar droppable) */}
          <NewColumnCard onCreate={handleCreateColumn} />
        </div>
      </div>
    </div>
  );
}
