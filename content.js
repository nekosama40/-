// Content Script: DiscordのDOMからメッセージを抽出・選択UI

const SELECTED_CLASS = 'esports-ai-selected';
const HIGHLIGHT_STYLE_ID = 'esports-ai-highlight-style';

let selectedMessages = new Set(); // message element references
let isSelectionMode = false;

injectStyles();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT_MESSAGES') {
    const result = extractMessages(message.count || 50);
    sendResponse(result);
  } else if (message.type === 'GET_SELECTED_MESSAGES') {
    sendResponse({ messages: getSelectedMessageData() });
  } else if (message.type === 'TOGGLE_SELECTION_MODE') {
    isSelectionMode = message.enabled;
    if (!isSelectionMode) clearSelection();
    sendResponse({ success: true });
  } else if (message.type === 'CLEAR_SELECTION') {
    clearSelection();
    sendResponse({ success: true });
  }
  return true;
});

// Discordメッセージ要素のセレクタ（DOM変更に対応するため複数用意）
const MESSAGE_SELECTORS = [
  'li[id^="chat-messages-"]',
  '[class*="message_"]',
  '[class*="cozyMessage"]',
  '[class*="groupStart"]',
];

const CONTENT_SELECTORS = [
  '[class*="messageContent"]',
  '[id^="message-content-"]',
  '[class*="markup"]',
];

const AUTHOR_SELECTORS = [
  '[class*="username"]',
  '[class*="headerText"]',
  '[class*="author"]',
  'span[class*="roleColor"]',
];

const TIMESTAMP_SELECTORS = [
  'time',
  '[class*="timestamp"]',
];

function getMessageContainer() {
  const selectors = [
    '[class*="messagesWrapper"]',
    '[class*="chatContent"]',
    'main[class*="chat"]',
    '[class*="scroller"]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return document.body;
}

function findElements(root, selectors) {
  for (const sel of selectors) {
    try {
      const found = root.querySelectorAll(sel);
      if (found.length > 0) return Array.from(found);
    } catch (e) {}
  }
  return [];
}

function findElement(root, selectors) {
  for (const sel of selectors) {
    try {
      const el = root.querySelector(sel);
      if (el) return el;
    } catch (e) {}
  }
  return null;
}

function extractMessages(count = 50) {
  const container = getMessageContainer();
  const msgEls = findElements(container, MESSAGE_SELECTORS);

  if (msgEls.length === 0) {
    return { messages: [], error: 'Discordのメッセージが見つかりません。チャンネルを開いているか確認してください。' };
  }

  const messages = [];
  let lastAuthor = '';
  let lastTimestamp = '';

  for (const el of msgEls) {
    const contentEl = findElement(el, CONTENT_SELECTORS);
    if (!contentEl) continue;

    const content = contentEl.innerText?.trim();
    if (!content) continue;

    const authorEl = findElement(el, AUTHOR_SELECTORS);
    const author = authorEl?.innerText?.trim() || lastAuthor || '不明';

    const timeEl = findElement(el, TIMESTAMP_SELECTORS);
    const timestamp = timeEl?.getAttribute('datetime') || timeEl?.innerText?.trim() || lastTimestamp;

    if (authorEl) lastAuthor = author;
    if (timeEl) lastTimestamp = timestamp;

    const msgId = el.id || el.dataset.id || `msg-${messages.length}`;

    messages.push({ id: msgId, author, content, timestamp });
  }

  const recent = messages.slice(-count);
  return { messages: recent, total: messages.length };
}

function getSelectedMessageData() {
  const data = [];
  selectedMessages.forEach((el) => {
    const contentEl = findElement(el, CONTENT_SELECTORS);
    const authorEl = findElement(el, AUTHOR_SELECTORS);
    if (contentEl) {
      data.push({
        id: el.id || el.dataset.id || '',
        author: authorEl?.innerText?.trim() || '不明',
        content: contentEl.innerText?.trim() || '',
      });
    }
  });
  return data;
}

// メッセージクリックで選択（selectionModeがONのとき）
document.addEventListener('click', (e) => {
  if (!isSelectionMode) return;

  const msgEl = findMessageElement(e.target);
  if (!msgEl) return;

  e.preventDefault();
  e.stopPropagation();

  if (selectedMessages.has(msgEl)) {
    selectedMessages.delete(msgEl);
    msgEl.classList.remove(SELECTED_CLASS);
  } else {
    selectedMessages.add(msgEl);
    msgEl.classList.add(SELECTED_CLASS);
  }

  // 選択変更をサイドパネルへ通知
  chrome.runtime.sendMessage({
    type: 'SELECTION_CHANGED',
    messages: getSelectedMessageData(),
  }).catch(() => {});
}, true);

function findMessageElement(target) {
  let el = target;
  while (el && el !== document.body) {
    for (const sel of MESSAGE_SELECTORS) {
      try {
        if (el.matches(sel)) return el;
      } catch (e) {}
    }
    el = el.parentElement;
  }
  return null;
}

function clearSelection() {
  selectedMessages.forEach((el) => el.classList.remove(SELECTED_CLASS));
  selectedMessages.clear();
}

function injectStyles() {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    .${SELECTED_CLASS} {
      background-color: rgba(88, 101, 242, 0.25) !important;
      outline: 2px solid rgba(88, 101, 242, 0.8) !important;
      border-radius: 4px;
      cursor: pointer !important;
    }
    .${SELECTED_CLASS}:hover {
      background-color: rgba(88, 101, 242, 0.35) !important;
    }
  `;
  document.head.appendChild(style);
}
