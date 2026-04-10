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

  if (tg) {
    tg.ready();
    tg.expand();
  }

  /* ========== DOM Elements ========== */

  var screens = {
    offer: document.getElementById('screenOffer'),
    exchange: document.getElementById('screenExchange'),
    payment: document.getElementById('screenPayment')
  };

  var offerAcceptBtn = document.getElementById('offerAcceptBtn');

  var amountRubInput = document.getElementById('amountRub');
  var payoutDetailsInput = document.getElementById('payoutDetails');
  var rateValueEl = document.getElementById('rateValue');
  var receiveTotalEl = document.getElementById('receiveTotal');
  var rateUpdateEl = document.getElementById('rateUpdate');
  var nextBtn = document.getElementById('nextBtn');

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

  var modalOverlay = document.getElementById('modalOverlay');
  var modalCloseBtn = document.getElementById('modalCloseBtn');
  var modalOrderIdEl = document.getElementById('modalOrderId');
  var modalReceiveEl = document.getElementById('modalReceive');
  var modalPayEl = document.getElementById('modalPay');

  /* ========== State ========== */

  var currentRate = null;
  var rateInterval = null;
  var currentOrder = null;
  var timerInterval = null;
  var currentScreen = 'exchange';

  /* ========== Navigation ========== */

  function showScreen(name) {
    currentScreen = name;

    Object.keys(screens).forEach(function (key) {
      screens[key].classList.remove('active');
    });
    if (screens[name]) screens[name].classList.add('active');

    if (name === 'exchange') {
      startRateUpdates();
    } else {
      stopRateUpdates();
    }
  }

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
      showScreen('exchange');
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
      submitBtn.textContent = '\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0443';

      // Cancel draft order to release card
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

      showScreen('exchange');
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
          rateValueEl.textContent = data.finalRate.toFixed(2) + ' \u20BD';
          updateReceiveTotal();
          var now = new Date();
          rateUpdateEl.textContent = '\u041E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u043E: ' + now.toLocaleTimeString('ru-RU');
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
      receiveTotalEl.textContent = '\u2014';
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
  });

  payoutDetailsInput.addEventListener('input', function () {
    payoutDetailsInput.closest('.field').classList.remove('error');
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
      showAlert('\u041C\u0438\u043D\u0438\u043C\u0430\u043B\u044C\u043D\u0430\u044F \u0441\u0443\u043C\u043C\u0430 \u043F\u043E\u043A\u0443\u043F\u043A\u0438 \u2014 1000 RUB');
      return;
    }

    var details = payoutDetailsInput.value.trim();
    if (!details || details.length < 5) {
      payoutDetailsInput.closest('.field').classList.add('error');
      valid = false;
    }

    if (!currentRate) {
      showAlert('\u041A\u0443\u0440\u0441 \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435.');
      return;
    }

    if (!valid) return;

    nextBtn.disabled = true;
    nextBtn.textContent = '\u0421\u043E\u0437\u0434\u0430\u043D\u0438\u0435...';

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
          nextBtn.textContent = '\u0414\u0430\u043B\u0435\u0435';
          return;
        }

        currentOrder = data;

        payOrderIdEl.textContent = data.seqId ? '#' + data.seqId : data.orderId;
        payAmountRubEl.textContent = data.payAmount.toFixed(2) + ' \u20BD';
        payReceiveAmountEl.textContent = data.receiveAmount + ' ' + data.receiveCurrency;
        payRateEl.textContent = data.finalRate.toFixed(2) + ' \u20BD';
        payCardNumberEl.textContent = data.cardNumber || '\u2014';
        payBankNameEl.textContent = data.bankName || '\u2014';

        timerBadgeEl.classList.remove('warning', 'expired');
        startTimer(new Date(data.expiresAt));

        fileInput.value = '';
        previewImg.src = '';
        fileNameEl.textContent = '';
        filePreview.classList.remove('active');
        uploadZone.classList.remove('error');
        submitBtn.disabled = false;
        submitBtn.textContent = '\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0443';

        showScreen('payment');

        // Confirm draft order — tells backend the user saw the payment page
        var confirmXhr = new XMLHttpRequest();
        confirmXhr.open('PATCH', '/api/create-order');
        confirmXhr.setRequestHeader('Content-Type', 'application/json');
        if (tgInitData) {
          confirmXhr.setRequestHeader('X-Telegram-Init-Data', tgInitData);
        }
        confirmXhr.send(JSON.stringify({ orderId: data.orderId }));

        nextBtn.disabled = false;
        nextBtn.textContent = '\u0414\u0430\u043B\u0435\u0435';
      } catch (e) {
        showAlert('\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u0432\u0435\u0442\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430', { showSupport: true });
        nextBtn.disabled = false;
        nextBtn.textContent = '\u0414\u0430\u043B\u0435\u0435';
      }
    };
    xhr.onerror = function () {
      showAlert('\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0442\u0438. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435.', { showSupport: true });
      nextBtn.disabled = false;
      nextBtn.textContent = '\u0414\u0430\u043B\u0435\u0435';
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
        submitBtn.textContent = '\u0412\u0440\u0435\u043C\u044F \u0438\u0441\u0442\u0435\u043A\u043B\u043E';

        setTimeout(function () {
          showScreen('exchange');
          showAlert('\u0412\u0440\u0435\u043C\u044F \u043E\u043F\u043B\u0430\u0442\u044B \u0438\u0441\u0442\u0435\u043A\u043B\u043E. \u0421\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u043D\u043E\u0432\u0443\u044E \u0437\u0430\u044F\u0432\u043A\u0443.', { showSupport: true });
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
      showAlert('\u0414\u043E\u043F\u0443\u0441\u0442\u0438\u043C\u044B\u0435 \u0444\u043E\u0440\u043C\u0430\u0442\u044B: JPG, PNG');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      showAlert('\u0424\u0430\u0439\u043B \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0431\u043E\u043B\u044C\u0448\u043E\u0439. \u041C\u0430\u043A\u0441\u0438\u043C\u0443\u043C 4.5 \u041C\u0411.');
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
      showAlert('\u041F\u0440\u0438\u043A\u0440\u0435\u043F\u0438\u0442\u0435 \u0447\u0435\u043A \u0434\u043B\u044F \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438 \u0437\u0430\u044F\u0432\u043A\u0438');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '\u041E\u0442\u043F\u0440\u0430\u0432\u043A\u0430...';

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
          submitBtn.textContent = '\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0443';
          return;
        }

        if (timerInterval) clearInterval(timerInterval);

        modalOrderIdEl.textContent = currentOrder.seqId ? '#' + currentOrder.seqId : currentOrder.orderId;
        modalPayEl.textContent = currentOrder.payAmount.toFixed(2) + ' \u20BD';
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
        currentOrder = null;

      } catch (e) {
        showAlert('\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u0432\u0435\u0442\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430', { showSupport: true });
        submitBtn.disabled = false;
        submitBtn.textContent = '\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0443';
      }
    };
    xhr.onerror = function () {
      showAlert('\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0442\u0438. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435.', { showSupport: true });
      submitBtn.disabled = false;
      submitBtn.textContent = '\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0443';
    };
    xhr.send(fd);
  });

  /* ========== Modal ========== */

  function closeModal() {
    modalOverlay.classList.remove('active');
    showScreen('exchange');
  }

  modalCloseBtn.addEventListener('click', closeModal);

  modalOverlay.addEventListener('click', function (e) {
    if (e.target === modalOverlay) closeModal();
  });

  /* ========== Helpers ========== */

  var reasonMessages = {
    concurrent_request: '\u0417\u0430\u043F\u0440\u043E\u0441 \u0443\u0436\u0435 \u043E\u0431\u0440\u0430\u0431\u0430\u0442\u044B\u0432\u0430\u0435\u0442\u0441\u044F. \u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435.',
    active_order: '\u0423 \u0432\u0430\u0441 \u0443\u0436\u0435 \u0435\u0441\u0442\u044C \u0430\u043A\u0442\u0438\u0432\u043D\u0430\u044F \u0437\u0430\u044F\u0432\u043A\u0430. \u0414\u043E\u0436\u0434\u0438\u0442\u0435\u0441\u044C \u0435\u0451 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0438 \u0438\u043B\u0438 \u0438\u0441\u0442\u0435\u0447\u0435\u043D\u0438\u044F \u0441\u0440\u043E\u043A\u0430.',
    cooldown_active: '\u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435 \u043D\u0435\u043C\u043D\u043E\u0433\u043E \u043F\u0435\u0440\u0435\u0434 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0439 \u0437\u0430\u044F\u0432\u043A\u043E\u0439',
    no_free_cards: '\u0421\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0435 \u0440\u0435\u043A\u0432\u0438\u0437\u0438\u0442\u044B \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u044E\u0442, \u043F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435',
    daily_limit: '\u0414\u043D\u0435\u0432\u043D\u043E\u0439 \u043B\u0438\u043C\u0438\u0442 \u043F\u043E \u0441\u0443\u043C\u043C\u0435 \u0438\u0441\u0447\u0435\u0440\u043F\u0430\u043D. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435.',
    rate_10m: '\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u043C\u043D\u043E\u0433\u043E \u0437\u0430\u044F\u0432\u043E\u043A, \u043F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435',
    rate_24h: '\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u043C\u043D\u043E\u0433\u043E \u0437\u0430\u044F\u0432\u043E\u043A \u0437\u0430 \u0441\u0443\u0442\u043A\u0438',
    duplicate: '\u041F\u043E\u0445\u043E\u0436\u0430\u044F \u0437\u0430\u044F\u0432\u043A\u0430 \u0443\u0436\u0435 \u0431\u044B\u043B\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0430',
    too_fast: '\u0424\u043E\u0440\u043C\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0430 \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0431\u044B\u0441\u0442\u0440\u043E',
    validation: '\u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0432\u0432\u0435\u0434\u0451\u043D\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435'
  };

  function getErrorMessage(data) {
    if (data.reason && reasonMessages[data.reason]) {
      return reasonMessages[data.reason];
    }
    return data.error || '\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430';
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
      support.textContent = '\u041F\u043E\u0434\u0434\u0435\u0440\u0436\u043A\u0430: ' + CONFIG.supportUsername;
      toast.appendChild(support);
    }

    var closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.textContent = '\u00d7';
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
    showScreen('exchange');
  } else {
    showScreen('offer');
  }

})();
