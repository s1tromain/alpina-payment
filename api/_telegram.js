const fetch = require('node-fetch');
const FormData = require('form-data');

const API_TIMEOUT = 15000;

const apiBase = () => `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;

function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

async function callJson(method, body) {
  const resp = await fetchWithTimeout(`${apiBase()}/${method}`, {
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
  const resp = await fetchWithTimeout(`${apiBase()}/sendPhoto`, { method: 'POST', body: form });
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

async function sendPlainMessage(chatId, text) {
  return callJson('sendMessage', { chat_id: chatId, text });
}

module.exports = { esc, sendMessage, sendPlainMessage, sendPhotoBuffer, editMessageCaption, answerCallbackQuery };
