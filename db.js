const fs = require('fs');
const path = require('path');

// Erkennt automatisch, ob die App auf Vercel läuft (Read-Only-Filesystem)
const isVercel = process.env.VERCEL || process.env.NOW_REGION || __dirname.startsWith('/var/task');

const DB_FILE = isVercel ? path.join('/tmp', 'db.json') : path.join(__dirname, 'db.json');

function init() {
  if (!fs.existsSync(DB_FILE)) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2), 'utf-8');
    } catch (err) {
      console.error('Error writing initial database file:', err);
    }
  }
}

function getAll() {
  init();
  try {
    if (!fs.existsSync(DB_FILE)) {
      return [];
    }
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading database:', error);
    return [];
  }
}

function getById(id) {
  const records = getAll();
  return records.find(r => r.id === id) || null;
}

function getByPaymentToken(token) {
  const records = getAll();
  return records.find(r => r.paymentToken === token) || null;
}

function create(record) {
  const records = getAll();
  const newRecord = {
    id: 'analysis_' + Math.random().toString(36).substr(2, 9),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'Neu',
    paymentStatus: 'unpaid',
    ...record
  };
  records.push(newRecord);
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(records, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing database in create():', err);
  }
  return newRecord;
}

// ... restliche CRUD-Funktionen bleiben wie gehabt
