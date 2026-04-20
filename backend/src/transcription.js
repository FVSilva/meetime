const axios = require('axios');
const FormData = require('form-data');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

// Inicializa sob demanda para não quebrar o boot sem as chaves
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY não configurada');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}
function getAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/**
 * Baixa o áudio de uma URL e retorna como Buffer
 */
async function downloadAudio(url) {
  const headers = {};
  if (process.env.MEETIME_API_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.MEETIME_API_TOKEN}`;
  }

  const response = await axios.get(url, { responseType: 'arraybuffer', headers });
  return Buffer.from(response.data);
}

/**
 * Transcreve áudio usando OpenAI Whisper
 */
async function transcribeAudio(audioBuffer, filename = 'recording.mp3') {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY não configurada');
  }

  const form = new FormData();
  form.append('file', audioBuffer, { filename, contentType: 'audio/mpeg' });
  form.append('model', 'whisper-1');
  form.append('language', 'pt');

  // Usa o cliente OpenAI com o form-data manualmente pois o SDK não suporta Buffer diretamente
  const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
    headers: {
      ...form.getHeaders(),
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
  });

  return response.data.text;
}

/**
 * Analisa a transcrição com Claude e retorna resumo, sentimento, score e feedback
 */
async function analyzeCall(transcription, leadName = '') {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY não configurada');
  }

  const prompt = `Você é um especialista em vendas B2B e análise de ligações comerciais.

Analise a transcrição da ligação abaixo com o lead "${leadName}" e retorne um JSON com exatamente esta estrutura:

{
  "summary": "Resumo executivo da ligação em 3-5 frases",
  "sentiment": "positive" | "neutral" | "negative",
  "score": número de 0 a 100 representando a qualidade da ligação,
  "keyPoints": ["ponto 1", "ponto 2", "ponto 3"],
  "nextSteps": ["próximo passo 1", "próximo passo 2"],
  "feedback": "Feedback construtivo para o SDR melhorar em próximas ligações. Seja específico e use exemplos da transcrição."
}

TRANSCRIÇÃO:
${transcription}

Responda APENAS com o JSON válido, sem markdown ou explicações extras.`;

  const message = await getAnthropic().messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0].text.trim();

  try {
    return JSON.parse(raw);
  } catch {
    // Se Claude adicionou markdown, remove
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    throw new Error('Resposta da IA não é JSON válido');
  }
}

/**
 * Pipeline completo: download → transcrição → análise
 */
async function processCallRecording(recordingUrl, leadName = '') {
  console.log(`[Transcription] Processando gravação: ${recordingUrl}`);

  const audioBuffer = await downloadAudio(recordingUrl);
  console.log(`[Transcription] Áudio baixado: ${audioBuffer.length} bytes`);

  const transcription = await transcribeAudio(audioBuffer);
  console.log(`[Transcription] Transcrição concluída: ${transcription.length} chars`);

  const analysis = await analyzeCall(transcription, leadName);
  console.log(`[Transcription] Análise concluída. Score: ${analysis.score}`);

  return { transcription, ...analysis };
}

module.exports = { processCallRecording, transcribeAudio, analyzeCall };
