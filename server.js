const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const db = require('./db');
const ai = require('./ai');

// Load environment variables (fallback to default values if not defined)
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'laminimas2026';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const PRICE_EUR = process.env.PRICE_EUR || '14.90';

// Determine if we are running on Vercel
const isVercel = process.env.VERCEL || process.env.NOW_REGION || __dirname.startsWith('/var/task');

// Ensure uploads folder exists
const UPLOADS_BASE = isVercel ? '/tmp' : __dirname;
const UPLOADS_DIR = path.join(UPLOADS_BASE, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  try {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  } catch (err) {
    console.error('Error creating uploads directory:', err);
  }
}

// Initialize the database
db.getAll(); // creates db.json if not present

// MIME types lookup
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon'
};

// Helper to send JSON responses
function sendJSON(res, data, statusCode = 200) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Helper to parse POST request JSON body
function getBodyJSON(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        if (!body) {
          resolve({});
          return;
        }
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', (err) => reject(err));
  });
}

// Main Request Handler
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  console.log(`[${new Date().toISOString()}] ${method} ${pathname}`);

  // ----------------------------------------------------\n  // API ENDPOINTS\n  // ----------------------------------------------------

  // 1. Create Payment (Simulated or Stripe Checkout)
  if (pathname === '/api/create-payment' && method === 'POST') {
    try {
      const body = await getBodyJSON(req);
      const { email, brand, model } = body;

      if (!email) {
        return sendJSON(res, { error: 'Email ist erforderlich.' }, 400);
      }

      const token = 'pay_' + crypto.randomBytes(16).toString('hex');
      
      // Store in DB
      const newRecord = db.create({
        email,
        brand: brand || 'Unbekannt',
        model: model || '',
        paymentStatus: 'unpaid',
        paymentToken: token,
        status: 'Neu'
      });

      // If Stripe is configured, we can create a real Stripe Checkout Session
      let stripeUrl = null;
      if (STRIPE_SECRET_KEY && STRIPE_SECRET_KEY !== 'placeholder_key') {
        try {
          // Stripe checkout logic can be integrated here for production
        } catch (e) {
          console.error('Stripe error:', e);
        }
      }

      const paymentUrl = `/payment.html?token=${token}`;
      return sendJSON(res, {\n        success: true,
        token: token,
        paymentUrl: paymentUrl,
        price: PRICE_EUR
      });
    } catch (err) {
      console.error(err);
      return sendJSON(res, { error: 'Fehler beim Erstellen der Zahlung.' }, 500);
    }
  }

  // 2. Confirm Payment (Simulate checkout success)
  if (pathname === '/api/confirm-payment' && method === 'POST') {
    try {
      const body = await getBodyJSON(req);
      const { token } = body;

      if (!token) {
        return sendJSON(res, { error: 'Token fehlt.' }, 400);
      }

      const record = db.getByPaymentToken(token);
      if (!record) {
        return sendJSON(res, { error: 'Zahlungstoken ungültig.' }, 404);
      }

      // Update status
      db.update(record.id, {
        paymentStatus: 'paid',
        status: 'Zahlung erhalten'
      });

      return sendJSON(res, { success: true, redirectUrl: `/upload.html?token=${token}` });
    } catch (err) {
      console.error(err);
      return sendJSON(res, { error: 'Fehler beim Bestätigen der Zahlung.' }, 500);
    }
  }

  // 3. Verify Payment Token
  if (pathname === '/api/verify-token' && method === 'GET') {
    const token = parsedUrl.query.token;
    if (!token) {
      return sendJSON(res, { error: 'Token fehlt.' }, 400);
    }

    const record = db.getByPaymentToken(token);
    if (!record) {
      return sendJSON(res, { valid: false, error: 'Ungültiges Token.' });
    }

    if (record.paymentStatus !== 'paid') {
      return sendJSON(res, { valid: false, error: 'Zahlung noch nicht abgeschlossen.', paymentUrl: `/payment.html?token=${token}` });
    }

    // Checked okay
    return sendJSON(res, {
      valid: true,
      email: record.email,
      brand: record.brand,
      model: record.model,
      id: record.id
    });
  }

  // 4. Upload Photos and Start Analysis
  if (pathname === '/api/upload-analysis' && method === 'POST') {
    try {
      const body = await getBodyJSON(req);
      const { token, brand, model, email, source, year, condition, documents, images } = body;

      if (!token) {
        return sendJSON(res, { error: 'Token fehlt.' }, 400);
      }

      const record = db.getByPaymentToken(token);
      if (!record) {
        return sendJSON(res, { error: 'Ungültiges Token.' }, 404);
      }

      if (record.paymentStatus !== 'paid') {
        return sendJSON(res, { error: 'Zahlung wurde nicht abgeschlossen.' }, 403);
      }

      // Validate inputs
      if (!brand || !email) {
        return sendJSON(res, { error: 'Marke und E-Mail-Adresse sind Pflichtfelder.' }, 400);
      }

      // Base64 Images processing
      const savedImages = {};

      if (images && typeof images === 'object') {
        for (const imgKey in images) {
          const base64Data = images[imgKey];
          if (base64Data && base64Data.startsWith('data:image/')) {
            const matches = base64Data.match(/^data:image\\/([a-zA-Z+]+);base64,(.+)$/) || base64Data.match(/^data:image\\/jpeg;base64,(.+)$/) || base64Data.match(/^data:image\\/png;base64,(.+)$/) || base64Data.match(/^data:image\\/webp;base64,(.+)$/);
            
            // Safe fallback matcher
            let ext = 'jpg';
            let base64Payload = '';
            
            if (matches) {
              if (matches.length === 3) {
                ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
                base64Payload = matches[2];
              } else if (matches.length === 2) {
                base64Payload = matches[1];
              }
            } else {
              // Manual extraction if match fails
              const parts = base64Data.split(';base64,');
              if (parts.length === 2) {
                base64Payload = parts[1];
                const typePart = parts[0].split('image/');
                if (typePart.length === 2) {
                  ext = typePart[1] === 'jpeg' ? 'jpg' : typePart[1];
                }
              }
            }

            if (base64Payload) {
              const buffer = Buffer.from(base64Payload, 'base64');
              if (buffer.length > 10 * 1024 * 1024) {
                return sendJSON(res, { error: `Bild \"${imgKey}\" überschreitet die 10MB Grenze.` }, 400);
              }

              const filename = `${record.id}_${imgKey}_${Date.now()}.${ext}`;
              const relativePath = `/uploads/${filename}`;
              const fullPath = path.join(isVercel ? '/tmp' : __dirname, relativePath);

              fs.writeFileSync(fullPath, buffer);
              savedImages[imgKey] = relativePath;
            }
          }
        }
      }

      // Update database record with metadata & images and mark status \"In Prüfung\"
      db.update(record.id, {
        brand,
        model,
        email,
        status: 'In Prüfung',
        images: savedImages,
        metadata: {
          source: source || '',
          year: year || '',
          condition: condition || '',
          documents: documents || ''
        }
      });

      // Call AI Image analysis asynchronously
      ai.analyzeImages(brand, model, savedImages, { source, year, condition, documents })
        .then(aiResult => {
          let status = 'Abgeschlossen';
          if (aiResult.result === 'unklar') {
            status = 'Manuelle Prüfung nötig';
          }

          db.update(record.id, {
            status: status,
            result: aiResult
          });
          console.log(`Analysis completed for ${record.id}: Result = ${aiResult.result}`);
        })
        .catch(err => {
          console.error(`Analysis failed for ${record.id}:`, err);
          db.update(record.id, {
            status: 'Manuelle Prüfung nötig',
            result: {
              brand: brand,
              model_guess: model || 'Nicht identifiziert',
              result: 'unklar',
              risk_score: 50,
              summary: 'Bei der automatischen KI-Analyse ist ein technischer Fehler aufgetreten. Unser Support-Team prüft Ihre Tasche manuell.',
              positive_signs: ['Bilder erfolgreich übertragen'],
              warning_signs: ['Fehler in der automatischen Bildauswertung'],
              missing_images: [],
              recommendation: 'Manuelle Prüfung durch Experten eingeleitet. Sie erhalten eine Benachrichtigung.',
              disclaimer: 'Fehler-Fallback-Analyse'
            }
          });
        });

      return sendJSON(res, {
        success: true,
        id: record.id
      });
    } catch (err) {
      console.error('Upload API Error:', err);
      return sendJSON(res, { error: 'Fehler beim Verarbeiten des Uploads.' }, 500);
    }
  }

  // 5. Get Analysis Status / Results
  if (pathname === '/api/analysis' && method === 'GET') {
    const id = parsedUrl.query.id;
    if (!id) {
      return sendJSON(res, { error: 'Anfrage-ID fehlt.' }, 400);
    }

    const record = db.getById(id);
    if (!record) {
      return sendJSON(res, { error: 'Anfrage nicht gefunden.' }, 404);
    }

    return sendJSON(res, record);
  }

  // 6. Admin Login Check (Simple Session Simulation)
  if (pathname === '/api/admin/login' && method === 'POST') {
    try {
      const body = await getBodyJSON(req);
      const { password } = body;
      if (password === ADMIN_PASSWORD) {
        return sendJSON(res, { success: true });
      } else {
        return sendJSON(res, { success: false, error: 'Passwort falsch.' }, 401);
      }
    } catch (err) {
      return sendJSON(res, { error: 'Fehler.' }, 500);
    }
  }

  // 7. Admin - Get All Analyses
  if (pathname === '/api/admin/analyses' && method === 'POST') {
    try {
      const body = await getBodyJSON(req);
      const { password } = body;
      if (password !== ADMIN_PASSWORD) {
        return sendJSON(res, { error: 'Nicht autorisiert.' }, 401);
      }

      db.autoDeleteOldRecords(30);

      const records = db.getAll();
      return sendJSON(res, records);
    } catch (err) {
      return sendJSON(res, { error: 'Fehler beim Laden.' }, 500);
    }
  }

  // 8. Admin - Update Analysis (Status, Notes)
  if (pathname === '/api/admin/update' && method === 'POST') {
    try {
      const body = await getBodyJSON(req);
      const { password, id, status, notes, customResult } = body;
      if (password !== ADMIN_PASSWORD) {
        return sendJSON(res, { error: 'Nicht autorisiert.' }, 401);
      }

      const record = db.getById(id);
      if (!record) {
        return sendJSON(res, { error: 'Eintrag nicht gefunden.' }, 404);
      }

      const updates = {};
      if (status) updates.status = status;
      if (notes !== undefined) updates.notes = notes;
      
      if (customResult && typeof customResult === 'object') {
        updates.result = {
          ...record.result,
          ...customResult
        };
      }

      const updatedRecord = db.update(id, updates);
      return sendJSON(res, { success: true, record: updatedRecord });
    } catch (err) {
      return sendJSON(res, { error: 'Fehler beim Aktualisieren.' }, 500);
    }
  }

  // 9. Admin - Delete Analysis
  if (pathname === '/api/admin/delete' && method === 'POST') {
    try {
      const body = await getBodyJSON(req);
      const { password, id } = body;
      if (password !== ADMIN_PASSWORD) {
        return sendJSON(res, { error: 'Nicht autorisiert.' }, 401);
      }

      const record = db.getById(id);
      if (record) {
        if (record.images) {
          for (const key in record.images) {
            const imgPath = record.images[key];
            if (imgPath) {
              const fullPath = path.join(isVercel ? '/tmp' : __dirname, imgPath);
              if (fs.existsSync(fullPath)) {
                try {
                  fs.unlinkSync(fullPath);
                } catch (e) {
                  console.error('GDPR unlink error:', e);
                }
              }
            }
          }
        }
        db.remove(id);
      }

      return sendJSON(res, { success: true });
    } catch (err) {
      return sendJSON(res, { error: 'Fehler beim Löschen.' }, 500);
    }
  }

  // ----------------------------------------------------\n  // STATIC FILE ROUTING\n  // ----------------------------------------------------

  let safePathname = pathname;
  if (safePathname === '/') safePathname = '/index.html';

  if (safePathname.includes('..') || safePathname.includes('/.')) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Access Denied');
  }

  let filePath = '';
  if (safePathname.startsWith('/uploads/')) {
    filePath = path.join(isVercel ? '/tmp' : __dirname, safePathname);
  } else {
    filePath = path.join(__dirname, 'public', safePathname);
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404 - Seite nicht gefunden</h1><p>Der gesuchte Inhalt existiert nicht oder wurde verschoben.</p>');
  }
});

// Start listening
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Laminimas Authenticator server running at http://localhost:${PORT}`);
});
