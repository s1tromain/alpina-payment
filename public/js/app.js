(() => {
  const form             = document.getElementById('paymentForm');
  const submitBtn        = document.getElementById('submitBtn');
  const fileInput        = document.getElementById('fileInput');
  const uploadZone       = document.getElementById('uploadZone');
  const filePreview      = document.getElementById('filePreview');
  const previewImg       = document.getElementById('previewImg');
  const fileNameEl       = document.getElementById('fileName');
  const removeFileBtn    = document.getElementById('removeFile');
  const modalOverlay     = document.getElementById('modalOverlay');
  const modalCloseBtn    = document.getElementById('modalCloseBtn');
  const modalOrderId     = document.getElementById('modalOrderId');
  const modalPassword    = document.getElementById('modalPassword');
  const modalAmount      = document.getElementById('modalAmount');
  const modalCurrency    = document.getElementById('modalCurrency');
  const currencyDropdown = document.getElementById('currencyDropdown');
  const currencySelected = document.getElementById('currencySelected');
  const currencyMenu     = document.getElementById('currencyMenu');
  const currencyInput    = document.getElementById('currency');
  const amountInput      = document.getElementById('amount');

  const pageLoadTime = Date.now();
  let cooldownUntil = 0;
  let selectedSymbol = '\u20bd';

  currencySelected.addEventListener('click', () => {
    currencyDropdown.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!currencyDropdown.contains(e.target)) {
      currencyDropdown.classList.remove('open');
    }
  });

  currencyMenu.addEventListener('click', (e) => {
    const opt = e.target.closest('.cur-option');
    if (!opt) return;

    currencyMenu.querySelectorAll('.cur-option').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');

    const code   = opt.dataset.currency;
    const symbol = opt.dataset.symbol;
    const name   = opt.dataset.name;
    const flag   = opt.querySelector('.opt-flag').textContent;

    selectedSymbol = symbol;
    currencyInput.value = code;

    currencySelected.querySelector('.sel-flag').textContent = flag;
    currencySelected.querySelector('.sel-text').textContent = code;
    const nameSpan = document.createElement('span');
    nameSpan.className = 'sel-name';
    nameSpan.textContent = '\u2014 ' + name;
    currencySelected.querySelector('.sel-text').appendChild(nameSpan);

    amountInput.placeholder = '\u041d\u0430\u043f\u0440\u0438\u043c\u0435\u0440: 1500';
    currencyDropdown.classList.remove('open');
    currencyDropdown.closest('.field').classList.remove('error');
  });

  const MAX_FILE_SIZE = 4.5 * 1024 * 1024;

  function handleFile(file) {
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      alert('\u0414\u043e\u043f\u0443\u0441\u0442\u0438\u043c\u044b\u0435 \u0444\u043e\u0440\u043c\u0430\u0442\u044b: JPG, PNG');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      alert('\u0424\u0430\u0439\u043b \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0431\u043e\u043b\u044c\u0448\u043e\u0439. \u041c\u0430\u043a\u0441\u0438\u043c\u0443\u043c 4.5 \u041c\u0411.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      previewImg.src = e.target.result;
      fileNameEl.textContent = file.name;
      filePreview.classList.add('active');
    };
    reader.readAsDataURL(file);
  }

  fileInput.addEventListener('change', () => {
    handleFile(fileInput.files[0]);
    uploadZone.style.borderColor = '';
    uploadZone.style.boxShadow = '';
  });

  removeFileBtn.addEventListener('click', () => {
    fileInput.value = '';
    previewImg.src = '';
    fileNameEl.textContent = '';
    filePreview.classList.remove('active');
  });

  ['dragenter', 'dragover'].forEach(evt =>
    uploadZone.addEventListener(evt, (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); })
  );
  ['dragleave', 'drop'].forEach(evt =>
    uploadZone.addEventListener(evt, () => uploadZone.classList.remove('dragover'))
  );
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });

  function validateForm() {
    let valid = true;
    form.querySelectorAll('.field[data-required]').forEach(field => {
      const input = field.querySelector('input, textarea, input[type="hidden"]');
      if (!input.value.trim()) {
        field.classList.add('error');
        valid = false;
      } else {
        field.classList.remove('error');
      }
    });
    return valid;
  }

  form.querySelectorAll('input, textarea').forEach(input => {
    input.addEventListener('input', () => {
      input.closest('.field').classList.remove('error');
    });
  });

  amountInput.addEventListener('input', () => {
    amountInput.value = amountInput.value.replace(/[^0-9]/g, '');
  });

  submitBtn.addEventListener('click', async () => {
    const now = Date.now();
    if (now < cooldownUntil) {
      const secs = Math.ceil((cooldownUntil - now) / 1000);
      alert('\u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435 ' + secs + ' \u0441\u0435\u043A\u0443\u043D\u0434 \u043F\u0435\u0440\u0435\u0434 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0439 \u0437\u0430\u044F\u0432\u043A\u043E\u0439.');
      return;
    }

    if (!validateForm()) return;

    if (!fileInput.files.length) {
      uploadZone.style.borderColor = '#ff4444';
      uploadZone.style.boxShadow = '0 0 0 2px rgba(255,68,68,.25)';
      alert('\u041f\u0440\u0438\u043a\u0440\u0435\u043f\u0438\u0442\u0435 \u0447\u0435\u043a \u0434\u043b\u044f \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0438 \u0437\u0430\u044f\u0432\u043a\u0438');
      return;
    }

    const amount   = amountInput.value.trim();
    const currency = currencyInput.value;
    const comment  = document.getElementById('comment').value.trim();

    const hpField = document.getElementById('_hp');

    const fd = new FormData();
    fd.append('currency', currency);
    fd.append('amount', amount);
    if (comment) fd.append('comment', comment);
    fd.append('receipt', fileInput.files[0]);
    fd.append('_t', String(Date.now() - pageLoadTime));
    if (hpField) fd.append('_hp', hpField.value);

    submitBtn.disabled = true;
    submitBtn.textContent = '\u041e\u0442\u043f\u0440\u0430\u0432\u043a\u0430...';

    try {
      const resp = await fetch('/api/submit', { method: 'POST', body: fd });
      const data = await resp.json();

      if (!data.ok) {
        alert(data.error || '\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0438. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437.');
        submitBtn.disabled = false;
        submitBtn.textContent = '\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0437\u0430\u044f\u0432\u043a\u0443';
        return;
      }

      cooldownUntil = Date.now() + 60000;
      startCooldownTimer();

      modalOrderId.textContent  = data.orderId;
      modalPassword.textContent = data.password;
      modalAmount.textContent   = amount + ' ' + selectedSymbol;
      modalCurrency.textContent = currency + ' \u2014 ' + selectedSymbol;

      const svg   = document.querySelector('.modal-check svg');
      const clone = svg.cloneNode(true);
      svg.parentNode.replaceChild(clone, svg);

      modalOverlay.classList.add('active');
    } catch {
      alert('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u0437\u0430\u044f\u0432\u043a\u0443. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435.');
      submitBtn.disabled = false;
      submitBtn.textContent = '\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0437\u0430\u044f\u0432\u043a\u0443';
    }
  });

  function startCooldownTimer() {
    const tick = () => {
      const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        submitBtn.disabled = false;
        submitBtn.textContent = '\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0437\u0430\u044f\u0432\u043a\u0443';
        return;
      }
      submitBtn.textContent = '\u041f\u043e\u0434\u043e\u0436\u0434\u0438\u0442\u0435 (' + remaining + '\u0441)';
      setTimeout(tick, 1000);
    };
    tick();
  }

  function closeModal() {
    modalOverlay.classList.remove('active');
  }

  modalCloseBtn.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
})();
