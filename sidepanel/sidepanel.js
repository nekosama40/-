// サイドパネル メインロジック

// --- 状態管理 ---
const state = {
  settings: {},
  faqDocs: [],        // { url, docId, title, content, status }
  responseHistory: [], // { id, timestamp, query, response, sourceFaqs }
  selectedMessages: [], // DOM取得・選択メッセージ
  fetchedMessages: [],  // DOM取得全件
  currentTab: 'generate',
  isGenerating: false,
  selectionMode: false,
  currentTabId: null,
};

// --- 初期化 ---
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  applySettings();
  setupTabs();
  setupGenerateTab();
  setupHistoryTab();
  setupSettingsTab();
  loadApiKeyStatus();
  getCurrentTabId();
});

// background -> sidepanel へのメッセージ受信（選択変更通知）
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SELECTION_CHANGED') {
    state.selectedMessages = message.messages || [];
    renderSelectedMessages();
  }
});

async function getCurrentTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  state.currentTabId = tabs[0]?.id || null;
}

function sendToBackground(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

// --- 設定の読込・適用 ---
async function loadSettings() {
  const { settings } = await sendToBackground('LOAD_SETTINGS');
  state.settings = settings;
  state.faqDocs = (settings.faqDocs || []).map((doc) => ({ ...doc, status: 'pending' }));
}

function applySettings() {
  const s = state.settings;

  // トーン
  const toneRadio = document.querySelector(`input[name="tone"][value="${s.tone || 'polite'}"]`);
  if (toneRadio) toneRadio.checked = true;

  // カスタム指示
  document.getElementById('custom-instruction').value = s.customInstruction || '';

  // 返答長さ
  const lengthMap = { short: 0, normal: 1, detailed: 2 };
  document.getElementById('response-length').value = lengthMap[s.responseLength] ?? 1;
  updateLengthDisplay();

  // モデル
  document.getElementById('select-model').value = s.geminiModel || 'gemini-1.5-flash';

  // 過去チャット件数
  document.getElementById('history-count').value = s.historyCount || 20;

  // トグル
  document.getElementById('toggle-source-faq').checked = s.showSourceFaq !== false;
  document.getElementById('toggle-keep-history').checked = s.showHistory !== false;
  document.getElementById('toggle-show-paste').checked = s.showPasteMode !== false;

  // Vertex AI設定
  const useVertex = s.useVertexAI === true;
  document.getElementById('toggle-vertex-ai').checked = useVertex;
  document.getElementById('vertex-project-id').value = s.vertexProjectId || '';
  document.getElementById('vertex-region').value = s.vertexRegion || 'us-central1';
  updateVertexAIVisibility(useVertex);

  // ペーストモードボタン表示
  updatePasteModeVisibility();

  // FAQ文書リスト
  renderFaqDocList();
}

// --- タブ切替 ---
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('active', p.id === `tab-${tab}`);
    p.classList.toggle('hidden', p.id !== `tab-${tab}`);
  });
  state.currentTab = tab;
  if (tab === 'history') renderHistoryList();
}

// --- 返答生成タブ ---
function setupGenerateTab() {
  // モード切替
  document.getElementById('btn-dom-mode').addEventListener('click', () => switchInputMode('dom'));
  document.getElementById('btn-paste-mode').addEventListener('click', () => switchInputMode('paste'));

  // メッセージ取得
  document.getElementById('btn-fetch-messages').addEventListener('click', fetchDiscordMessages);

  // クリック選択モード
  document.getElementById('btn-toggle-select').addEventListener('click', toggleSelectionMode);

  // 選択解除
  document.getElementById('btn-clear-select').addEventListener('click', clearMessageSelection);

  // 生成
  document.getElementById('btn-generate').addEventListener('click', generateResponse);

  // コピー
  document.getElementById('btn-copy').addEventListener('click', () => {
    const text = document.getElementById('response-output').value;
    if (text) navigator.clipboard.writeText(text);
  });

  // 再生成
  document.getElementById('btn-regenerate').addEventListener('click', generateResponse);
}

function switchInputMode(mode) {
  const isDom = mode === 'dom';
  document.getElementById('btn-dom-mode').classList.toggle('active', isDom);
  document.getElementById('btn-paste-mode').classList.toggle('active', !isDom);
  document.getElementById('dom-mode-panel').classList.toggle('hidden', !isDom);
  document.getElementById('paste-mode-panel').classList.toggle('hidden', isDom);

  if (!isDom && state.selectionMode) {
    disableSelectionMode();
  }
}

async function fetchDiscordMessages() {
  const btn = document.getElementById('btn-fetch-messages');
  btn.disabled = true;
  btn.textContent = '取得中...';

  try {
    const historyCount = parseInt(state.settings.historyCount || 50);
    const result = await sendToBackground('GET_DISCORD_MESSAGES', {
      tabId: state.currentTabId,
      count: historyCount,
    });

    if (result.error) throw new Error(result.error);
    state.fetchedMessages = result.messages || [];
    state.selectedMessages = [...state.fetchedMessages]; // 全件を選択済みとして扱う
    renderSelectedMessages();
    setStatus('success', `${state.fetchedMessages.length}件取得`);
  } catch (err) {
    showError(`メッセージ取得エラー: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'メッセージ取得';
  }
}

async function toggleSelectionMode() {
  if (state.selectionMode) {
    disableSelectionMode();
  } else {
    state.selectionMode = true;
    document.getElementById('btn-toggle-select').textContent = 'クリック選択モード: ON';
    document.getElementById('btn-toggle-select').classList.add('btn-primary');
    document.getElementById('btn-toggle-select').classList.remove('btn-outline');
    await sendToCurrentTab('TOGGLE_SELECTION_MODE', { enabled: true });
  }
}

function disableSelectionMode() {
  state.selectionMode = false;
  document.getElementById('btn-toggle-select').textContent = 'クリック選択モード: OFF';
  document.getElementById('btn-toggle-select').classList.remove('btn-primary');
  document.getElementById('btn-toggle-select').classList.add('btn-outline');
  sendToCurrentTab('TOGGLE_SELECTION_MODE', { enabled: false }).catch(() => {});
}

async function clearMessageSelection() {
  state.selectedMessages = [];
  renderSelectedMessages();
  await sendToCurrentTab('CLEAR_SELECTION').catch(() => {});
}

function renderSelectedMessages() {
  const container = document.getElementById('selected-messages-list');
  if (!state.selectedMessages.length) {
    container.innerHTML = '<p class="hint-text">「メッセージ取得」または「クリック選択モード」でメッセージを選択してください。</p>';
    return;
  }

  container.innerHTML = '';
  state.selectedMessages.forEach((msg) => {
    const item = document.createElement('div');
    item.className = 'message-item selected';
    item.innerHTML = `
      <div class="message-author">${escapeHtml(msg.author)}</div>
      <div class="message-content">${escapeHtml(msg.content)}</div>
    `;
    container.appendChild(item);
  });
}

async function generateResponse() {
  if (state.isGenerating) return;

  const isPasteMode = document.getElementById('paste-mode-panel') &&
    !document.getElementById('paste-mode-panel').classList.contains('hidden');
  const pasteText = isPasteMode ? document.getElementById('paste-input').value.trim() : '';

  if (!isPasteMode && state.selectedMessages.length === 0) {
    showError('メッセージを選択するかペーストしてください。');
    return;
  }

  state.isGenerating = true;
  setGeneratingState(true);
  hideError();

  try {
    // 過去チャット履歴取得
    const historyResult = await sendToBackground('GET_DISCORD_MESSAGES', {
      tabId: state.currentTabId,
      count: parseInt(state.settings.historyCount || 20),
    }).catch(() => ({ messages: [] }));

    const loadedFaqs = state.faqDocs.filter((d) => d.status === 'loaded');

    const payload = {
      messages: state.selectedMessages,
      faqTexts: loadedFaqs,
      history: historyResult.messages || [],
      settings: state.settings,
      pasteText,
    };

    const result = await sendToBackground('GENERATE_RESPONSE', { payload });
    if (result.error) throw new Error(result.error);

    // 結果表示
    document.getElementById('response-output').value = result.text;
    renderSourceFaqs(result.usedFaqs || []);
    setStatus('success', '生成完了');

    // 履歴追加
    addToHistory({
      query: isPasteMode ? pasteText : state.selectedMessages.map((m) => `${m.author}: ${m.content}`).join('\n'),
      response: result.text,
      sourceFaqs: result.usedFaqs || [],
    });
  } catch (err) {
    showError(`生成エラー: ${err.message}`);
    setStatus('error', 'エラー');
  } finally {
    state.isGenerating = false;
    setGeneratingState(false);
  }
}

function setGeneratingState(isGenerating) {
  const btn = document.getElementById('btn-generate');
  const text = document.getElementById('btn-generate-text');
  const spinner = document.getElementById('btn-generate-spinner');
  btn.disabled = isGenerating;
  text.textContent = isGenerating ? '生成中...' : 'AIで返答案を生成';
  spinner.classList.toggle('hidden', !isGenerating);
  if (isGenerating) setStatus('loading', '生成中...');
}

function renderSourceFaqs(faqs) {
  const section = document.getElementById('source-faq-section');
  const list = document.getElementById('source-faq-list');
  const showFaq = state.settings.showSourceFaq !== false;

  if (!showFaq || !faqs || faqs.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  list.innerHTML = '';
  faqs.forEach((faq) => {
    const li = document.createElement('li');
    li.textContent = faq;
    list.appendChild(li);
  });
}

// --- 履歴タブ ---
function setupHistoryTab() {
  document.getElementById('btn-clear-history').addEventListener('click', () => {
    state.responseHistory = [];
    renderHistoryList();
  });
}

function addToHistory(entry) {
  if (state.settings.showHistory === false) return;
  state.responseHistory.unshift({
    id: Date.now(),
    timestamp: new Date().toLocaleTimeString('ja-JP'),
    ...entry,
  });
  if (state.responseHistory.length > 50) state.responseHistory.pop();
}

function renderHistoryList() {
  const container = document.getElementById('history-list');
  if (!state.responseHistory.length) {
    container.innerHTML = '<p class="hint-text">まだ返答案を生成していません。</p>';
    return;
  }

  container.innerHTML = '';
  state.responseHistory.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'history-item';
    el.innerHTML = `
      <div class="history-item-header">
        <span class="hint-text">${escapeHtml(item.timestamp)}</span>
        <button class="btn btn-ghost btn-sm" data-id="${item.id}">再利用</button>
      </div>
      <div class="history-item-text">${escapeHtml(item.response)}</div>
    `;
    el.querySelector('button').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('response-output').value = item.response;
      switchTab('generate');
    });
    container.appendChild(el);
  });
}

// --- 設定タブ ---
function setupSettingsTab() {
  // APIキー保存
  document.getElementById('btn-save-api-key').addEventListener('click', saveApiKey);

  // 返答長さスライダー
  document.getElementById('response-length').addEventListener('input', updateLengthDisplay);

  // Vertex AIトグル
  document.getElementById('toggle-vertex-ai').addEventListener('change', (e) => {
    updateVertexAIVisibility(e.target.checked);
  });

  // FAQ追加
  document.getElementById('btn-add-faq').addEventListener('click', addFaqDoc);

  // Google Drive認証
  document.getElementById('btn-drive-auth').addEventListener('click', authenticateDrive);

  // 設定保存
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
}

function updateVertexAIVisibility(useVertex) {
  document.getElementById('vertex-ai-settings').classList.toggle('hidden', !useVertex);
  document.getElementById('gemini-direct-warning').classList.toggle('hidden', useVertex);
}

async function loadApiKeyStatus() {
  const key = await sendToBackground('GET_API_KEY');
  const status = document.getElementById('api-key-status');
  status.textContent = key ? 'APIキーが設定済みです。' : 'APIキーが未設定です。';
  status.style.color = key ? 'var(--color-success)' : 'var(--color-warning)';
}

async function saveApiKey() {
  const input = document.getElementById('input-api-key');
  const key = input.value.trim();
  if (!key) {
    document.getElementById('api-key-status').textContent = 'APIキーを入力してください。';
    return;
  }
  await sendToBackground('SAVE_API_KEY', { apiKey: key });
  input.value = '';
  document.getElementById('api-key-status').textContent = 'APIキーを保存しました。';
  document.getElementById('api-key-status').style.color = 'var(--color-success)';
}

function updateLengthDisplay() {
  const val = parseInt(document.getElementById('response-length').value);
  const labels = ['短め', 'ふつう', '詳しく'];
  document.getElementById('length-display').textContent = labels[val];
}

async function addFaqDoc() {
  const input = document.getElementById('input-faq-url');
  const url = input.value.trim();
  if (!url) return;
  if (!url.startsWith('https://')) {
    showError('有効なGoogle DriveのURLを入力してください。');
    return;
  }

  const existing = state.faqDocs.find((d) => d.url === url);
  if (existing) {
    showError('すでに登録されているURLです。');
    return;
  }

  const doc = { url, title: url, status: 'pending', content: '' };
  state.faqDocs.push(doc);
  input.value = '';
  renderFaqDocList();

  // 即時読み込み試行
  loadFaqDoc(doc);
}

async function loadFaqDoc(doc) {
  doc.status = 'loading';
  renderFaqDocList();
  try {
    const result = await sendToBackground('LOAD_FAQ_DOCUMENT', { docUrl: doc.url });
    doc.title = result.title || doc.url;
    doc.content = result.content;
    doc.status = 'loaded';
  } catch (err) {
    doc.status = 'error';
    doc.errorMsg = err.message;
  }
  renderFaqDocList();
}

function renderFaqDocList() {
  const container = document.getElementById('faq-doc-list');
  if (!state.faqDocs.length) {
    container.innerHTML = '<p class="hint-text">FAQ文書が登録されていません。</p>';
    return;
  }

  container.innerHTML = '';
  state.faqDocs.forEach((doc, index) => {
    const item = document.createElement('div');
    item.className = 'faq-doc-item';

    const statusLabel = { loaded: '読込済', pending: '未読込', loading: '読込中...', error: 'エラー' };
    const statusClass = doc.status === 'loaded' ? 'loaded' : doc.status === 'error' ? 'error' : 'pending';

    item.innerHTML = `
      <span class="faq-doc-name" title="${escapeHtml(doc.url)}">${escapeHtml(doc.title || doc.url)}</span>
      <span class="faq-doc-status ${statusClass}">${statusLabel[doc.status] || '未読込'}</span>
      <button class="btn btn-ghost btn-sm" data-action="reload" data-index="${index}" title="再読込">↻</button>
      <button class="btn btn-ghost btn-sm" data-action="remove" data-index="${index}" title="削除">✕</button>
    `;

    item.querySelector('[data-action="reload"]').addEventListener('click', () => {
      loadFaqDoc(state.faqDocs[index]);
    });
    item.querySelector('[data-action="remove"]').addEventListener('click', () => {
      state.faqDocs.splice(index, 1);
      renderFaqDocList();
    });

    container.appendChild(item);
  });
}

async function authenticateDrive() {
  const btn = document.getElementById('btn-drive-auth');
  btn.disabled = true;
  btn.textContent = '認証中...';
  try {
    await sendToBackground('GET_AUTH_TOKEN', { interactive: true });
    btn.textContent = 'Google Drive連携済み';
    btn.classList.add('btn-primary');
    btn.classList.remove('btn-outline');

    // 未読込のFAQ文書を読み込む
    for (const doc of state.faqDocs.filter((d) => d.status !== 'loaded')) {
      await loadFaqDoc(doc);
    }
  } catch (err) {
    showError(`Google Drive認証エラー: ${err.message}`);
    btn.textContent = 'Google Driveと連携';
    btn.disabled = false;
  }
}

async function saveSettings() {
  const lengthValues = ['short', 'normal', 'detailed'];
  const toneEl = document.querySelector('input[name="tone"]:checked');

  const settings = {
    tone: toneEl?.value || 'polite',
    customInstruction: document.getElementById('custom-instruction').value,
    responseLength: lengthValues[parseInt(document.getElementById('response-length').value)],
    geminiModel: document.getElementById('select-model').value,
    historyCount: parseInt(document.getElementById('history-count').value) || 20,
    showSourceFaq: document.getElementById('toggle-source-faq').checked,
    showHistory: document.getElementById('toggle-keep-history').checked,
    showPasteMode: document.getElementById('toggle-show-paste').checked,
    faqDocs: state.faqDocs.map(({ url, title, docId }) => ({ url, title, docId })),
    useVertexAI: document.getElementById('toggle-vertex-ai').checked,
    vertexProjectId: document.getElementById('vertex-project-id').value.trim(),
    vertexRegion: document.getElementById('vertex-region').value,
  };

  await sendToBackground('SAVE_SETTINGS', { settings });
  state.settings = { ...state.settings, ...settings };
  updatePasteModeVisibility();

  const status = document.getElementById('settings-save-status');
  status.textContent = '設定を保存しました。';
  status.style.color = 'var(--color-success)';
  setTimeout(() => { status.textContent = ''; }, 2000);
}

function updatePasteModeVisibility() {
  const showPaste = state.settings.showPasteMode !== false;
  const pasteBtn = document.getElementById('btn-paste-mode');
  if (pasteBtn) pasteBtn.style.display = showPaste ? '' : 'none';
}

// --- ユーティリティ ---
function setStatus(type, text) {
  const badge = document.getElementById('status-badge');
  badge.className = `status-badge status-${type}`;
  badge.textContent = text;
}

function showError(msg) {
  const banner = document.getElementById('error-banner');
  banner.textContent = msg;
  banner.classList.remove('hidden');
  setStatus('error', 'エラー');
}

function hideError() {
  document.getElementById('error-banner').classList.add('hidden');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendToCurrentTab(type, payload = {}) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (!tabId) throw new Error('アクティブなタブが見つかりません');
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type, ...payload }, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}
