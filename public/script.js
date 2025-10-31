// script.js — обновлён: исправлено поведение редактирования, сортировка по просроченным, экспорт в Excel (CSV -> .xlsx)

const API_BASE = '/api/abonements';
const THEME_KEY = 'theme';
let ADMIN_PASS = null;

const loginModal = document.getElementById('loginModal');
const loginBtn = document.getElementById('loginBtn');
const themeToggle = document.getElementById('themeToggle');
const importExportBtn = document.getElementById('importExportBtn');
const imexModal = document.getElementById('imexModal');
const imexClose = document.getElementById('imexClose');
const exportJsonBtn = document.getElementById('exportJsonBtn');
const importJsonBtn = document.getElementById('importJsonBtn');
const importFile = document.getElementById('importFile');
const closeImex = document.getElementById('closeImex');
const adminPassInput = document.getElementById('adminPass');
const loginError = document.getElementById('loginError');

loginBtn.addEventListener('click', async () => {
  const p = adminPassInput.value.trim();
  loginError.textContent = '';
  if (!p) { loginError.textContent = 'Введіть пароль'; return; }

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ password: p })
    });

    if (res.ok) {
      ADMIN_PASS = p;
      loginModal.classList.add('hidden');
      loadData();
    } else {
      loginError.textContent = 'Пароль невірний';
      adminPassInput.value = '';
      adminPassInput.focus();
    }
  } catch (e) {
    loginError.textContent = 'Помилка з\'єднання';
  }
});

// Theme management
function applyTheme(theme){
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('theme-dark');
    if (themeToggle) themeToggle.textContent = '☀️';
  } else {
    root.classList.remove('theme-dark');
    if (themeToggle) themeToggle.textContent = '🌙';
  }
}
function initTheme(){
  const saved = localStorage.getItem(THEME_KEY) || 'light';
  applyTheme(saved);
}
if (themeToggle){
  themeToggle.addEventListener('click', () => {
    const cur = localStorage.getItem(THEME_KEY) || 'light';
    const next = cur === 'light' ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
}
initTheme();

function headers() { return { 'Content-Type':'application/json', 'x-admin-pass': ADMIN_PASS }; }
function formatDateISO(d) { if (!d) return ''; const dt = new Date(d); return dt.toLocaleDateString('uk-UA'); }
function dayAddISO(d, days) { const dt = new Date(d); dt.setDate(dt.getDate() + days); return dt.toISOString(); }

const fioInput = document.getElementById('fio');
const typeSelect = document.getElementById('abon-type');
const trainingBox = document.getElementById('training-checkboxes');
const activateBtn = document.getElementById('activateBtn');
const tableBody = document.querySelector('#abonTable tbody');
const mobileCards = document.getElementById('mobileCards');
const noData = document.getElementById('noData');
const msg = document.getElementById('msg');
const searchInput = document.getElementById('search');
const sortNameBtn = null; // removed
const sortTypeBtn = null; // removed

// Import/Export modal wiring
if (importExportBtn && imexModal){
  importExportBtn.addEventListener('click', () => {
    imexModal.classList.remove('hidden');
  });
}
if (closeImex){ closeImex.addEventListener('click', () => imexModal.classList.add('hidden')); }
if (imexClose){ imexClose.addEventListener('click', () => imexModal.classList.add('hidden')); }
// tabs
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
tabButtons.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    tabButtons.forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.getAttribute('data-tab');
    tabPanels.forEach(p=>{
      if (p.getAttribute('data-panel') === tab) p.classList.remove('hidden');
      else p.classList.add('hidden');
    });
  });
});

if (exportJsonBtn){
  exportJsonBtn.addEventListener('click', async ()=>{
    if (!ADMIN_PASS) { alert('Необхідний вхід'); loginModal.classList.remove('hidden'); return; }
    try{
      const res = await fetch('/api/export/json', { headers: headers() });
      if (!res.ok) { alert('Помилка експорту'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth()+1).padStart(2,'0');
      const d = String(now.getDate()).padStart(2,'0');
      a.href = url; a.download = `memberships-export-${y}-${m}-${d}.json`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      showMessage('Експортовано JSON');
    }catch(e){ alert('Помилка експорту'); }
  });
}

if (importJsonBtn){
  importJsonBtn.addEventListener('click', async ()=>{
    if (!ADMIN_PASS) { alert('Необхідний вхід'); loginModal.classList.remove('hidden'); return; }
    if (!importFile || !importFile.files || !importFile.files[0]){ alert('Оберіть JSON файл'); return; }
    try{
      const text = await importFile.files[0].text();
      const payload = JSON.parse(text);
      const res = await fetch('/api/import/json', { method:'POST', headers: headers(), body: JSON.stringify({ data: payload }) });
      if (!res.ok){ alert('Помилка імпорту'); return; }
      const added = await res.json();
      showMessage(`Імпортовано: ${added.added || 0}`);
      imexModal.classList.add('hidden');
      loadData();
    }catch(e){ alert('Невірний JSON'); }
  });
}

let allData = [];
let toDeleteId = null;
let editingId = null;

trainingBox.style.display = 'none';

function calcEndDateByType(startISO, typeVal) {
  if (typeVal.startsWith('bezlim')) {
    const months = parseInt(typeVal.split('.')[1],10);
    const days = months === 1 ? 30 : months === 3 ? 90 : months === 6 ? 180 : 30;
    return dayAddISO(startISO, days);
  }
  if (typeVal.startsWith('9') || typeVal.startsWith('12')) {
    return dayAddISO(startISO, 30);
  }
  return dayAddISO(startISO, 30);
}
function typeToShort(typeVal){ return typeVal; }

async function loadData() {
  if (!ADMIN_PASS) return;
  try {
    const res = await fetch('/api/abonements', { headers: { 'x-admin-pass': ADMIN_PASS } });
    if (!res.ok) { alert('Не вдалось завантажити дані (401). Введіть пароль заново.'); loginModal.classList.remove('hidden'); return; }
    allData = await res.json();
    renderTable(allData);
  } catch (e) { alert('Помилка при завантаженні даних'); }
}

function isExpired(endISO) {
  if (!endISO) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  const end = new Date(endISO); end.setHours(0,0,0,0);
  return end < today;
}

function createMobileCard(item) {
  const card = document.createElement('div');
  card.className = 'mobile-card';
  card.dataset.id = item.id;

  if (isExpired(item.endDate)) card.classList.add('expired');

  const trainingsCount = (item.type && (item.type.startsWith('12') ? 12 : (item.type.startsWith('9') ? 9 : 0)));

  card.innerHTML = `
    <div class="mobile-card-header">
      <div class="mobile-card-title">${item.fio}</div>
      <div class="mobile-card-number">${item.memberNumber || `M${String(allData.indexOf(item) + 1).padStart(3, '0')}`}</div>
    </div>
    
    <div class="mobile-card-row">
      <span class="mobile-card-label">Тип:</span>
      <span class="mobile-card-value">${item.typeShort || item.type}</span>
    </div>
    
    <div class="mobile-card-row">
      <span class="mobile-card-label">Початок:</span>
      <span class="mobile-card-value">${formatDateISO(item.startDate)}</span>
    </div>
    
    <div class="mobile-card-row">
      <span class="mobile-card-label">Кінець:</span>
      <span class="mobile-card-value">${formatDateISO(item.endDate)}</span>
    </div>
    
    ${trainingsCount > 0 ? `
      <div class="mobile-card-row">
        <span class="mobile-card-label">Відмітки:</span>
        <div class="mobile-card-attendance"></div>
      </div>
    ` : ''}
    
    <div class="mobile-card-row">
      <span class="mobile-card-label">В борг:</span>
      <div class="mobile-card-debt">
        <input type="checkbox" class="debt-checkbox" ${item.debt ? 'checked' : ''}>
      </div>
    </div>
    
    <div class="mobile-card-actions">
      <button class="btn small" title="Редагувати">✏️</button>
      <button class="btn small ghost" title="Видалити">🗑</button>
    </div>
  `;

  // Add event listeners
  const debtCheckbox = card.querySelector('.debt-checkbox');
  debtCheckbox.addEventListener('change', async () => {
    item.debt = debtCheckbox.checked;
    await updateItemOnServer(item.id, { debt: item.debt });
    showMessage('Стан боргу оновлено');
  });

  const editBtn = card.querySelector('.btn.small');
  editBtn.addEventListener('click', () => openEditModal(item));

  const delBtn = card.querySelector('.btn.small.ghost');
  delBtn.addEventListener('click', () => confirmDelete(item.id));

  // Add attendance checkboxes if needed
  if (trainingsCount > 0) {
    const attendanceContainer = card.querySelector('.mobile-card-attendance');
    item.attended = item.attended || Array(trainingsCount).fill(false);
    
    for (let i = 0; i < trainingsCount; i++) {
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = !!item.attended[i];
      chk.addEventListener('change', async () => {
        item.attended[i] = chk.checked;
        await updateItemOnServer(item.id, { attended: item.attended });
        showMessage('Відмітка збережена');
      });
      attendanceContainer.appendChild(chk);
    }
  }

  return card;
}

function renderTable(data) {
  tableBody.innerHTML = '';
  if (mobileCards) mobileCards.innerHTML = '';
  
  if (!data || data.length === 0) { 
    noData.style.display = 'block'; 
    return; 
  }
  else noData.style.display = 'none';

  data.forEach(item => {
    const tr = document.createElement('tr');
    tr.dataset.id = item.id;

    if (isExpired(item.endDate)) tr.classList.add('expired');

    // Member number (editable)
    const tdNumber = document.createElement('td');
    const numberInput = document.createElement('input');
    numberInput.type = 'text';
    numberInput.className = 'member-number';
    numberInput.value = item.memberNumber || `M${String(allData.indexOf(item) + 1).padStart(3, '0')}`;
    numberInput.addEventListener('blur', async () => {
      const newNumber = numberInput.value.trim();
      if (newNumber && newNumber !== item.memberNumber) {
        item.memberNumber = newNumber;
        await updateItemOnServer(item.id, { memberNumber: newNumber });
        showMessage('Номер оновлено');
      }
    });
    numberInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        numberInput.blur();
      }
    });
    tdNumber.appendChild(numberInput);

    const tdFio = document.createElement('td'); tdFio.textContent = item.fio;
    const tdType = document.createElement('td'); tdType.textContent = item.typeShort || item.type;
    const tdStart = document.createElement('td'); tdStart.textContent = formatDateISO(item.startDate);

    const tdTrain = document.createElement('td');
    const trainingsCount = (item.type && (item.type.startsWith('12') ? 12 : (item.type.startsWith('9') ? 9 : 0)));
    if (trainingsCount > 0) {
      const grid = document.createElement('div');
      grid.className = 'att-grid';
      if (trainingsCount === 12) grid.classList.add('cols-4');
      else if (trainingsCount === 9) grid.classList.add('cols-3');
      item.attended = item.attended || Array(trainingsCount).fill(false);
      for (let i=0;i<trainingsCount;i++){
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = !!item.attended[i];
        chk.addEventListener('change', async () => {
          item.attended[i] = chk.checked;
          await updateItemOnServer(item.id, { attended: item.attended });
          showMessage('Відмітка збережена');
        });
        grid.appendChild(chk);
      }
      tdTrain.appendChild(grid);
    } else tdTrain.textContent = '-';

    const tdEnd = document.createElement('td'); tdEnd.textContent = formatDateISO(item.endDate);
    const tdDebt = document.createElement('td'); const debtChk = document.createElement('input'); debtChk.type='checkbox'; debtChk.className='debt-checkbox'; debtChk.checked = !!item.debt;
    debtChk.addEventListener('change', async () => { item.debt = debtChk.checked; await updateItemOnServer(item.id, { debt: item.debt }); showMessage('Стан боргу оновлено'); });
    tdDebt.appendChild(debtChk);

    const tdActions = document.createElement('td');
    const actionsWrap = document.createElement('div'); actionsWrap.className='actions';
    const editBtn = document.createElement('button'); editBtn.className='btn small'; editBtn.textContent='✏️'; editBtn.title='Редагувати';
    editBtn.addEventListener('click', () => startEditRow(item, tr));
    const delBtn = document.createElement('button'); delBtn.className='btn small ghost'; delBtn.innerHTML='🗑'; delBtn.title = 'Видалити';
    delBtn.addEventListener('click', () => confirmDelete(item.id));
    actionsWrap.appendChild(editBtn); actionsWrap.appendChild(delBtn);
    tdActions.appendChild(actionsWrap);

    tr.appendChild(tdNumber); tr.appendChild(tdFio); tr.appendChild(tdType); tr.appendChild(tdStart); tr.appendChild(tdTrain); tr.appendChild(tdEnd); tr.appendChild(tdDebt); tr.appendChild(tdActions);
    tableBody.appendChild(tr);
    
    // Also create mobile card
    if (mobileCards) {
      const mobileCard = createMobileCard(item);
      mobileCards.appendChild(mobileCard);
    }
  });
  
  // Manage scroll hint after rendering (for desktop)
  setTimeout(manageScrollHint, 100);
  
  // Re-initialize mobile enhancements for new table rows
  setTimeout(() => {
    const newTableRows = document.querySelectorAll('tbody tr');
    newTableRows.forEach(row => {
      // Remove existing listeners to avoid duplicates
      row.removeEventListener('touchstart', row._touchStartHandler);
      row.removeEventListener('touchend', row._touchEndHandler);
      
      // Add new listeners
      row._touchStartHandler = () => {
        row.style.backgroundColor = 'rgba(201, 158, 58, 0.1)';
      };
      row._touchEndHandler = () => {
        setTimeout(() => {
          row.style.backgroundColor = '';
        }, 200);
      };
      
      row.addEventListener('touchstart', row._touchStartHandler);
      row.addEventListener('touchend', row._touchEndHandler);
    });
  }, 100);
}

// create
activateBtn.addEventListener('click', async () => {
  if (!ADMIN_PASS) { alert('Необхідний вхід'); loginModal.classList.remove('hidden'); return; }
  const fio = fioInput.value.trim();
  if (!fio) { showMessage('Введіть ПІБ'); return; }
  const type = typeSelect.value;
  const startISO = new Date().toISOString();
  const endISO = calcEndDateByType(startISO, type);
  const attendedCount = type.startsWith('12') ? 12 : type.startsWith('9') ? 9 : 0;
  const attended = attendedCount ? Array(attendedCount).fill(false) : [];
  const memberNumber = `M${String(allData.length + 1).padStart(3, '0')}`;
  const item = { fio, type, typeShort: typeToShort(type), memberNumber, daysChoice: null, startDate: startISO, endDate: endISO, attended, debt:false };

  try {
    const res = await fetch('/api/abonements', { method:'POST', headers: headers(), body: JSON.stringify(item) });
    if (!res.ok) { showMessage('Помилка збереження (401)'); return; }
    const created = await res.json();
    allData.unshift(created);
    renderTable(allData);
    fioInput.value = '';
    showMessage('Абонемент створено');
  } catch (e) { showMessage('Помилка при збереженні'); }
});

async function updateItemOnServer(id, patch) {
  const res = await fetch(`/api/abonements/${id}`, { method:'PUT', headers: headers(), body: JSON.stringify(patch) });
  if (!res.ok) { showMessage('Помилка оновлення (401)'); return null; }
  return await res.json();
}

// delete
const confirmModal = document.getElementById('confirmModal');
document.getElementById('confirmYes').addEventListener('click', async () => {
  if (!toDeleteId) return;
  const res = await fetch(`/api/abonements/${toDeleteId}`, { method: 'DELETE', headers: headers() });
  if (res.ok) {
    allData = allData.filter(x => x.id !== toDeleteId);
    renderTable(allData);
    showMessage('Абонемент видалено');
  } else showMessage('Помилка видалення');
  toDeleteId = null; confirmModal.classList.add('hidden');
});
document.getElementById('confirmNo').addEventListener('click', () => { toDeleteId = null; confirmModal.classList.add('hidden'); });
function confirmDelete(id) { toDeleteId = id; confirmModal.classList.remove('hidden'); }

// edit via modal
const editModal = document.getElementById('editModal');
const editClose = document.getElementById('editClose');
const editFio = document.getElementById('editFio');
const editType = document.getElementById('editType');
const editStart = document.getElementById('editStart');
const editEnd = document.getElementById('editEnd');
const editDebt = document.getElementById('editDebt');
const editSave = document.getElementById('editSave');
const editCancel = document.getElementById('editCancel');
let editItemId = null;
const textarea = document.getElementById('notes');

// Load saved notes on page load
if (textarea) {
  const savedNotes = localStorage.getItem('notes');
  if (savedNotes) {
    textarea.value = savedNotes;
  }
  
  // Auto-resize textarea
  textarea.addEventListener('input', function() {
    this.style.height = 'auto';          // сбрасываем высоту
    this.style.height = this.scrollHeight + 'px'; // устанавливаем высоту по содержимому
    
    // Save notes to localStorage
    localStorage.setItem('notes', this.value);
  });
}

function openEditModal(item){
  editItemId = item.id;
  editFio.value = item.fio || '';
  editType.value = item.type || '12U';
  editStart.value = new Date(item.startDate).toISOString().slice(0,10);
  editEnd.value = new Date(item.endDate).toISOString().slice(0,10);
  editDebt.checked = !!item.debt;
  editModal.classList.remove('hidden');
}
if (editCancel){ editCancel.addEventListener('click', ()=> { editItemId = null; editModal.classList.add('hidden'); }); }
if (editClose){ editClose.addEventListener('click', ()=> { editItemId = null; editModal.classList.add('hidden'); }); }
if (editSave){
  editSave.addEventListener('click', async ()=>{
    if (!editItemId) return;
    const patch = {
      fio: editFio.value.trim(),
      type: editType.value,
      typeShort: editType.value,
      startDate: new Date(editStart.value).toISOString(),
      endDate: new Date(editEnd.value).toISOString(),
      debt: editDebt.checked
    };
    const updated = await updateItemOnServer(editItemId, patch);
    if (updated){ showMessage('Збережено'); editItemId = null; editModal.classList.add('hidden'); loadData(); }
  });
}
async function startEditRow(item, tr){
  openEditModal(item);
}

// поиск
searchInput.addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  const filtered = allData.filter(it => it.fio.toLowerCase().includes(q));
  renderTable(filtered);
});

// Header sorting
let sortState = { key: null, dir: 'asc' };
function setSortIndicator(){
  const ths = document.querySelectorAll('thead th[data-sort]');
  ths.forEach(th => {
    const span = th.querySelector('.sort-ind');
    if (!span) return;
    const key = th.getAttribute('data-sort');
    if (sortState.key === key){
      span.textContent = sortState.dir === 'asc' ? '▲' : '▼';
    } else span.textContent = '';
  });
}
function attachHeaderSorting(){
  const ths = document.querySelectorAll('thead th[data-sort]');
  ths.forEach(th => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort');
      if (sortState.key === key){
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      } else { sortState.key = key; sortState.dir = 'asc'; }
      const sorted = [...allData].sort((a,b)=> compareForSort(a,b,key,sortState.dir));
      setSortIndicator();
      renderTable(sorted);
    });
  });
}
function compareForSort(a,b,key,dir){
  let va, vb;
  if (key === 'attended'){
    va = (a.attended||[]).filter(Boolean).length;
    vb = (b.attended||[]).filter(Boolean).length;
  } else if (key === 'startDate' || key === 'endDate'){
    va = new Date(a[key]||0).getTime();
    vb = new Date(b[key]||0).getTime();
  } else if (key === 'debt'){
    va = a.debt ? 1 : 0; vb = b.debt ? 1 : 0;
  } else if (key === 'memberNumber'){
    // Sort member numbers numerically if they start with M followed by digits
    const aNum = a.memberNumber ? parseInt(a.memberNumber.replace(/^M/, '')) : 0;
    const bNum = b.memberNumber ? parseInt(b.memberNumber.replace(/^M/, '')) : 0;
    va = isNaN(aNum) ? a.memberNumber || '' : aNum;
    vb = isNaN(bNum) ? b.memberNumber || '' : bNum;
  } else {
    va = (a[key]||'').toString().toLowerCase();
    vb = (b[key]||'').toString().toLowerCase();
  }
  const res = va > vb ? 1 : va < vb ? -1 : 0;
  return dir === 'asc' ? res : -res;
}
attachHeaderSorting();

// removed old CSV export (use JSON modal)

function showMessage(t, tms=3000){ msg.textContent = t; setTimeout(()=> msg.textContent='', tms); }

// Mobile scroll hint management (disabled since we use cards now)
function manageScrollHint() {
  // Scroll hint is no longer needed since we use mobile cards
  return;
}

// Initialize scroll hint management
window.addEventListener('resize', manageScrollHint);
window.addEventListener('load', manageScrollHint);

// Mobile-specific improvements
function initMobileEnhancements() {
  // Prevent zoom on double tap for buttons and inputs
  let lastTouchEnd = 0;
  document.addEventListener('touchend', function (event) {
    const now = (new Date()).getTime();
    if (now - lastTouchEnd <= 300) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, false);

  // Improve form input experience on mobile
  const inputs = document.querySelectorAll('input, select, textarea');
  inputs.forEach(input => {
    // Prevent zoom on focus for iOS
    if (input.type !== 'range') {
      input.addEventListener('focus', () => {
        input.style.fontSize = '16px';
      });
    }
    
    // Add haptic feedback for touch devices
    input.addEventListener('touchstart', () => {
      if (navigator.vibrate) {
        navigator.vibrate(10);
      }
    });
  });

  // Improve button touch feedback
  const buttons = document.querySelectorAll('.btn');
  buttons.forEach(btn => {
    btn.addEventListener('touchstart', () => {
      btn.style.transform = 'scale(0.95)';
    });
    
    btn.addEventListener('touchend', () => {
      setTimeout(() => {
        btn.style.transform = '';
      }, 150);
    });
  });

  // Improve table row touch experience
  const tableRows = document.querySelectorAll('tbody tr');
  tableRows.forEach(row => {
    row.addEventListener('touchstart', () => {
      row.style.backgroundColor = 'rgba(201, 158, 58, 0.1)';
    });
    
    row.addEventListener('touchend', () => {
      setTimeout(() => {
        row.style.backgroundColor = '';
      }, 200);
    });
  });
}

// Initialize mobile enhancements when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMobileEnhancements);
} else {
  initMobileEnhancements();
}
