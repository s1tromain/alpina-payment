(function() {
  'use strict';

  var API = '/api/admin-requisites';
  var password = '';
  var editingId = null;

  var SESSION_KEY = 'alpina_admin_session';
  var SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

  var authBox = document.getElementById('authBox');
  var mainPanel = document.getElementById('mainPanel');
  var authError = document.getElementById('authError');
  var adminPasswordInput = document.getElementById('adminPassword');
  var loginBtn = document.getElementById('loginBtn');
  var addCardBtn = document.getElementById('addCardBtn');
  var refreshBtn = document.getElementById('refreshBtn');
  var cardsBody = document.getElementById('cardsBody');
  var statusMsg = document.getElementById('statusMsg');

  var cardModal = document.getElementById('cardModal');
  var modalTitle = document.getElementById('modalTitle');
  var modalCardNumber = document.getElementById('modalCardNumber');
  var modalBankName = document.getElementById('modalBankName');
  var modalError = document.getElementById('modalError');
  var modalCancel = document.getElementById('modalCancel');
  var modalSave = document.getElementById('modalSave');
  var modalCloseX = document.getElementById('modalCloseX');
  var modalIsActive = document.getElementById('modalIsActive');
  var modalIsActiveLabel = document.getElementById('modalIsActiveLabel');

  // Monitoring elements
  var monTotalRub = document.getElementById('monTotalRub');
  var monLimitRub = document.getElementById('monLimitRub');
  var monRemaining = document.getElementById('monRemaining');
  var monPercent = document.getElementById('monPercent');
  var monOrdersCount = document.getElementById('monOrdersCount');

  // History
  var historyBody = document.getElementById('historyBody');

  // Tabs
  var tabBtns = document.querySelectorAll('.tab-btn');
  var tabContents = document.querySelectorAll('.tab-content');

  // ===== Session helpers =====
  function saveSession(pwd) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        t: Date.now(),
        k: btoa(unescape(encodeURIComponent(pwd)))
      }));
    } catch (_) {}
  }

  function restoreSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s.t || !s.k) return null;
      if (Date.now() - s.t > SESSION_TTL) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return decodeURIComponent(escape(atob(s.k)));
    } catch (_) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
  }

  function formatNum(n) {
    return Number(n).toLocaleString('ru-RU');
  }

  function showStatus(msg, isError) {
    statusMsg.textContent = msg;
    statusMsg.style.display = 'block';
    statusMsg.style.color = isError ? 'var(--err)' : 'var(--ok)';
    setTimeout(function() { statusMsg.style.display = 'none'; }, 4000);
  }

  function apiCall(method, params, body) {
    var url = API + (params || '');
    var opts = {
      method: method,
      headers: { 'X-Admin-Password': password }
    };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function(r) { return r.json(); });
  }

  // ===== Session helpers =====
  function saveSession(pwd) {
    try {
      var data = JSON.stringify({ t: Date.now(), h: btoa(pwd) });
      localStorage.setItem(SESSION_KEY, data);
    } catch(e) {}
  }

  function loadSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (Date.now() - data.t > SESSION_TTL) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return atob(data.h);
    } catch(e) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  // ===== Tabs =====
  for (var i = 0; i < tabBtns.length; i++) {
    tabBtns[i].addEventListener('click', function() {
      var target = this.getAttribute('data-tab');
      for (var j = 0; j < tabBtns.length; j++) tabBtns[j].classList.remove('active');
      for (var j = 0; j < tabContents.length; j++) tabContents[j].classList.remove('active');
      this.classList.add('active');
      var panel = document.getElementById('tab' + target.charAt(0).toUpperCase() + target.slice(1));
      if (panel) panel.classList.add('active');
      if (target === 'history') loadHistory();
    });
  }

  // ===== Monitoring =====
  function loadStats() {
    apiCall('GET', '?action=stats').then(function(data) {
      if (!data.ok) return;
      var t = data.today;
      var total = t.totalApprovedRub || 0;
      var limit = t.dailyLimitRub || 200000;
      var remaining = Math.max(0, limit - total);
      var pct = limit > 0 ? Math.min(100, Math.round(total / limit * 100)) : 0;

      monTotalRub.textContent = formatNum(total) + ' \u20BD';
      monLimitRub.textContent = formatNum(limit);
      monRemaining.textContent = formatNum(remaining) + ' \u20BD';
      monPercent.textContent = pct + '% \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u043E';
      monOrdersCount.textContent = formatNum(t.approvedOrdersCount || 0);
    }).catch(function() {});
  }

  // ===== History =====
  function loadHistory() {
    apiCall('GET', '?action=history&limit=30').then(function(data) {
      if (!data.ok || !data.history || data.history.length === 0) {
        historyBody.innerHTML = '<tr><td colspan="3" class="empty-msg">\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445</td></tr>';
        return;
      }
      var html = '';
      for (var i = 0; i < data.history.length; i++) {
        var h = data.history[i];
        html += '<tr>'
          + '<td>' + escHtml(h.date) + '</td>'
          + '<td>' + formatNum(h.approvedOrdersCount || 0) + '</td>'
          + '<td>' + formatNum(h.totalApprovedRub || 0) + ' \u20BD</td>'
          + '</tr>';
      }
      historyBody.innerHTML = html;
    }).catch(function() {
      historyBody.innerHTML = '<tr><td colspan="3" class="empty-msg">\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438</td></tr>';
    });
  }

  // Login
  loginBtn.addEventListener('click', function() {
    password = adminPasswordInput.value.trim();
    if (!password) return;

    authError.style.display = 'none';
    apiCall('GET').then(function(data) {
      if (!data.ok) {
        authError.textContent = '\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C';
        authError.style.display = 'block';
        password = '';
        return;
      }
      saveSession(password);
      authBox.style.display = 'none';
      mainPanel.style.display = 'block';
      renderCards(data.requisites);
      loadStats();
    }).catch(function() {
      authError.textContent = '\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u044F';
      authError.style.display = 'block';
    });
  });

  adminPasswordInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') loginBtn.click();
  });

  // Load cards
  function loadCards() {
    apiCall('GET').then(function(data) {
      if (data.ok) renderCards(data.requisites);
      else showStatus('\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438', true);
    }).catch(function() { showStatus('\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u044F', true); });
  }

  function renderCards(cards) {
    if (!cards || cards.length === 0) {
      cardsBody.innerHTML = '<tr><td colspan="6" class="empty-msg">\u041D\u0435\u0442 \u0440\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u043E\u0432. \u0414\u043E\u0431\u0430\u0432\u044C\u0442\u0435 \u043A\u0430\u0440\u0442\u0443.</td></tr>';
      return;
    }

    var html = '';
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var activeBadge = c.isActive
        ? '<span class="badge badge-active">\u0414\u0430</span>'
        : '<span class="badge badge-inactive">\u041D\u0435\u0442</span>';
      var statusBadge = c.status === 'busy'
        ? '<span class="badge badge-busy">\u0417\u0430\u043D\u044F\u0442\u0430</span>'
        : '<span class="badge badge-free">\u0421\u0432\u043E\u0431\u043E\u0434\u043D\u0430</span>';
      var orderCell = c.currentOrderId || '\u2014';
      var toggleLabel = c.isActive ? '\u0412\u044B\u043A\u043B' : '\u0412\u043A\u043B';
      var toggleClass = c.isActive ? 'btn-warn' : 'btn-ok';

      html += '<tr>'
        + '<td class="card-number">' + escHtml(c.cardNumber) + '</td>'
        + '<td>' + escHtml(c.bankName) + '</td>'
        + '<td>' + activeBadge + '</td>'
        + '<td>' + statusBadge + '</td>'
        + '<td style="font-size:.75rem">' + escHtml(orderCell) + '</td>'
        + '<td class="td-actions">'
          + '<button class="btn btn-sm btn-secondary" data-action="edit" data-id="' + escHtml(c.id) + '" data-card="' + escHtml(c.cardNumber) + '" data-bank="' + escHtml(c.bankName) + '" data-active="' + (c.isActive ? 'true' : 'false') + '">\u0420\u0435\u0434.</button>'
          + '<button class="btn btn-sm ' + toggleClass + '" data-action="toggle" data-id="' + escHtml(c.id) + '" data-active="' + (c.isActive ? 'false' : 'true') + '">' + toggleLabel + '</button>'
          + '<button class="btn btn-sm btn-danger" data-action="delete" data-id="' + escHtml(c.id) + '">\u0423\u0434\u0430\u043B\u0438\u0442\u044C</button>'
        + '</td>'
        + '</tr>';
    }
    cardsBody.innerHTML = html;
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Event delegation for table action buttons
  cardsBody.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;

    var action = btn.getAttribute('data-action');
    var id = btn.getAttribute('data-id');

    if (action === 'edit') {
      editingId = id;
      modalTitle.textContent = '\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043A\u0430\u0440\u0442\u0443';
      modalCardNumber.value = btn.getAttribute('data-card');
      modalBankName.value = btn.getAttribute('data-bank');
      modalIsActive.checked = btn.getAttribute('data-active') === 'true';
      modalIsActiveLabel.textContent = modalIsActive.checked ? '\u0410\u043A\u0442\u0438\u0432\u043D\u0430' : '\u041D\u0435\u0430\u043A\u0442\u0438\u0432\u043D\u0430';
      modalError.style.display = 'none';
      cardModal.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    if (action === 'toggle') {
      var newActive = btn.getAttribute('data-active') === 'true';
      apiCall('PUT', '', { id: id, isActive: newActive }).then(function(data) {
        if (data.ok) {
          showStatus(newActive ? '\u041A\u0430\u0440\u0442\u0430 \u0430\u043A\u0442\u0438\u0432\u0438\u0440\u043E\u0432\u0430\u043D\u0430' : '\u041A\u0430\u0440\u0442\u0430 \u0434\u0435\u0430\u043A\u0442\u0438\u0432\u0438\u0440\u043E\u0432\u0430\u043D\u0430');
          loadCards();
        } else {
          if (data.reason === 'busy_disable') {
            showStatus('\u041D\u0435\u043B\u044C\u0437\u044F \u0434\u0435\u0430\u043A\u0442\u0438\u0432\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043A\u0430\u0440\u0442\u0443: \u043E\u043D\u0430 \u0441\u0435\u0439\u0447\u0430\u0441 \u0437\u0430\u043D\u044F\u0442\u0430 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0439 \u0437\u0430\u044F\u0432\u043A\u043E\u0439', true);
          } else {
            showStatus(data.error || '\u041E\u0448\u0438\u0431\u043A\u0430', true);
          }
        }
      }).catch(function() { showStatus('\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u044F', true); });
    }

    if (action === 'delete') {
      if (!confirm('\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u044D\u0442\u0443 \u043A\u0430\u0440\u0442\u0443?')) return;
      apiCall('DELETE', '?id=' + id).then(function(data) {
        if (data.ok) {
          showStatus('\u041A\u0430\u0440\u0442\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0430');
          loadCards();
        } else {
          showStatus(data.error || '\u041E\u0448\u0438\u0431\u043A\u0430', true);
        }
      }).catch(function() { showStatus('\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u044F', true); });
    }
  });

  // Add card
  addCardBtn.addEventListener('click', function() {
    editingId = null;
    modalTitle.textContent = '\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043A\u0430\u0440\u0442\u0443';
    modalCardNumber.value = '';
    modalBankName.value = '';
    modalIsActive.checked = true;
    modalIsActiveLabel.textContent = '\u0410\u043A\u0442\u0438\u0432\u043D\u0430';
    modalError.style.display = 'none';
    cardModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  });

  // Save (add/edit)
  modalSave.addEventListener('click', function() {
    var cn = modalCardNumber.value.trim();
    var bn = modalBankName.value.trim();
    if (!cn || cn.length < 4) {
      modalError.textContent = '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043D\u043E\u043C\u0435\u0440 \u043A\u0430\u0440\u0442\u044B';
      modalError.style.display = 'block';
      return;
    }
    if (!bn || bn.length < 2) {
      modalError.textContent = '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0431\u0430\u043D\u043A\u0430';
      modalError.style.display = 'block';
      return;
    }

    modalError.style.display = 'none';

    if (editingId) {
      apiCall('PUT', '', { id: editingId, cardNumber: cn, bankName: bn, isActive: modalIsActive.checked }).then(function(data) {
        if (data.ok) {
          cardModal.classList.remove('active');
          document.body.style.overflow = '';
          showStatus('\u041A\u0430\u0440\u0442\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0430');
          loadCards();
        } else {
          if (data.reason === 'busy_edit') {
            modalError.textContent = '\u041D\u0435\u043B\u044C\u0437\u044F \u0440\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043A\u0430\u0440\u0442\u0443: \u043E\u043D\u0430 \u0441\u0435\u0439\u0447\u0430\u0441 \u0437\u0430\u043D\u044F\u0442\u0430 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0439 \u0437\u0430\u044F\u0432\u043A\u043E\u0439';
          } else {
            modalError.textContent = data.error || '\u041E\u0448\u0438\u0431\u043A\u0430';
          }
          modalError.style.display = 'block';
        }
      }).catch(function() {
        modalError.textContent = '\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u044F';
        modalError.style.display = 'block';
      });
    } else {
      apiCall('POST', '', { cardNumber: cn, bankName: bn, isActive: modalIsActive.checked }).then(function(data) {
        if (data.ok) {
          cardModal.classList.remove('active');
          document.body.style.overflow = '';
          showStatus('\u041A\u0430\u0440\u0442\u0430 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0430');
          loadCards();
        } else {
          modalError.textContent = data.error || '\u041E\u0448\u0438\u0431\u043A\u0430';
          modalError.style.display = 'block';
        }
      }).catch(function() {
        modalError.textContent = '\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u044F';
        modalError.style.display = 'block';
      });
    }
  });

  modalCancel.addEventListener('click', function() {
    cardModal.classList.remove('active');
    document.body.style.overflow = '';
  });

  modalCloseX.addEventListener('click', function() {
    cardModal.classList.remove('active');
    document.body.style.overflow = '';
  });

  modalIsActive.addEventListener('change', function() {
    modalIsActiveLabel.textContent = this.checked ? '\u0410\u043A\u0442\u0438\u0432\u043D\u0430' : '\u041D\u0435\u0430\u043A\u0442\u0438\u0432\u043D\u0430';
  });

  cardModal.addEventListener('click', function(e) {
    if (e.target === cardModal) {
      cardModal.classList.remove('active');
      document.body.style.overflow = '';
    }
  });

  // Refresh — reload cards + stats
  refreshBtn.addEventListener('click', function() {
    loadCards();
    loadStats();
  });

  // ===== Auto-login from saved session =====
  var savedPwd = restoreSession();
  if (savedPwd) {
    password = savedPwd;
    apiCall('GET').then(function(data) {
      if (data.ok) {
        authBox.style.display = 'none';
        mainPanel.style.display = 'block';
        renderCards(data.requisites);
        loadStats();
      } else {
        clearSession();
        password = '';
      }
    }).catch(function() {
      clearSession();
      password = '';
    });
  }

})();
