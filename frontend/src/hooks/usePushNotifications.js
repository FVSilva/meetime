import { useState, useEffect } from 'react';

export function usePushNotifications() {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  // Verifica se já tem subscription ativa
  useEffect(() => {
    checkSubscription();
  }, []);

  async function checkSubscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(!!sub);
    } catch {}
  }

  async function subscribe() {
    setLoading(true);
    setError('');
    try {
      // Pede permissão
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') { setError('Permissão negada'); return; }

      // Registra o service worker
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      // Busca a chave pública do servidor
      const keyRes = await fetch('/api/push/vapid-public-key');
      const { publicKey } = await keyRes.json();

      // Converte a chave para Uint8Array
      const applicationServerKey = urlBase64ToUint8Array(publicKey);

      // Cria a subscription
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      // Manda para o backend
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });

      setSubscribed(true);
    } catch (err) {
      setError(err.message || 'Erro ao ativar notificações');
    } finally {
      setLoading(false);
    }
  }

  async function unsubscribe() {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return { permission, subscribed, loading, error, subscribe, unsubscribe };
}

// Converte base64url → Uint8Array (necessário para VAPID)
function urlBase64ToUint8Array(base64String) {
  const padding  = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64   = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData  = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}
