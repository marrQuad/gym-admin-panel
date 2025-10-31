// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5050;
const DATA_FILE = path.join(__dirname, 'abon.json');
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin'; // змініть через env для безпеки

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ensure data file
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2), 'utf8');

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '[]');
  } catch (e) {
    return [];
  }
}
function writeData(d) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2), 'utf8');
}

// auth middleware: requires header 'x-admin-pass' equals ADMIN_PASS
function requireAuth(req, res, next) {
  const pass = req.headers['x-admin-pass'];
  if (!pass || pass !== ADMIN_PASS) {
    return res.status(401).json({ error: 'Unauthorized. Provide correct x-admin-pass header.' });
  }
  next();
}

// login route (front-end може дзвонити, щоб перевірити пароль)
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password && password === ADMIN_PASS) return res.json({ ok: true });
  return res.status(401).json({ ok: false });
});

// All API routes below require auth (read/write/delete)
app.get('/api/abonements', requireAuth, (req, res) => {
  res.json(readData());
});

app.post('/api/abonements', requireAuth, (req, res) => {
  const data = readData();
  const id = Date.now().toString(36) + Math.floor(Math.random()*1000).toString(36);
  const item = Object.assign({ id }, req.body);
  data.unshift(item);
  writeData(data);
  res.json(item);
});

app.put('/api/abonements/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  let data = readData();
  let idx = data.findIndex(d => d.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  data[idx] = Object.assign({}, data[idx], req.body);
  writeData(data);
  res.json(data[idx]);
});

app.delete('/api/abonements/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  let data = readData();
  const before = data.length;
  data = data.filter(x => x.id !== id);
  writeData(data);
  res.json({ deleted: before - data.length });
});

app.get('/api/export/txt', requireAuth, (req, res) => {
  const data = readData();
  const lines = data.map(d => `${d.fio} | ${d.startDate} | ${d.endDate} | ${d.typeShort} | debt:${d.debt ? '1':'0'}`);
  const text = lines.join('\n');
  res.setHeader('Content-disposition', 'attachment; filename=abon.txt');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(text);
});

// Export JSON
app.get('/api/export/json', requireAuth, (req, res) => {
  const data = readData();
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth()+1).padStart(2,'0');
  const d = String(now.getDate()).padStart(2,'0');
  res.setHeader('Content-disposition', `attachment; filename=memberships-export-${y}-${m}-${d}.json`);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(data, null, 2));
});

// Import JSON (merge new by id or push new ones if id not exists)
app.post('/api/import/json', requireAuth, (req, res) => {
  const body = req.body || {};
  const incoming = Array.isArray(body.data) ? body.data : [];
  if (!incoming.length) return res.status(400).json({ error: 'No data' });
  const data = readData();
  const existingIds = new Set(data.map(i => i.id));
  let added = 0;
  for (const item of incoming){
    if (!item || typeof item !== 'object') continue;
    if (item.id && existingIds.has(item.id)) {
      // merge update by id
      const idx = data.findIndex(i => i.id === item.id);
      data[idx] = Object.assign({}, data[idx], item);
    } else {
      const id = item.id || (Date.now().toString(36) + Math.floor(Math.random()*1000).toString(36));
      data.unshift(Object.assign({ id }, item));
      existingIds.add(id);
      added++;
    }
  }
  writeData(data);
  res.json({ ok:true, added });
});

app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
