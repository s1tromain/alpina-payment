const fetch = require('node-fetch');
const FormData = require('form-data');

const API_TIMEOUT = 15000;

function esc(str) {
  if (!str) return '';
  return String(str).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function createBotClient(getToken) {
  function apiBase() {
    return 'https://api.telegram.org/bot' + getToken();
  }

  function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  async function callJson(method, body) {
    const resp = await fetchWithTimeout(apiBase() + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return resp.json();
  }

  async function sendMessage(chatId, text, replyMarkup) {
    const body = { chat_id: chatId, text, parse_mode: 'MarkdownV2' };
    if (replyMarkup) body.reply_markup = replyMarkup;
    return callJson('sendMessage', body);
  }

  async function sendPhotoBuffer(chatId, buffer, filename, mimeType, caption, replyMarkup) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', buffer, { filename, contentType: mimeType });
    if (caption) {
      form.append('caption', caption);
      form.append('parse_mode', 'MarkdownV2');
    }
    if (replyMarkup) {
      form.append('reply_markup', JSON.stringify(replyMarkup));
    }
    const resp = await fetchWithTimeout(apiBase() + '/sendPhoto', { method: 'POST', body: form });
    return resp.json();
  }

  async function editMessageCaption(chatId, messageId, caption, replyMarkup) {
    const body = { chat_id: chatId, message_id: messageId };
    if (caption !== undefined) body.caption = caption;
    if (replyMarkup) body.reply_markup = replyMarkup;
    return callJson('editMessageCaption', body);
  }

  async function answerCallbackQuery(callbackQueryId, text) {
    return callJson('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: text || ''
    });
  }

  async function sendPlainMessage(chatId, text, replyMarkup) {
    const body = { chat_id: chatId, text };
    if (replyMarkup) body.reply_markup = replyMarkup;
    return callJson('sendMessage', body);
  }

  async function editMessageText(chatId, messageId, text, replyMarkup) {
    const body = { chat_id: chatId, message_id: messageId, text };
    if (replyMarkup) body.reply_markup = replyMarkup;
    return callJson('editMessageText', body);
  }

  return {
    callJson,
    sendMessage,
    sendPlainMessage,
    sendPhotoBuffer,
    editMessageCaption,
    editMessageText,
    answerCallbackQuery
  };
}

const modBot = createBotClient(function () { return process.env.MOD_BOT_TOKEN; });
const userBot = createBotClient(function () { return process.env.USER_BOT_TOKEN; });

module.exports = { esc, modBot, userBot };
