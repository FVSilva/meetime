import { Bell, BellOff } from 'lucide-react';
import { usePushNotifications } from '../hooks/usePushNotifications';

export default function PushBell() {
  const { permission, subscribed, loading, error, subscribe, unsubscribe } = usePushNotifications();

  if (permission === 'unsupported') return null;

  return (
    <div className="px-3 mb-2">
      <button
        onClick={subscribed ? unsubscribe : subscribe}
        disabled={loading}
        title={subscribed ? 'Notificações ativas — clique para desativar' : 'Ativar notificações push'}
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
      {error && <p className="text-xs text-red-500 mt-1 px-1">{error}</p>}
    </div>
  );
}
