import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { UserPlus, Trash2, ShieldCheck, User, Phone, Mail } from 'lucide-react';

const ROLE_STYLE = {
  admin: 'text-red-400 bg-red-900/30 border border-red-800/30',
  sdr:   'text-gray-400 bg-gray-900 border border-gray-800',
};

const EMPTY = { name: '', email: '', phone: '', role: 'sdr' };

function formatPhone(raw = '') {
  const d = raw.replace(/\D/g, '');
  if (d.length === 13) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`;
  return raw;
}

export default function Users() {
  const [form, setForm]         = useState(EMPTY);
  const [saving, setSaving]     = useState(false);
  const [formError, setFormError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const { data, reload }        = useApi('/users');
  const users                   = Array.isArray(data) ? data : [];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) { setFormError(json.error || 'Erro ao salvar'); return; }
      setForm(EMPTY);
      setShowForm(false);
      reload();
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (user) => {
    await fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !user.active }),
    });
    reload();
  };

  const deleteUser = async (id) => {
    if (!confirm('Remover este usuário?')) return;
    await fetch(`/api/users/${id}`, { method: 'DELETE' });
    reload();
  };

  const admins = users.filter(u => u.role === 'admin');
  const sdrs   = users.filter(u => u.role === 'sdr');

  return (
    <div className="p-6 max-w-3xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Usuários</h1>
          <p className="text-sm text-gray-600 mt-0.5">
            Admins recebem todos os leads. SDRs recebem apenas os seus.
          </p>
        </div>
        <button onClick={() => setShowForm(v => !v)} className="btn-primary">
          <UserPlus size={15} /> Novo usuário
        </button>
      </div>

      {/* Formulário */}
      {showForm && (
        <div className="card" style={{ borderColor: 'rgba(153,27,27,0.4)' }}>
          <h2 className="text-sm font-semibold text-white mb-4">Cadastrar usuário</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Nome</label>
                <input
                  className="input w-full"
                  placeholder="João Silva"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Email (deve bater com o Meetime)</label>
                <input
                  className="input w-full"
                  type="email"
                  placeholder="joao@v4company.com.br"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">WhatsApp (DDI+DDD+número)</label>
                <input
                  className="input w-full"
                  placeholder="5511999999999"
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Papel</label>
                <select
                  className="select w-full"
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                >
                  <option value="sdr">SDR — recebe apenas seus leads</option>
                  <option value="admin">Admin — recebe todos os leads</option>
                </select>
              </div>
            </div>

            {formError && <p className="text-xs text-red-400">{formError}</p>}

            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-ghost">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Regras */}
      <div className="card">
        <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Como funciona</h2>
        <div className="space-y-2 text-sm text-gray-400">
          <div className="flex gap-2.5">
            <ShieldCheck size={16} className="text-red-500 shrink-0 mt-0.5" />
            <span>
              <span className="text-red-400 font-medium">Admin</span> — recebe notificação WhatsApp de{' '}
              <strong className="text-white">todos</strong> os novos leads e atividades
            </span>
          </div>
          <div className="flex gap-2.5">
            <User size={16} className="text-gray-500 shrink-0 mt-0.5" />
            <span>
              <span className="text-gray-300 font-medium">SDR</span> — recebe apenas leads onde o email do
              responsável no Meetime <strong className="text-white">bate exatamente</strong> com o email cadastrado aqui
            </span>
          </div>
        </div>
      </div>

      {/* Admins */}
      {admins.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <ShieldCheck size={13} className="text-red-500" /> Admins ({admins.length})
          </h2>
          <UserTable users={admins} onToggle={toggleActive} onDelete={deleteUser} />
        </section>
      )}

      {/* SDRs */}
      {sdrs.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <User size={13} className="text-gray-500" /> SDRs ({sdrs.length})
          </h2>
          <UserTable users={sdrs} onToggle={toggleActive} onDelete={deleteUser} />
        </section>
      )}

      {users.length === 0 && !showForm && (
        <div className="card text-center py-12">
          <User size={32} className="text-gray-800 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Nenhum usuário cadastrado ainda.</p>
          <p className="text-gray-700 text-xs mt-1">Clique em "Novo usuário" para começar.</p>
        </div>
      )}
    </div>
  );
}

function UserTable({ users, onToggle, onDelete }) {
  return (
    <div className="card p-0 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-900">
          <tr>
            {['Usuário', 'Contato', 'Papel', 'Status', ''].map(h => (
              <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-900">
          {users.map(u => (
            <tr key={u.id} className={`transition-colors hover:bg-gray-950 ${!u.active ? 'opacity-40' : ''}`}>
              <td className="px-4 py-3">
                <p className="font-medium text-gray-100">{u.name}</p>
              </td>
              <td className="px-4 py-3 space-y-0.5">
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <Mail size={11} /> {u.email}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <Phone size={11} /> {formatPhone(u.phone)}
                </div>
              </td>
              <td className="px-4 py-3">
                <span className={`badge ${ROLE_STYLE[u.role]}`}>
                  {u.role === 'admin' ? 'Admin' : 'SDR'}
                </span>
              </td>
              <td className="px-4 py-3">
                <button
                  onClick={() => onToggle(u)}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                    u.active
                      ? 'bg-green-900/30 text-green-400 border border-green-800/30 hover:bg-red-900/30 hover:text-red-400 hover:border-red-800/30'
                      : 'bg-gray-900 text-gray-600 border border-gray-800 hover:bg-green-900/30 hover:text-green-400'
                  }`}
                >
                  {u.active ? 'Ativo' : 'Inativo'}
                </button>
              </td>
              <td className="px-4 py-3">
                <button
                  onClick={() => onDelete(u.id)}
                  className="p-1.5 text-gray-700 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
