// Service Worker: Gemini API通信・Google Drive OAuth・ストレージ管理

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DOCS_EXPORT_BASE = 'https://docs.googleapis.com/v1/documents';

// サイドパネルをツールバーアイコンクリックで開く
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((err) => {
    sendResponse({ error: err.message });
  });
  return true; // async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'GET_DISCORD_MESSAGES':
      return await getDiscordMessages(message.tabId, message.count);
    case 'GENERATE_RESPONSE':
      return await generateResponse(message.payload);
    case 'LOAD_FAQ_DOCUMENT':
      return await loadFaqDocument(message.docUrl);
    case 'SAVE_SETTINGS':
      return await saveSettings(message.settings);
    case 'LOAD_SETTINGS':
      return await loadSettings();
    case 'SAVE_API_KEY':
      return await saveApiKey(message.apiKey);
    case 'GET_API_KEY':
      return await getApiKey();
    case 'CLEAR_API_KEY':
      return await clearApiKey();
    case 'GET_AUTH_TOKEN':
      return await getAuthToken(message.interactive);
    case 'REVOKE_AUTH_TOKEN':
      return await revokeAuthToken();
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// Discordのメッセージ取得（content scriptへ中継）
async function getDiscordMessages(tabId, count) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const targetTabId = tabId || (tabs[0] && tabs[0].id);
  if (!targetTabId) throw new Error('Discordタブが見つかりません');

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      targetTabId,
      { type: 'EXTRACT_MESSAGES', count },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      }
    );
  });
}

// Gemini API呼び出し
async function generateResponse(payload) {
  const { messages, faqTexts, history, settings, pasteText } = payload;

  const model = settings?.geminiModel || 'gemini-1.5-flash';
  const systemInstruction = buildSystemInstruction(settings, faqTexts);
  const userContent = buildUserContent(messages, history, pasteText, settings);

  const requestBody = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: userContent }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: getMaxTokens(settings.responseLength),
    },
  };

  const result = settings.useVertexAI && settings.vertexProjectId
    ? await callVertexAI(requestBody, model, settings)
    : await callGeminiAPI(requestBody, model);

  return { text: result.text, usedFaqs: extractUsedFaqs(result.text, faqTexts) };
}

// Gemini AI Studio（APIキー認証・データ保持あり）
async function callGeminiAPI(requestBody, model) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('Gemini APIキーが設定されていません');

  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  return parseGeminiResponse(response);
}

// Vertex AI（OAuth2認証・データログなし）
async function callVertexAI(requestBody, model, settings) {
  const { token } = await getAuthToken(false);
  if (!token) throw new Error('Google認証が必要です。設定タブで「Google連携」を行ってください');

  const project = settings.vertexProjectId;
  const region = settings.vertexRegion || 'us-central1';
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/publishers/google/models/${model}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(requestBody),
  });
  return parseGeminiResponse(response);
}

async function parseGeminiResponse(response) {
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`APIエラー: ${err?.error?.message || response.status}`);
  }
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('APIから返答を取得できませんでした');
  return { text };
}

function buildSystemInstruction(settings, faqTexts) {
  const toneMap = {
    polite: '丁寧かつ礼儀正しい言葉遣いで、敬語を使って回答してください。',
    friendly: '親しみやすくフレンドリーな言葉遣いで回答してください。',
    concise: '簡潔で要点を絞った回答をしてください。',
    casual: 'カジュアルで話しかけやすい口調で回答してください。',
  };

  const lengthMap = {
    short: '返答は短く、要点のみ伝えてください（2〜3文程度）。',
    normal: '返答は適度な長さにしてください（4〜6文程度）。',
    detailed: '詳しく丁寧に説明してください。',
  };

  let instruction = `あなたはeスポーツ大会運営スタッフのAIアシスタントです。
参加者からの問い合わせに対する返答案を作成してください。

【言葉遣い】
${toneMap[settings.tone] || toneMap.polite}

【返答の長さ】
${lengthMap[settings.responseLength] || lengthMap.normal}
`;

  if (settings.customInstruction?.trim()) {
    instruction += `\n【カスタム指示】\n${settings.customInstruction}\n`;
  }

  if (faqTexts && faqTexts.length > 0) {
    instruction += `\n【FAQ・ルール文書】\n以下のFAQおよびルール文書を参照して回答してください。回答の根拠となったFAQ項目があれば、返答の末尾に「【根拠FAQ】項目名」の形式で記載してください。\n\n`;
    faqTexts.forEach((faq, i) => {
      instruction += `--- FAQ文書 ${i + 1} ---\n${faq.content}\n\n`;
    });
  }

  instruction += '\n重要: AIが直接Discordに送信することはありません。スタッフが必ず内容を確認・編集してから送信します。';

  return instruction;
}

function buildUserContent(messages, history, pasteText, settings) {
  let content = '';

  if (history && history.length > 0) {
    const maxHistory = settings.historyCount || 20;
    const recentHistory = history.slice(-maxHistory);
    content += `【直近のチャット履歴】\n`;
    recentHistory.forEach((msg) => {
      content += `${msg.author}: ${msg.content}\n`;
    });
    content += '\n';
  }

  if (pasteText?.trim()) {
    content += `【問い合わせメッセージ（手動入力）】\n${pasteText}\n`;
  } else if (messages && messages.length > 0) {
    content += `【選択された問い合わせメッセージ】\n`;
    messages.forEach((msg) => {
      content += `${msg.author}: ${msg.content}\n`;
    });
  } else {
    content += '問い合わせメッセージが指定されていません。一般的なサポート対応の参考文例を提案してください。';
  }

  content += '\n\n上記のメッセージに対する返答案を作成してください。';
  return content;
}

function getMaxTokens(length) {
  const map = { short: 256, normal: 512, detailed: 1024 };
  return map[length] || 512;
}

function extractUsedFaqs(text, faqTexts) {
  if (!faqTexts || faqTexts.length === 0) return [];
  const match = text.match(/【根拠FAQ】(.+)/g);
  return match ? match.map((m) => m.replace('【根拠FAQ】', '').trim()) : [];
}

async function getApiKeyAndModel(settings) {
  const apiKey = await getApiKey();
  const model = settings?.geminiModel || 'gemini-1.5-flash';
  return { apiKey, model };
}

// Google Drive OAuth2
async function getAuthToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve({ token });
      }
    });
  });
}

async function revokeAuthToken() {
  const { token } = await getAuthToken(false).catch(() => ({ token: null }));
  if (!token) return { success: true };
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve({ success: true }));
  });
}

// Google DriveドキュメントをPlain textとして取得
async function loadFaqDocument(docUrl) {
  const docId = extractDocId(docUrl);
  if (!docId) throw new Error('有効なGoogle DriveのURLではありません');

  const { token } = await getAuthToken(true);

  // Google Docsの場合はexport、その他はダウンロード
  const isGoogleDoc = docUrl.includes('docs.google.com/document');
  let url, response;

  if (isGoogleDoc) {
    url = `https://docs.googleapis.com/v1/documents/${docId}`;
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`ドキュメント取得失敗: ${response.status}`);
    const doc = await response.json();
    const content = extractGoogleDocText(doc);
    const title = doc.title || docId;
    return { docId, title, content };
  } else {
    url = `${DRIVE_API_BASE}/files/${docId}?alt=media`;
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`ファイル取得失敗: ${response.status}`);
    const content = await response.text();

    // ファイル名取得
    const metaRes = await fetch(`${DRIVE_API_BASE}/files/${docId}?fields=name`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meta = metaRes.ok ? await metaRes.json() : { name: docId };
    return { docId, title: meta.name, content };
  }
}

function extractDocId(url) {
  const patterns = [
    /\/document\/d\/([a-zA-Z0-9_-]+)/,
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /id=([a-zA-Z0-9_-]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractGoogleDocText(doc) {
  if (!doc.body || !doc.body.content) return '';
  const lines = [];
  for (const element of doc.body.content) {
    if (element.paragraph) {
      const text = element.paragraph.elements
        ?.map((e) => e.textRun?.content || '')
        .join('');
      if (text?.trim()) lines.push(text.trim());
    }
    if (element.table) {
      for (const row of element.table.tableRows || []) {
        const cells = (row.tableCells || []).map((cell) => {
          return (cell.content || [])
            .map((c) => c.paragraph?.elements?.map((e) => e.textRun?.content || '').join('') || '')
            .join(' ');
        });
        lines.push(cells.join(' | '));
      }
    }
  }
  return lines.join('\n');
}

// ストレージ操作
async function saveApiKey(apiKey) {
  // chrome.storage.session はサービスワーカー再起動で消えるが暗号化領域
  await chrome.storage.session.set({ geminiApiKey: apiKey });
  return { success: true };
}

async function getApiKey() {
  const data = await chrome.storage.session.get('geminiApiKey');
  return data.geminiApiKey || null;
}

async function clearApiKey() {
  await chrome.storage.session.remove('geminiApiKey');
  return { success: true };
}

const DEFAULT_SETTINGS = {
  tone: 'polite',
  customInstruction: '',
  responseLength: 'normal',
  geminiModel: 'gemini-1.5-flash',
  showSourceFaq: true,
  showHistory: true,
  showPasteMode: true,
  historyCount: 20,
  faqDocs: [],
  useVertexAI: false,
  vertexProjectId: '',
  vertexRegion: 'us-central1',
};

async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
  return { success: true };
}

async function loadSettings() {
  const data = await chrome.storage.local.get('settings');
  return { settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) } };
}
