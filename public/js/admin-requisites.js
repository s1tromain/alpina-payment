(function() {
  'use strict';

  var API = '/api/admin-requisites';
  var password = '';
  var editingId = null;

  var authBox = document.getElementById('authBox');
  var mainPanel = document.getElementById('mainPanel');
  var authError = document.getElementById('authError');
  var adminPasswordInput = document.getElementById('adminPassword');
  var loginBtn = document.getElementById('loginBtn');
  var addCardBtn = document.getElementById('addCardBtn');
  var seedBtn = document.getElementById('seedBtn');
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

  // Login
  loginBtn.addEventListener('click', function() {
    password = adminPasswordInput.value.trim();
    if (!password) return;

    authError.style.display = 'none';
    apiCall('GET').then(function(data) {
      if (!data.ok) {
        authError.textContent = 'Неверный пароль';
        authError.style.display = 'block';
        password = '';
        return;
      }
      authBox.style.display = 'none';
      mainPanel.style.display = 'block';
      renderCards(data.requisites);
    }).catch(function() {
      authError.textContent = 'Ошибка соединения';
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
      else showStatus('Ошибка загрузки', true);
    }).catch(function() { showStatus('Ошибка соединения', true); });
  }

  function renderCards(cards) {
    if (!cards || cards.length === 0) {
      cardsBody.innerHTML = '<tr><td colspan="6" class="empty-msg">Нет реквизитов. Добавьте карту или загрузите тестовые.</td></tr>';
      return;
    }

    var html = '';
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var activeBadge = c.isActive
        ? '<span class="badge badge-active">Да</span>'
        : '<span class="badge badge-inactive">Нет</span>';
      var statusBadge = c.status === 'busy'
        ? '<span class="badge badge-busy">Занята</span>'
        : '<span class="badge badge-free">Свободна</span>';
      var orderCell = c.currentOrderId || '\u2014';
      var toggleLabel = c.isActive ? 'Выкл' : 'Вкл';
      var toggleClass = c.isActive ? 'btn-warn' : 'btn-ok';

      html += '<tr>'
        + '<td class="card-number">' + escHtml(c.cardNumber) + '</td>'
        + '<td>' + escHtml(c.bankName) + '</td>'
        + '<td>' + activeBadge + '</td>'
        + '<td>' + statusBadge + '</td>'
        + '<td style="font-size:.75rem">' + escHtml(orderCell) + '</td>'
        + '<td class="td-actions">'
          + '<button class="btn btn-sm btn-secondary" data-action="edit" data-id="' + escHtml(c.id) + '" data-card="' + escHtml(c.cardNumber) + '" data-bank="' + escHtml(c.bankName) + '">Ред.</button>'
          + '<button class="btn btn-sm ' + toggleClass + '" data-action="toggle" data-id="' + escHtml(c.id) + '" data-active="' + (c.isActive ? 'false' : 'true') + '">' + toggleLabel + '</button>'
          + '<button class="btn btn-sm btn-danger" data-action="delete" data-id="' + escHtml(c.id) + '">Удалить</button>'
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
      modalTitle.textContent = 'Редактировать карту';
      modalCardNumber.value = btn.getAttribute('data-card');
      modalBankName.value = btn.getAttribute('data-bank');
      modalError.style.display = 'none';
      cardModal.classList.add('active');
    }

    if (action === 'toggle') {
      var newActive = btn.getAttribute('data-active') === 'true';
      apiCall('PUT', '', { id: id, isActive: newActive }).then(function(data) {
        if (data.ok) {
          showStatus(newActive ? 'Карта активирована' : 'Карта деактивирована');
          loadCards();
        } else {
          showStatus(data.error || 'Ошибка', true);
        }
      }).catch(function() { showStatus('Ошибка соединения', true); });
    }

    if (action === 'delete') {
      if (!confirm('Удалить эту карту?')) return;
      apiCall('DELETE', '?id=' + id).then(function(data) {
        if (data.ok) {
          showStatus('Карта удалена');
          loadCards();
        } else {
          showStatus(data.error || 'Ошибка', true);
        }
      }).catch(function() { showStatus('Ошибка соединения', true); });
    }
  });

  // Add card
  addCardBtn.addEventListener('click', function() {
    editingId = null;
    modalTitle.textContent = 'Добавить карту';
    modalCardNumber.value = '';
    modalBankName.value = '';
    modalError.style.display = 'none';
    cardModal.classList.add('active');
  });

  // Save (add/edit)
  modalSave.addEventListener('click', function() {
    var cn = modalCardNumber.value.trim();
    var bn = modalBankName.value.trim();
    if (!cn || cn.length < 4) {
      modalError.textContent = 'Введите номер карты';
      modalError.style.display = 'block';
      return;
    }
    if (!bn || bn.length < 2) {
      modalError.textContent = 'Введите название банка';
      modalError.style.display = 'block';
      return;
    }

    modalError.style.display = 'none';

    if (editingId) {
      apiCall('PUT', '', { id: editingId, cardNumber: cn, bankName: bn }).then(function(data) {
        if (data.ok) {
          cardModal.classList.remove('active');
          showStatus('Карта обновлена');
          loadCards();
        } else {
          modalError.textContent = data.error || 'Ошибка';
          modalError.style.display = 'block';
        }
      }).catch(function() {
        modalError.textContent = 'Ошибка соединения';
        modalError.style.display = 'block';
      });
    } else {
      apiCall('POST', '', { cardNumber: cn, bankName: bn }).then(function(data) {
        if (data.ok) {
          cardModal.classList.remove('active');
          showStatus('Карта добавлена');
          loadCards();
        } else {
          modalError.textContent = data.error || 'Ошибка';
          modalError.style.display = 'block';
        }
      }).catch(function() {
        modalError.textContent = 'Ошибка соединения';
        modalError.style.display = 'block';
      });
    }
  });

  modalCancel.addEventListener('click', function() {
    cardModal.classList.remove('active');
  });

  cardModal.addEventListener('click', function(e) {
    if (e.target === cardModal) cardModal.classList.remove('active');
  });

  // Seed
  seedBtn.addEventListener('click', function() {
    apiCall('GET', '?action=seed').then(function(data) {
      if (data.ok) {
        showStatus(data.seeded ? 'Загружено ' + data.seeded + ' тестовых карт' : (data.message || 'Готово'));
        loadCards();
      } else {
        showStatus(data.error || 'Ошибка', true);
      }
    }).catch(function() { showStatus('Ошибка соединения', true); });
  });

  // Refresh
  refreshBtn.addEventListener('click', loadCards);

})();
