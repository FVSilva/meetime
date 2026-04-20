const axios    = require('axios');
const FormData = require('form-data');
const OpenAI   = require('openai');

// Inicializa sob demanda
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY não configurada');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/**
 * Baixa o áudio de uma URL e retorna como Buffer
 */
async function downloadAudio(url) {
  const headers = {};
  if (process.env.MEETIME_API_TOKEN) {
    headers['authorization'] = process.env.MEETIME_API_TOKEN;
  }
  const response = await axios.get(url, { responseType: 'arraybuffer', headers });
  return Buffer.from(response.data);
}

/**
 * Transcreve áudio usando OpenAI Whisper
 */
async function transcribeAudio(audioBuffer, filename = 'recording.mp3') {
  const form = new FormData();
  form.append('file', audioBuffer, { filename, contentType: 'audio/mpeg' });
  form.append('model', 'whisper-1');
  form.append('language', 'pt');

  const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
    headers: {
      ...form.getHeaders(),
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
  });

  return response.data.text;
}

/**
 * Analisa a transcrição com GPT-4o e retorna resumo, sentimento, score e feedback
 */
async function analyzeCall(transcription, leadName = '') {
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

  const response = await getOpenAI().chat.completions.create({
    model:       process.env.OPENAI_ANALYSIS_MODEL || 'gpt-4o-mini',
    max_tokens:  1024,
    temperature: 0.3,
    messages:    [{ role: 'user', content: prompt }],
  });

  const raw = response.choices[0].message.content.trim();

  try {
    return JSON.parse(raw);
  } catch {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    throw new Error('Resposta da IA não é JSON válido');
  }
}

/**
 * Pipeline completo: download → transcrição (Whisper) → análise (GPT-4o)
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
