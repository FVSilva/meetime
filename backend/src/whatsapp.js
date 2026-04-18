const express = require('express');
const axios = require('axios');
const router = express.Router();

function evoClient() {
  const { EVOLUTION_API_URL, EVOLUTION_API_KEY } = process.env;

  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    throw new Error('EVOLUTION_API_URL e EVOLUTION_API_KEY não configurados no .env');
  }

  return axios.create({
    baseURL: EVOLUTION_API_URL,
    headers: {
      apikey: EVOLUTION_API_KEY,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
}

const INSTANCE = () => process.env.EVOLUTION_INSTANCE || 'meetime';

/**
 * POST /api/whatsapp/connect
 * Cria a instância (se não existir) e retorna o QR code base64
 */
router.post('/whatsapp/connect', async (req, res) => {
  const client = evoClient();
  const instanceName = INSTANCE();

  try {
    // Tenta criar — se já existir a Evolution retorna erro, tratamos abaixo
    await client.post('/instance/create', {
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    }).catch(err => {
      // Instância já existe — ignora e segue
      if (err.response?.status !== 409 && err.response?.data?.error !== 'instance already exists') {
        throw err;
      }
    });

    // Pede o QR code
    const { data } = await client.get(`/instance/connect/${instanceName}`);

    res.json({
      instanceName,
      qrcode: data.base64 || data.qrcode?.base64 || null,
      code:   data.code   || data.qrcode?.code   || null,
    });
  } catch (err) {
    console.error('[WhatsApp] Erro ao conectar:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

/**
 * GET /api/whatsapp/status
 * Retorna o estado atual da instância: open | connecting | close
 */
router.get('/whatsapp/status', async (req, res) => {
  const client = evoClient();
  const instanceName = INSTANCE();

  try {
    const { data } = await client.get(`/instance/connectionState/${instanceName}`);
    // Evolution v1: data.instance.state | Evolution v2: data.state
    const state = data?.instance?.state || data?.state || 'close';
    res.json({ instanceName, state });
  } catch (err) {
    // Instância não existe ainda
    if (err.response?.status === 404 || err.response?.status === 400) {
      return res.json({ instanceName, state: 'close' });
    }
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

/**
 * GET /api/whatsapp/qrcode
 * Busca um QR code atualizado (útil quando o anterior expirou)
 */
router.get('/whatsapp/qrcode', async (req, res) => {
  const client = evoClient();
  const instanceName = INSTANCE();

  try {
    const { data } = await client.get(`/instance/connect/${instanceName}`);
    res.json({
      qrcode: data.base64 || data.qrcode?.base64 || null,
      code:   data.code   || data.qrcode?.code   || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

/**
 * DELETE /api/whatsapp/disconnect
 * Desconecta e remove a instância
 */
router.delete('/whatsapp/disconnect', async (req, res) => {
  const client = evoClient();
  const instanceName = INSTANCE();

  try {
    await client.delete(`/instance/delete/${instanceName}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

/**
 * GET /api/whatsapp/instances
 * Lista todas as instâncias (útil para debug)
 */
router.get('/whatsapp/instances', async (req, res) => {
  const client = evoClient();
  try {
    const { data } = await client.get('/instance/fetchInstances');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

module.exports = router;
