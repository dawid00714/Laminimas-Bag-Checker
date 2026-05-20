const fs = require('fs');
const path = require('path');

// Determine if we are running on Vercel or a read-only environment
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

function update(id, updates) {
  const records = getAll();
  const index = records.findIndex(r => r.id === id);
  if (index === -1) return null;

  const updatedRecord = {
    ...records[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };
  records[index] = updatedRecord;
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(records, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing database in update():', err);
  }
  return updatedRecord;
}

function remove(id) {
  const records = getAll();
  const filtered = records.filter(r => r.id !== id);
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(filtered, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing database in remove():', err);
  }
  return true;
}

// Clean up old analyses based on a schedule (GDPR delete function)
function autoDeleteOldRecords(days = 30) {
  const records = getAll();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const filtered = [];
  const removed = [];

  for (const r of records) {
    const recordDate = new Date(r.createdAt);
    if (recordDate < cutoff) {
      removed.push(r);
      // Delete images associated
      if (r.images) {
        for (const key in r.images) {
          const imgPath = r.images[key];
          if (imgPath && typeof imgPath === 'string' && imgPath.startsWith('/uploads/')) {
            const fullPath = path.join(isVercel ? '/tmp' : __dirname, imgPath);
            if (fs.existsSync(fullPath)) {
              try {
                fs.unlinkSync(fullPath);
              } catch (e) {
                console.error('Error deleting image file:', fullPath, e);
              }
            }
          }
        }
      }
    } else {
      filtered.push(r);
    }
  }

  if (removed.length > 0) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(filtered, null, 2), 'utf-8');
      console.log(`GDPR Cleanup: Deleted ${removed.length} records older than ${days} days.`);
    } catch (err) {
      console.error('Error writing database in autoDeleteOldRecords():', err);
    }
  }
  return removed.length;
}

module.exports = {
  getAll,
  getById,
  getByPaymentToken,
  create,
  update,
  remove,
  autoDeleteOldRecords
};
