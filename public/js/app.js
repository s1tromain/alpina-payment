(() => {
  'use strict';

  /* ========== Config ========== */

  var CONFIG = {
    supportUsername: '@alpina_support'
  };

  /* ========== Theme ========== */

  document.documentElement.setAttribute('data-theme', 'dark');

  /* ========== Telegram WebApp ========== */

  var tg = window.Telegram && window.Telegram.WebApp;
  var tgInitData = tg ? tg.initData : '';
  var tgInitUser = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) ? tg.initDataUnsafe.user : null;

  if (tg) {
    tg.ready();
    tg.expand();
  }

  /* ========== DOM: Screens & Nav ========== */

  var screens = {
    offer: document.getElementById('screenOffer'),
    home: document.getElementById('screenHome'),
    history: document.getElementById('screenHistory'),
    profile: document.getElementById('screenProfile'),
    payment: document.getElementById('screenPayment')
  };

  var bottomNav = document.getElementById('bottomNav');
  var navItems = bottomNav.querySelectorAll('.nav-item');

  /* ========== DOM: Home (Exchange) ========== */

  var offerAcceptBtn = document.getElementById('offerAcceptBtn');
  var amountRubInput = document.getElementById('amountRub');
  var payoutDetailsInput = document.getElementById('payoutDetails');
  var rateValueEl = document.getElementById('rateValue');
  var receiveTotalEl = document.getElementById('receiveTotal');
  var rateUpdateEl = document.getElementById('rateUpdate');
  var nextBtn = document.getElementById('nextBtn');
  var quickAmountsEl = document.getElementById('quickAmounts');

  /* ========== DOM: Payment ========== */

  var payOrderIdEl = document.getElementById('payOrderId');
  var payReceiveAmountEl = document.getElementById('payReceiveAmount');
  var payRateEl = document.getElementById('payRate');
  var payAmountRubEl = document.getElementById('payAmountRub');
  var payCardNumberEl = document.getElementById('payCardNumber');
  var payBankNameEl = document.getElementById('payBankName');
  var timerBadgeEl = document.getElementById('timerBadge');
  var timerTextEl = document.getElementById('timerText');

  var fileInput = document.getElementById('fileInput');
  var uploadZone = document.getElementById('uploadZone');
  var filePreview = document.getElementById('filePreview');
  var previewImg = document.getElementById('previewImg');
  var fileNameEl = document.getElementById('fileName');
  var removeFileBtn = document.getElementById('removeFile');
  var submitBtn = document.getElementById('submitBtn');
  var backBtn = document.getElementById('backBtn');

  /* ========== DOM: Modal ========== */

  var modalOverlay = document.getElementById('modalOverlay');
  var modalCloseBtn = document.getElementById('modalCloseBtn');
  var modalOrderIdEl = document.getElementById('modalOrderId');
  var modalReceiveEl = document.getElementById('modalReceive');
  var modalPayEl = document.getElementById('modalPay');

  /* ========== DOM: History ========== */

  var historyList = document.getElementById('historyList');
  var historyLoading = document.getElementById('historyLoading');
  var historyEmpty = document.getElementById('historyEmpty');

  /* ========== DOM: Profile ========== */

  var profileAvatar = document.getElementById('profileAvatar');
  var profileInitials = document.getElementById('profileInitials');
  var profileName = document.getElementById('profileName');
  var profileUsername = document.getElementById('profileUsername');
  var profileId = document.getElementById('profileId');

  var statTotalRub = document.getElementById('statTotalRub');
  var statTotalUsdt = document.getElementById('statTotalUsdt');
  var statTotalOrders = document.getElementById('statTotalOrders');
  var statPendingCount = document.getElementById('statPendingCount');
  var statRejectedCount = document.getElementById('statRejectedCount');

  /* ========== State ========== */

  var currentRate = null;
  var rateInterval = null;
  var currentOrder = null;
  var timerInterval = null;
  var currentScreen = 'home';
  var historyLoadedAt = 0;
  var profileLoadedAt = 0;
  var CACHE_MS = 20000;

  /* ========== Navigation ========== */

  function showScreen(name) {
    currentScreen = name;

    Object.keys(screens).forEach(function (key) {
      if (screens[key]) screens[key].classList.remove('active');
    });
    if (screens[name]) screens[name].classList.add('active');

    // Bottom nav visible only on main tabs
    var navVisible = (name === 'home' || name === 'history' || name === 'profile');
    bottomNav.classList.toggle('visible', navVisible);
    document.body.classList.toggle('has-nav', navVisible);

    // Update nav active state
    navItems.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-nav') === name);
    });

    // Rate updates only on home
    if (name === 'home') {
      startRateUpdates();
    } else {
      stopRateUpdates();
    }

    // Lazy-load per screen
    if (name === 'history') {
      loadHistory();
    } else if (name === 'profile') {
      loadProfile();
    }

    window.scrollTo(0, 0);
  }

  navItems.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.getAttribute('data-nav');
      if (target && target !== currentScreen) showScreen(target);
    });
  });

  /* ========== Offer / Agreement ========== */

  var OFFER_KEY = 'alpina_offer_accepted';

  function isOfferAccepted() {
    return localStorage.getItem(OFFER_KEY) === '1';
  }

  function acceptOffer() {
    localStorage.setItem(OFFER_KEY, '1');
  }

  if (offerAcceptBtn) {
    offerAcceptBtn.addEventListener('click', function () {
      acceptOffer();
      showScreen('home');
    });
  }

  var backBusy = false;

  backBtn.addEventListener('click', function () {
    if (currentScreen === 'payment' && !backBusy) {
      backBusy = true;
      if (timerInterval) clearInterval(timerInterval);
      timerBadgeEl.classList.remove('warning', 'expired');
      timerTextEl.textContent = '30:00';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Отправить заявку';

      if (currentOrder && currentOrder.orderId) {
        var cancelXhr = new XMLHttpRequest();
        cancelXhr.open('DELETE', '/api/create-order');
        cancelXhr.setRequestHeader('Content-Type', 'application/json');
        if (tgInitData) {
          cancelXhr.setRequestHeader('X-Telegram-Init-Data', tgInitData);
        }
        cancelXhr.send(JSON.stringify({ orderId: currentOrder.orderId }));
        currentOrder = null;
      }

      showScreen('home');
      backBusy = false;
    }
  });

  /* ========== Rate ========== */

  function fetchRate() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/rate');
    xhr.onload = function () {
      try {
        var data = JSON.parse(xhr.responseText);
        if (data.ok && data.finalRate) {
          currentRate = data.finalRate;
          rateValueEl.textContent = data.finalRate.toFixed(2) + ' ₽';
          updateReceiveTotal();
          var now = new Date();
          rateUpdateEl.textContent = 'Обновлено: ' + now.toLocaleTimeString('ru-RU');
        }
      } catch (e) {}
    };
    xhr.onerror = function () {};
    xhr.send();
  }

  function updateReceiveTotal() {
    var val = parseFloat(amountRubInput.value);
    if (currentRate && currentRate > 0 && val > 0) {
      var usdt = (val / currentRate).toFixed(2);
      receiveTotalEl.textContent = usdt + ' USDT';
    } else {
      receiveTotalEl.textContent = '—';
    }
  }

  function startRateUpdates() {
    if (rateInterval) clearInterval(rateInterval);
    fetchRate();
    rateInterval = setInterval(fetchRate, 30000);
  }

  function stopRateUpdates() {
    if (rateInterval) {
      clearInterval(rateInterval);
      rateInterval = null;
    }
  }

  amountRubInput.addEventListener('input', function () {
    var v = amountRubInput.value.replace(/[^0-9.]/g, '');
    var parts = v.split('.');
    if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
    if (parts[1] && parts[1].length > 2) v = parts[0] + '.' + parts[1].substring(0, 2);
    amountRubInput.value = v;
    updateReceiveTotal();
    amountRubInput.closest('.field').classList.remove('error');
    markQuickAmount();
  });

  payoutDetailsInput.addEventListener('input', function () {
    payoutDetailsInput.closest('.field').classList.remove('error');
  });

  /* ========== Quick Amounts ========== */

  function markQuickAmount() {
    var val = parseFloat(amountRubInput.value);
    quickAmountsEl.querySelectorAll('.quick-amount').forEach(function (btn) {
      var a = parseFloat(btn.getAttribute('data-amount'));
      btn.classList.toggle('active', a === val);
    });
  }

  quickAmountsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.quick-amount');
    if (!btn) return;
    var amount = btn.getAttribute('data-amount');
    amountRubInput.value = amount;
    amountRubInput.closest('.field').classList.remove('error');
    updateReceiveTotal();
    markQuickAmount();
  });

  /* ========== Create Order (Step 1) ========== */

  nextBtn.addEventListener('click', function () {
    var valid = true;
    var amount = parseFloat(amountRubInput.value);

    if (!amount || amount <= 0) {
      amountRubInput.closest('.field').classList.add('error');
      valid = false;
    } else if (amount < 1000) {
      amountRubInput.closest('.field').classList.add('error');
      showAlert('Минимальная сумма покупки — 1000 RUB');
      return;
    }

    var details = payoutDetailsInput.value.trim();
    if (!details || details.length < 5) {
      payoutDetailsInput.closest('.field').classList.add('error');
      valid = false;
    }

    if (!currentRate) {
      showAlert('Курс не загружен. Попробуйте позже.');
      return;
    }

    if (!valid) return;

    nextBtn.disabled = true;
    nextBtn.textContent = 'Создание...';

    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/create-order');
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (tgInitData) {
      xhr.setRequestHeader('X-Telegram-Init-Data', tgInitData);
    }
    xhr.onload = function () {
      try {
        var data = JSON.parse(xhr.responseText);
        if (!data.ok) {
          showAlert(getErrorMessage(data));
          nextBtn.disabled = false;
          nextBtn.textContent = 'Купить USDT';
          return;
        }

        currentOrder = data;

        payOrderIdEl.textContent = data.seqId ? '#' + data.seqId : data.orderId;
        payAmountRubEl.textContent = data.payAmount.toFixed(2) + ' ₽';
        payReceiveAmountEl.textContent = data.receiveAmount + ' ' + data.receiveCurrency;
        payRateEl.textContent = data.finalRate.toFixed(2) + ' ₽';
        payCardNumberEl.textContent = data.cardNumber || '—';
        payBankNameEl.textContent = data.bankName || '—';

        timerBadgeEl.classList.remove('warning', 'expired');
        startTimer(new Date(data.expiresAt));

        fileInput.value = '';
        previewImg.src = '';
        fileNameEl.textContent = '';
        filePreview.classList.remove('active');
        uploadZone.classList.remove('error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Отправить заявку';

        showScreen('payment');

        var confirmXhr = new XMLHttpRequest();
        confirmXhr.open('PATCH', '/api/create-order');
        confirmXhr.setRequestHeader('Content-Type', 'application/json');
        if (tgInitData) {
          confirmXhr.setRequestHeader('X-Telegram-Init-Data', tgInitData);
        }
        confirmXhr.send(JSON.stringify({ orderId: data.orderId }));

        nextBtn.disabled = false;
        nextBtn.textContent = 'Купить USDT';
      } catch (e) {
        showAlert('Ошибка ответа сервера', { showSupport: true });
        nextBtn.disabled = false;
        nextBtn.textContent = 'Купить USDT';
      }
    };
    xhr.onerror = function () {
      showAlert('Ошибка сети. Проверьте подключение.', { showSupport: true });
      nextBtn.disabled = false;
      nextBtn.textContent = 'Купить USDT';
    };
    xhr.send(JSON.stringify({ amountRub: amount, payoutDetails: details }));
  });

  /* ========== Timer ========== */

  function startTimer(expiresAt) {
    if (timerInterval) clearInterval(timerInterval);

    function tick() {
      var now = new Date();
      var diff = expiresAt - now;

      if (diff <= 0) {
        clearInterval(timerInterval);
        timerTextEl.textContent = '00:00';
        timerBadgeEl.classList.add('expired');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Время истекло';

        setTimeout(function () {
          showScreen('home');
          showAlert('Время оплаты истекло. Создайте новую заявку.', { showSupport: true });
        }, 2000);
        return;
      }

      var mins = Math.floor(diff / 60000);
      var secs = Math.floor((diff % 60000) / 1000);
      timerTextEl.textContent = pad(mins) + ':' + pad(secs);

      if (diff < 5 * 60000) {
        timerBadgeEl.classList.add('warning');
      }
    }

    tick();
    timerInterval = setInterval(tick, 1000);
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /* ========== File Handling ========== */

  var MAX_FILE_SIZE = 4.5 * 1024 * 1024;

  function handleFile(file) {
    if (!file) return;
    if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
      showAlert('Допустимые форматы: JPG, PNG');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      showAlert('Файл слишком большой. Максимум 4.5 МБ.');
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      previewImg.src = e.target.result;
      fileNameEl.textContent = file.name;
      filePreview.classList.add('active');
    };
    reader.readAsDataURL(file);
  }

  fileInput.addEventListener('change', function () {
    handleFile(fileInput.files[0]);
    uploadZone.classList.remove('error');
  });

  removeFileBtn.addEventListener('click', function () {
    fileInput.value = '';
    previewImg.src = '';
    fileNameEl.textContent = '';
    filePreview.classList.remove('active');
  });

  ['dragenter', 'dragover'].forEach(function (evt) {
    uploadZone.addEventListener(evt, function (e) {
      e.preventDefault();
      uploadZone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    uploadZone.addEventListener(evt, function () {
      uploadZone.classList.remove('dragover');
    });
  });
  uploadZone.addEventListener('drop', function (e) {
    e.preventDefault();
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });

  /* ========== Submit Receipt (Step 2) ========== */

  submitBtn.addEventListener('click', function () {
    if (!currentOrder) return;

    if (!fileInput.files.length) {
      uploadZone.classList.add('error');
      showAlert('Прикрепите чек для отправки заявки');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Отправка...';

    var fd = new FormData();
    fd.append('orderId', currentOrder.orderId);
    fd.append('receipt', fileInput.files[0]);

    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/submit');
    if (tgInitData) {
      xhr.setRequestHeader('X-Telegram-Init-Data', tgInitData);
    }
    xhr.onload = function () {
      try {
        var data = JSON.parse(xhr.responseText);
        if (!data.ok) {
          showAlert(getErrorMessage(data));
          submitBtn.disabled = false;
          submitBtn.textContent = 'Отправить заявку';
          return;
        }

        if (timerInterval) clearInterval(timerInterval);

        modalOrderIdEl.textContent = currentOrder.seqId ? '#' + currentOrder.seqId : currentOrder.orderId;
        modalPayEl.textContent = currentOrder.payAmount.toFixed(2) + ' ₽';
        modalReceiveEl.textContent = currentOrder.receiveAmount + ' ' + currentOrder.receiveCurrency;

        var svg = document.querySelector('.modal-check svg');
        var clone = svg.cloneNode(true);
        svg.parentNode.replaceChild(clone, svg);

        modalOverlay.classList.add('active');

        amountRubInput.value = '';
        payoutDetailsInput.value = '';
        fileInput.value = '';
        previewImg.src = '';
        fileNameEl.textContent = '';
        filePreview.classList.remove('active');
        markQuickAmount();

        // Invalidate caches — user's history & stats just changed
        historyLoadedAt = 0;
        profileLoadedAt = 0;

        currentOrder = null;

      } catch (e) {
        showAlert('Ошибка ответа сервера', { showSupport: true });
        submitBtn.disabled = false;
        submitBtn.textContent = 'Отправить заявку';
      }
    };
    xhr.onerror = function () {
      showAlert('Ошибка сети. Проверьте подключение.', { showSupport: true });
      submitBtn.disabled = false;
      submitBtn.textContent = 'Отправить заявку';
    };
    xhr.send(fd);
  });

  /* ========== Modal ========== */

  function closeModal() {
    modalOverlay.classList.remove('active');
    showScreen('history');
  }

  modalCloseBtn.addEventListener('click', closeModal);

  modalOverlay.addEventListener('click', function (e) {
    if (e.target === modalOverlay) closeModal();
  });

  /* ========== History ========== */

  var statusMeta = {
    created:   { label: 'Ожидает оплаты', cls: 'st-pending' },
    pending:   { label: 'На проверке',    cls: 'st-pending' },
    approved:  { label: 'Выполнена',      cls: 'st-approved' },
    completed: { label: 'Завершено',      cls: 'st-approved' },
    rejected:  { label: 'Отклонена',      cls: 'st-rejected' },
    expired:   { label: 'Истекла',        cls: 'st-expired' },
    cancelled: { label: 'Отменена',       cls: 'st-expired' }
  };

  var CANCELLABLE = { created: true, pending: true };

  historyList.addEventListener('click', function (e) {
    var btn = e.target.closest('.btn-cancel-order');
    if (!btn || btn.disabled) return;
    var oid = btn.getAttribute('data-order-id');
    if (!oid) return;
    if (!confirm('Отменить заявку ' + oid + '?')) return;
    cancelOrder(oid, btn);
  });

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      return d.toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { return '—'; }
  }

  function formatAmount(n) {
    var v = Number(n);
    if (!isFinite(v)) return '—';
    return v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderHistory(orders) {
    if (!orders || !orders.length) {
      historyList.innerHTML = '';
      historyList.classList.remove('active');
      historyEmpty.classList.add('active');
      return;
    }
    historyEmpty.classList.remove('active');

    var html = orders.map(function (o) {
      var meta = statusMeta[o.status] || { label: o.status, cls: '' };
      return '' +
        '<div class="order-item">' +
          '<div class="order-row order-row-top">' +
            '<div class="order-date">' + formatDate(o.created_at) + '</div>' +
            '<div class="order-status ' + meta.cls + '">' + meta.label + '</div>' +
          '</div>' +
          '<div class="order-row order-row-main">' +
            '<div class="order-amount">' +
              '<div class="order-amount-main">' + formatAmount(o.receive_amount) + ' ' + escapeHtml(o.receive_currency || 'USDT') + '</div>' +
              '<div class="order-amount-sub">' + formatAmount(o.pay_amount) + ' ₽</div>' +
            '</div>' +
            '<div class="order-rate">' +
              '<div class="order-rate-label">Курс</div>' +
              '<div class="order-rate-value">' + formatAmount(o.final_rate) + ' ₽</div>' +
            '</div>' +
          '</div>' +
          '<div class="order-row order-row-bottom">' +
            '<span class="order-id">' + escapeHtml(o.order_id) + '</span>' +
            (CANCELLABLE[o.status] ? '<button class="btn-cancel-order" data-order-id="' + escapeHtml(o.order_id) + '">Отменить</button>' : '') +
          '</div>' +
        '</div>';
    }).join('');

    historyList.innerHTML = html;
    historyList.classList.add('active');
  }

  function cancelOrder(orderId, btn) {
    if (btn) btn.disabled = true;
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/order/cancel');
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (tgInitData) xhr.setRequestHeader('X-Telegram-Init-Data', tgInitData);
    xhr.onload = function () {
      try {
        var data = JSON.parse(xhr.responseText);
        if (data.ok) {
          historyLoadedAt = 0;
          loadHistory(true);
        } else {
          if (btn) btn.disabled = false;
          showAlert(data.error || 'Не удалось отменить заявку');
        }
      } catch (e) {
        if (btn) btn.disabled = false;
        showAlert('Ошибка ответа сервера');
      }
    };
    xhr.onerror = function () {
      if (btn) btn.disabled = false;
      showAlert('Ошибка сети. Проверьте подключение.');
    };
    xhr.send(JSON.stringify({ orderId: orderId }));
  }

  function loadHistory(force) {
    var now = Date.now();
    if (!force && historyLoadedAt && (now - historyLoadedAt) < CACHE_MS) {
      return;
    }

    historyLoading.classList.add('active');
    historyEmpty.classList.remove('active');
    historyList.classList.remove('active');

    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/user/orders');
    if (tgInitData) {
      xhr.setRequestHeader('X-Telegram-Init-Data', tgInitData);
    }
    xhr.onload = function () {
      historyLoading.classList.remove('active');
      try {
        var data = JSON.parse(xhr.responseText);
        if (data.ok) {
          historyLoadedAt = Date.now();
          renderHistory(data.orders);
        } else {
          historyList.innerHTML = '';
          showAlert(data.error || 'Не удалось загрузить историю');
        }
      } catch (e) {
        showAlert('Ошибка ответа сервера');
      }
    };
    xhr.onerror = function () {
      historyLoading.classList.remove('active');
      showAlert('Ошибка сети. Проверьте подключение.');
    };
    xhr.send();
  }

  /* ========== Profile ========== */

  function getInitials() {
    if (!tgInitUser) return '?';
    var base = (tgInitUser.first_name || tgInitUser.username || '?').trim();
    if (!base) return '?';
    return base.charAt(0).toUpperCase();
  }

  function generateAvatar(user) {
    var name = (user && (user.first_name || user.username)) || 'U';
    var initial = name.charAt(0).toUpperCase();
    return 'https://ui-avatars.com/api/?name=' + encodeURIComponent(initial) + '&background=0D8ABC&color=fff&size=128&bold=true';
  }

  function applyProfileFromTg() {
    var name = '—';
    var uname = '—';
    var idText = '';
    if (tgInitUser) {
      var parts = [];
      if (tgInitUser.first_name) parts.push(tgInitUser.first_name);
      if (tgInitUser.last_name) parts.push(tgInitUser.last_name);
      name = parts.length ? parts.join(' ') : (tgInitUser.username || 'Пользователь');
      uname = tgInitUser.username ? '@' + tgInitUser.username : '';
      idText = tgInitUser.id ? 'ID ' + tgInitUser.id : '';
    }
    profileName.textContent = name;
    profileUsername.textContent = uname;
    profileId.textContent = idText;

    profileInitials.textContent = getInitials();

    console.log('Avatar URL:', tgInitUser && tgInitUser.photo_url);

    if (tgInitUser && tgInitUser.photo_url && tgInitUser.photo_url.startsWith('http')) {
      setAvatarImage(tgInitUser.photo_url, generateAvatar(tgInitUser));
    } else {
      setAvatarImage(generateAvatar(tgInitUser));
    }
  }

  function setAvatarImage(url, fallbackUrl) {
    var existing = profileAvatar.querySelector('img');
    if (existing) existing.remove();

    var img = new Image();
    img.alt = '';
    img.onload = function () {
      profileInitials.style.display = 'none';
    };
    img.onerror = function () {
      img.remove();
      if (fallbackUrl) {
        setAvatarImage(fallbackUrl);
      } else {
        profileInitials.style.display = '';
      }
    };
    img.src = url;
    profileAvatar.appendChild(img);
  }

  function applyStats(stats) {
    if (!stats) return;
    statTotalRub.textContent = formatAmount(stats.totalRub);
    statTotalUsdt.textContent = formatAmount(stats.totalUsdt);
    statTotalOrders.textContent = String(stats.totalOrders || 0);
    statPendingCount.textContent = String(stats.pendingCount || 0);
    statRejectedCount.textContent = String(stats.rejectedCount || 0);
  }

  function loadProfile(force) {
    applyProfileFromTg();

    var now = Date.now();
    if (!force && profileLoadedAt && (now - profileLoadedAt) < CACHE_MS) {
      return;
    }

    // Fetch canonical profile (server-validated) + stats in parallel
    var profileXhr = new XMLHttpRequest();
    profileXhr.open('GET', '/api/user/profile');
    if (tgInitData) profileXhr.setRequestHeader('X-Telegram-Init-Data', tgInitData);
    profileXhr.onload = function () {
      try {
        var data = JSON.parse(profileXhr.responseText);
        if (data.ok && data.profile) {
          var p = data.profile;
          var parts = [];
          if (p.firstName) parts.push(p.firstName);
          if (p.lastName) parts.push(p.lastName);
          var name = parts.length ? parts.join(' ') : (p.username || 'Пользователь');
          profileName.textContent = name;
          profileUsername.textContent = p.username ? '@' + p.username : '';
          profileId.textContent = p.telegramId ? 'ID ' + p.telegramId : '';
          if (p.photoUrl) setAvatarImage(p.photoUrl);
        }
      } catch (e) {}
    };
    profileXhr.send();

    var statsXhr = new XMLHttpRequest();
    statsXhr.open('GET', '/api/user/stats');
    if (tgInitData) statsXhr.setRequestHeader('X-Telegram-Init-Data', tgInitData);
    statsXhr.onload = function () {
      try {
        var data = JSON.parse(statsXhr.responseText);
        if (data.ok && data.stats) {
          applyStats(data.stats);
          profileLoadedAt = Date.now();
        } else {
          applyStats({ totalRub: 0, totalUsdt: 0, totalOrders: 0, pendingCount: 0, rejectedCount: 0 });
        }
      } catch (e) {}
    };
    statsXhr.onerror = function () {};
    statsXhr.send();
  }

  /* ========== Helpers ========== */

  var reasonMessages = {
    concurrent_request: 'Запрос уже обрабатывается. Подождите.',
    active_order: 'У вас уже есть активная заявка. Дождитесь её обработки или истечения срока.',
    cooldown_active: 'Подождите немного перед следующей заявкой',
    no_free_cards: 'Свободные реквизиты временно отсутствуют, попробуйте позже',
    daily_limit: 'Дневной лимит по сумме исчерпан. Попробуйте позже.',
    rate_10m: 'Слишком много заявок, попробуйте позже',
    rate_24h: 'Слишком много заявок за сутки',
    duplicate: 'Похожая заявка уже была отправлена',
    too_fast: 'Форма отправлена слишком быстро',
    validation: 'Проверьте введённые данные'
  };

  function getErrorMessage(data) {
    if (data.reason && reasonMessages[data.reason]) {
      return reasonMessages[data.reason];
    }
    return data.error || 'Ошибка сервера';
  }

  function showAlert(msg, opts) {
    opts = opts || {};
    var existing = document.getElementById('toastAlert');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id = 'toastAlert';
    toast.className = 'toast-alert' + (opts.type === 'success' ? ' toast-success' : '');

    var text = document.createElement('div');
    text.className = 'toast-text';
    text.textContent = msg;
    toast.appendChild(text);

    if (opts.showSupport) {
      var support = document.createElement('div');
      support.className = 'toast-support';
      support.textContent = 'Поддержка: ' + CONFIG.supportUsername;
      toast.appendChild(support);
    }

    var closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.textContent = '×';
    closeBtn.onclick = function() { toast.remove(); };
    toast.appendChild(closeBtn);

    document.body.appendChild(toast);
    requestAnimationFrame(function() { toast.classList.add('visible'); });

    var dur = opts.duration || 5000;
    setTimeout(function() {
      toast.classList.remove('visible');
      setTimeout(function() { toast.remove(); }, 300);
    }, dur);
  }

  /* ========== Init ========== */

  if (isOfferAccepted()) {
    showScreen('home');
  } else {
    showScreen('offer');
  }

})();
