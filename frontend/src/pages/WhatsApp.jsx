import { useState, useEffect, useRef } from 'react';
import { Smartphone, Wifi, WifiOff, RefreshCw, Trash2, CheckCircle } from 'lucide-react';

const STATUS_CONFIG = {
  open:       { label: 'Conectado',    color: 'text-green-400',  bg: 'bg-green-900/20 border-green-800/30',  dot: 'bg-green-400' },
  connecting: { label: 'Aguardando',   color: 'text-yellow-400', bg: 'bg-yellow-900/20 border-yellow-800/30',dot: 'bg-yellow-400 animate-pulse' },
  close:      { label: 'Desconectado', color: 'text-gray-500',   bg: 'bg-gray-900 border-gray-800',          dot: 'bg-gray-600' },
};

export default function WhatsApp() {
  const [status, setStatus]   = useState('close');   // open | connecting | close
  const [qrcode, setQrcode]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [instance, setInstance] = useState('');
  const pollRef = useRef(null);
  const qrRef   = useRef(null);

  // Verifica status ao montar
  useEffect(() => {
    checkStatus();
    return () => { clearAllTimers(); };
  }, []);

  function clearAllTimers() {
    if (pollRef.current) clearInterval(pollRef.current);
    if (qrRef.current)   clearTimeout(qrRef.current);
  }

  async function checkStatus() {
    try {
      const res = await fetch('/api/whatsapp/status');
      const json = await res.json();
      const state = json.state || 'close';
      setStatus(state);
      setInstance(json.instanceName || '');

      if (state === 'open') {
        setQrcode(null);
        clearAllTimers();
      } else if (state === 'connecting') {
        // Instância existe mas QR ainda não está no estado — busca automaticamente
        fetchQr();
      }
    } catch {
      setStatus('close');
    }
  }

  async function fetchQr() {
    try {
      const r = await fetch('/api/whatsapp/qrcode');
      const d = await r.json();
      if (d.qrcode) setQrcode(d.qrcode);
    } catch {}
  }

  async function connect() {
    setLoading(true);
    setError('');
    setQrcode(null);
    clearAllTimers();

    try {
      const res = await fetch('/api/whatsapp/connect', { method: 'POST' });
      const json = await res.json();

      if (!res.ok) { setError(json.error || 'Erro ao conectar'); return; }

      setInstance(json.instanceName);
      setQrcode(json.qrcode);
      setStatus('connecting');

      // Renova o QR a cada 20s (QR expira em ~20s na Evolution)
      qrRef.current = setInterval(async () => {
        try {
          const r = await fetch('/api/whatsapp/qrcode');
          const d = await r.json();
          if (d.qrcode) setQrcode(d.qrcode);
        } catch {}
      }, 20000);

      // Verifica conexão a cada 3s
      pollRef.current = setInterval(async () => {
        const r = await fetch('/api/whatsapp/status');
        const d = await r.json();
        setStatus(d.state || 'close');
        if (d.state === 'open') {
          setQrcode(null);
          clearAllTimers();
        }
      }, 3000);

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function disconnect() {
    if (!confirm('Desconectar o WhatsApp? A instância será removida.')) return;
    clearAllTimers();
    setQrcode(null);
    try {
      await fetch('/api/whatsapp/disconnect', { method: 'DELETE' });
    } finally {
      setStatus('close');
    }
  }

  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.close;

  return (
    <div className="p-6 max-w-xl space-y-5">
      <div>
        <h1 className="text-lg font-bold text-white">WhatsApp</h1>
        <p className="text-sm text-gray-600 mt-0.5">
          Conecte via Evolution API para enviar notificações aos consultores.
        </p>
      </div>

      {/* Status card */}
      <div className={`card border flex items-center justify-between ${cfg.bg}`}>
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
          <div>
            <p className={`font-semibold text-sm ${cfg.color}`}>{cfg.label}</p>
            {instance && (
              <p className="text-xs text-gray-600 font-mono mt-0.5">instância: {instance}</p>
            )}
          </div>
        </div>
        {status === 'open' && <CheckCircle size={20} className="text-green-400" />}
        {status === 'close' && <WifiOff size={20} className="text-gray-600" />}
        {status === 'connecting' && (
          <RefreshCw size={18} className="text-yellow-400 animate-spin" />
        )}
      </div>

      {/* Erro */}
      {error && (
        <div className="bg-red-950/30 border border-red-800/40 rounded-lg px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* QR Code */}
      {qrcode && status !== 'open' && (
        <div className="card flex flex-col items-center gap-4 py-6">
          <div className="flex items-center gap-2 text-yellow-400 text-sm font-medium">
            <Smartphone size={16} />
            Escaneie com o WhatsApp do seu celular
          </div>

          <div className="bg-white p-3 rounded-xl shadow-lg">
            <img
              src={qrcode}
              alt="QR Code WhatsApp"
              className="w-52 h-52 object-contain"
            />
          </div>

          <p className="text-xs text-gray-600 text-center max-w-xs">
            Abra o WhatsApp → Menu (⋮) → Aparelhos conectados → Conectar aparelho → escaneie este QR
          </p>

          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <RefreshCw size={11} className="animate-spin" />
            QR code atualiza automaticamente a cada 20 segundos
          </div>
        </div>
      )}

      {/* Conectado */}
      {status === 'open' && (
        <div className="card flex flex-col items-center gap-3 py-8 text-center">
          <div className="w-14 h-14 rounded-full bg-green-900/30 border border-green-700/30 flex items-center justify-center">
            <Wifi size={28} className="text-green-400" />
          </div>
          <div>
            <p className="font-semibold text-white">WhatsApp conectado!</p>
            <p className="text-sm text-gray-500 mt-1">
              As notificações serão enviadas automaticamente quando novos leads entrarem.
            </p>
          </div>
        </div>
      )}

      {/* Ações */}
      <div className="flex gap-3">
        {status !== 'open' && (
          <button
            onClick={connect}
            disabled={loading}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <><RefreshCw size={14} className="animate-spin" /> Criando instância…</>
            ) : status === 'connecting' && qrcode ? (
              <><RefreshCw size={14} className="animate-spin" /> Escanear novo QR</>
            ) : (
              <><Smartphone size={14} /> Conectar WhatsApp</>
            )}
          </button>
        )}

        {(status === 'open' || status === 'connecting') && (
          <button onClick={disconnect} className="btn-ghost text-red-500 hover:text-red-400">
            <Trash2 size={14} /> Desconectar
          </button>
        )}

        <button onClick={checkStatus} className="btn-ghost ml-auto">
          <RefreshCw size={14} /> Atualizar status
        </button>
      </div>

      {/* Aviso config */}
      {!error && status === 'close' && (
        <div className="bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-xs text-gray-500 space-y-1">
          <p className="font-medium text-gray-400">Pré-requisito: configure o .env</p>
          <p className="font-mono">EVOLUTION_API_URL=https://sua-evolution-api.com</p>
          <p className="font-mono">EVOLUTION_API_KEY=sua_api_key</p>
          <p className="font-mono">EVOLUTION_INSTANCE=meetime</p>
        </div>
      )}
    </div>
  );
}
