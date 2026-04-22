import { useState, useEffect, useCallback, useRef } from 'react';
import { MessageCircle, RefreshCw, Search, CheckCircle, XCircle, Wifi } from 'lucide-react';

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
         ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtPhone(phone) {
  const d = phone.replace(/\D/g, '');
  if (d.length === 13) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`;
  return phone;
}

// Avatar com iniciais
function Avatar({ name, channel }) {
  const initials = (name || '?').split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
  const bg = channel === 'gchat' ? 'bg-blue-900/60 text-blue-300' : 'bg-green-900/60 text-green-300';
  return (
    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold ${bg}`}>
      {initials}
    </div>
  );
}

// Badge de canal
function ChannelBadge({ channel }) {
  if (channel === 'gchat') return (
    <span className="text-[9px] bg-blue-900/40 text-blue-400 border border-blue-800/40 px-1.5 py-0.5 rounded-full font-medium">
      GChat
    </span>
  );
  return (
    <span className="text-[9px] bg-green-900/40 text-green-400 border border-green-800/40 px-1.5 py-0.5 rounded-full font-medium">
      WhatsApp
    </span>
  );
}

// ── Painel esquerdo: lista de conversas ────────────────────────────────────

function ConvList({ conversations, selected, onSelect, search, onSearch }) {
  const filtered = conversations.filter(c =>
    (c.toName || c.to).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col w-72 shrink-0 border-r border-gray-900 h-full">
      {/* Header */}
      <div className="px-4 py-4 border-b border-gray-900">
        <p className="text-sm font-bold text-white mb-3">Mensagens</p>
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
          <input
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Buscar..."
            className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-8 pr-3 py-1.5
              text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-red-700"
          />
        </div>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-gray-700 text-xs gap-1">
            <MessageCircle size={20} className="text-gray-800" />
            Nenhuma conversa ainda
          </div>
        )}
        {filtered.map(c => {
          const isSelected = selected?.to === c.to;
          return (
            <button
              key={c.to}
              onClick={() => onSelect(c)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-gray-900/50
                ${isSelected ? 'bg-gray-900' : 'hover:bg-gray-950'}`}
            >
              <Avatar name={c.toName} channel={c.channel} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <p className="text-sm font-medium text-gray-200 truncate">{c.toName}</p>
                  <span className="text-[10px] text-gray-600 shrink-0">{fmtTime(c.lastAt)}</span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <p className="text-xs text-gray-600 truncate flex-1">{c.lastMessage.slice(0, 40)}…</p>
                  <div className="flex items-center gap-1 shrink-0 ml-1">
                    <ChannelBadge channel={c.channel} />
                    {c.failed > 0 && (
                      <span className="text-[9px] bg-red-900/40 text-red-400 px-1 py-0.5 rounded-full">
                        {c.failed} ✗
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Balão de mensagem ──────────────────────────────────────────────────────

function Bubble({ msg }) {
  const failed = msg.status === 'failed';
  return (
    <div className="flex flex-col items-end mb-3">
      <div className={`max-w-[75%] rounded-2xl rounded-tr-sm px-4 py-2.5 shadow
        ${failed
          ? 'bg-red-900/30 border border-red-800/40'
          : msg.channel === 'gchat'
            ? 'bg-blue-900/40 border border-blue-800/30'
            : 'bg-green-900/40 border border-green-800/30'
        }`}>
        <p className="text-sm text-gray-100 whitespace-pre-wrap leading-relaxed">{msg.body}</p>
      </div>
      <div className="flex items-center gap-1.5 mt-1 px-1">
        <span className="text-[10px] text-gray-600">{fmtTime(msg.sentAt)}</span>
        {failed
          ? <XCircle size={11} className="text-red-500" title={msg.error} />
          : <CheckCircle size={11} className="text-green-600" />
        }
        <ChannelBadge channel={msg.channel} />
      </div>
      {failed && msg.error && (
        <p className="text-[10px] text-red-500 mt-0.5 px-1 max-w-[75%] text-right">{msg.error}</p>
      )}
    </div>
  );
}

// ── Painel direito: mensagens da conversa ──────────────────────────────────

function ChatPanel({ conv }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading]   = useState(true);
  const bottomRef = useRef();

  const load = useCallback(async () => {
    if (!conv) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/messages?to=${encodeURIComponent(conv.to)}&limit=200`);
      const data = await res.json();
      // Ordena do mais antigo ao mais recente para o chat
      setMessages((data.messages || []).slice().reverse());
    } catch { setMessages([]); }
    setLoading(false);
  }, [conv]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [messages]);

  if (!conv) return (
    <div className="flex-1 flex flex-col items-center justify-center text-gray-700 gap-3">
      <MessageCircle size={40} className="text-gray-800" />
      <p className="text-sm">Selecione uma conversa</p>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Header da conversa */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-900 shrink-0">
        <Avatar name={conv.toName} channel={conv.channel} />
        <div>
          <p className="text-sm font-semibold text-white">{conv.toName}</p>
          <p className="text-xs text-gray-600">
            {conv.channel === 'whatsapp' ? fmtPhone(conv.to) : 'Google Chat'}
            {' · '}{conv.total} mensagem{conv.total !== 1 ? 's' : ''}
            {conv.failed > 0 && <span className="text-red-400"> · {conv.failed} falha{conv.failed !== 1 ? 's' : ''}</span>}
          </p>
        </div>
        <button onClick={load} className="ml-auto btn-ghost">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Área de mensagens */}
      <div className="flex-1 overflow-y-auto px-5 py-4"
        style={{ background: 'repeating-linear-gradient(0deg,transparent,transparent 39px,rgba(255,255,255,0.01) 40px)' }}>
        {loading && (
          <div className="flex justify-center py-10 text-gray-700 text-xs gap-2">
            <RefreshCw size={12} className="animate-spin" /> Carregando...
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div className="flex justify-center py-10 text-gray-700 text-xs">
            Nenhuma mensagem nesta conversa
          </div>
        )}
        {messages.map(m => <Bubble key={m.id} msg={m} />)}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────

export default function Messages() {
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected]           = useState(null);
  const [search, setSearch]               = useState('');
  const [loading, setLoading]             = useState(true);
  const [lastUpdate, setLastUpdate]       = useState(new Date());

  const loadConvs = useCallback(async () => {
    try {
      const res  = await fetch('/api/messages/conversations');
      const data = await res.json();
      setConversations(data);
    } catch { setConversations([]); }
    setLoading(false);
    setLastUpdate(new Date());
  }, []);

  useEffect(() => {
    loadConvs();
    const t = setInterval(loadConvs, 15000);
    return () => clearInterval(t);
  }, [loadConvs]);

  // Stats
  const totalMsgs  = conversations.reduce((s, c) => s + c.total, 0);
  const totalFailed = conversations.reduce((s, c) => s + c.failed, 0);
  const whatsCount  = conversations.filter(c => c.channel === 'whatsapp').length;
  const gchatCount  = conversations.filter(c => c.channel === 'gchat').length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-900 shrink-0">
        <div>
          <h1 className="text-lg font-bold text-white">Mensagens</h1>
          <p className="text-xs text-gray-600 mt-0.5">
            {totalMsgs} enviada{totalMsgs !== 1 ? 's' : ''} · {whatsCount} WhatsApp · {gchatCount} GChat
            {totalFailed > 0 && <span className="text-red-400"> · {totalFailed} falha{totalFailed !== 1 ? 's' : ''}</span>}
            {' · '}Atualiza a cada 15s · {lastUpdate.toLocaleTimeString('pt-BR', { timeStyle: 'short' })}
          </p>
        </div>
        <button onClick={loadConvs} className="btn-ghost flex items-center gap-1.5">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        <ConvList
          conversations={conversations}
          selected={selected}
          onSelect={setSelected}
          search={search}
          onSearch={setSearch}
        />
        <ChatPanel conv={selected} />
      </div>
    </div>
  );
}
