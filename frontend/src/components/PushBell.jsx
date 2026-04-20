import { useState } from 'react';
import { Bell, BellOff, Mail } from 'lucide-react';
import { usePushNotifications } from '../hooks/usePushNotifications';

export default function PushBell() {
  const { permission, subscribed, loading, error, subscribe, unsubscribe } = usePushNotifications();
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState(() => localStorage.getItem('push_email') || '');
  const [emailInput, setEmailInput] = useState('');

  if (permission === 'unsupported') return null;

  function handleActivate() {
    if (email) {
      // Já tem email salvo — assina direto
      subscribe(email);
    } else {
      // Mostra form para digitar o email
      setShowEmailForm(true);
    }
  }

  function handleEmailSubmit(e) {
    e.preventDefault();
    const v = emailInput.trim().toLowerCase();
    if (!v || !v.includes('@')) return;
    localStorage.setItem('push_email', v);
    setEmail(v);
    setShowEmailForm(false);
    subscribe(v);
  }

  if (showEmailForm) {
    return (
      <div className="px-3 mb-2">
        <form onSubmit={handleEmailSubmit} className="flex flex-col gap-1.5">
          <p className="text-xs text-gray-400 px-1">Seu e-mail para receber notificações:</p>
          <input
            type="email"
            autoFocus
            placeholder="voce@v4company.com"
            value={emailInput}
            onChange={e => setEmailInput(e.target.value)}
            className="w-full px-2 py-1.5 rounded-md bg-gray-900 border border-gray-700 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-red-600"
          />
          <div className="flex gap-1">
            <button
              type="submit"
              className="flex-1 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-xs text-white font-medium"
            >
              Confirmar
            </button>
            <button
              type="button"
              onClick={() => setShowEmailForm(false)}
              className="px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-xs text-gray-400"
            >
              ✕
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="px-3 mb-2">
      <button
        onClick={subscribed ? unsubscribe : handleActivate}
        disabled={loading}
        title={subscribed
          ? `Notificações ativas (${email || 'anônimo'}) — clique para desativar`
          : 'Ativar notificações push'}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all border
          ${subscribed
            ? 'bg-green-900/20 text-green-400 border-green-800/30 hover:bg-red-900/20 hover:text-red-400 hover:border-red-800/30'
            : 'text-gray-600 border-gray-900 hover:bg-gray-900 hover:text-gray-300'
          }
          ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {subscribed
          ? <><Bell size={13} className="shrink-0" /> Notificações ativas</>
          : <><BellOff size={13} className="shrink-0" /> Ativar notificações</>
        }
      </button>
      {subscribed && email && (
        <p className="text-xs text-gray-700 px-1 mt-0.5 truncate" title={email}>
          <Mail size={10} className="inline mr-1" />{email}
        </p>
      )}
      {error && <p className="text-xs text-red-500 mt-1 px-1">{error}</p>}
    </div>
  );
}
