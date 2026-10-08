const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const engine = require('./engine');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 300 * 1024 * 1024 } });

// Preset Rudaah Garba Categories
const DEFAULT_CATEGORIES = [
  'ALL',
  'FAMILY',
  'AAA',
  'FOOD COURT',
  'GROUND ACCESS',
  'LABOR',
  'PHOTOGRAPHER',
  'DECOR',
  'BOX OFFICE',
  'CREW',
  'PARKING'
];

// Per-category state store
// categoryName -> { templateBuffer, records, photos: Map(name -> {fileName, fullPath, buffer}) }
const categoryStores = new Map();

function getOrCreateStore(cat) {
  const safeCat = (cat || 'FAMILY').toUpperCase().trim();
  if (!categoryStores.has(safeCat)) {
    categoryStores.set(safeCat, {
      templateBuffer: null,
      templateName: 'Default Design',
      records: [],
      photos: new Map(), // lowerFileName -> { fileName, fullPath, buffer }
      photoFolderPath: '',
      generatedPdf: null,
      generatedExcel: null,
      config: {
        photoX: 275,
        photoY: 576,
        photoW: 366,
        photoH: 406,
        nameY: 1065,
        nameFontSize: 40,
        nameColor: '#992A20',
        photoPosition: 'top'
      }
    });
  }
  return categoryStores.get(safeCat);
}

// Global state
const appState = {
  categories: [...DEFAULT_CATEGORIES],
  currentCategory: 'FAMILY',
  globalPhotos: new Map(),
  globalPhotoFolderPath: '',
  progress: {
    status: 'idle',
    current: 0,
    total: 0,
    percent: 0,
    message: ''
  }
};

// Initialize default stores
DEFAULT_CATEGORIES.forEach(c => {
  if (c !== 'ALL') getOrCreateStore(c);
});

// Helper to find photo using normalized multi-key matching (handles .jpg.jpeg, casing, etc.)
function findPhotoInStore(store, targetFileName) {
  if (!targetFileName) return null;
  const targetKeys = engine.getBasePhotoKeys(targetFileName);

  // 1. Check category photos
  if (store && store.photos) {
    for (const k of targetKeys) {
      if (store.photos.has(k)) {
        return store.photos.get(k);
      }
    }
    for (const [key, item] of store.photos.entries()) {
      const itemKeys = engine.getBasePhotoKeys(item.fileName || key);
      for (const tk of targetKeys) {
        if (itemKeys.includes(tk)) return item;
      }
    }
  }

  // 2. Check global photos
  if (appState && appState.globalPhotos) {
    for (const k of targetKeys) {
      if (appState.globalPhotos.has(k)) {
        return appState.globalPhotos.get(k);
      }
    }
    for (const [key, item] of appState.globalPhotos.entries()) {
      const itemKeys = engine.getBasePhotoKeys(item.fileName || key);
      for (const tk of targetKeys) {
        if (itemKeys.includes(tk)) return item;
      }
    }
  }

  return null;
}

// Revalidate records for a category
function revalidateCategory(cat) {
  const store = getOrCreateStore(cat);
  for (const rec of store.records) {
    const target = (rec.photoFileName || '').trim();
    if (!target) {
      rec.isFound = false;
      rec.photoPath = null;
      rec.photoBuffer = null;
      rec.statusMessage = 'No photo filename';
      continue;
    }

    let fileObj = findPhotoInStore(store, target);

    if (fileObj) {
      rec.isFound = true;
      rec.photoPath = fileObj.fullPath || null;
      rec.photoBuffer = fileObj.buffer || null;
      rec.statusMessage = 'Found';
    } else {
      rec.isFound = false;
      rec.photoPath = null;
      rec.photoBuffer = null;
      rec.statusMessage = `Missing photo (${rec.photoFileName})`;
    }
  }
}

// Revalidate all
function revalidateAll() {
  for (const cat of appState.categories) {
    if (cat !== 'ALL') revalidateCategory(cat);
  }
}

// SSE stream for real-time progress
const sseClients = [];
app.get('/api/progress-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.push(res);
  res.write(`data: ${JSON.stringify(appState.progress)}\n\n`);

  req.on('close', () => {
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

function broadcastProgress(status, current, total, message) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  appState.progress = { status, current, total, percent, message };
  const data = JSON.stringify(appState.progress);
  for (const client of sseClients) {
    client.write(`data: ${data}\n\n`);
  }
}

// Unique photo counting helpers (counts unique files instead of multi-alias map keys)
function getUniquePhotosCount(photosMap) {
  if (!photosMap) return 0;
  const uniqueNames = new Set();
  for (const item of photosMap.values()) {
    if (item && item.fileName) {
      uniqueNames.add(item.fileName.toLowerCase().trim());
    }
  }
  return uniqueNames.size;
}

function getUniquePhotoList(photosMap) {
  if (!photosMap) return [];
  const uniqueItems = new Map();
  for (const item of photosMap.values()) {
    if (item && item.fileName) {
      const lower = item.fileName.toLowerCase().trim();
      if (!uniqueItems.has(lower)) {
        uniqueItems.set(lower, item.fileName);
      }
    }
  }
  return Array.from(uniqueItems.values());
}

// 1. Get state & statistics
app.get('/api/state', (req, res) => {
  const stats = {};
  let totalAll = 0;
  let matchedAll = 0;
  let missingAll = 0;

  for (const cat of appState.categories) {
    if (cat !== 'ALL') {
      const store = getOrCreateStore(cat);
      const matched = store.records.filter(r => r.isFound).length;
      const missing = store.records.filter(r => !r.isFound).length;
      stats[cat] = {
        total: store.records.length,
        matched,
        missing,
        hasCustomTemplate: !!store.templateBuffer,
        templateName: store.templateName,
        photosCount: getUniquePhotosCount(store.photos),
        availablePhotos: getUniquePhotoList(store.photos),
        photoFolderPath: store.photoFolderPath,
        hasPdf: !!store.generatedPdf,
        hasExcel: !!store.generatedExcel,
        config: store.config
      };
      totalAll += store.records.length;
      matchedAll += matched;
      missingAll += missing;
    }
  }

  stats['ALL'] = {
    total: totalAll,
    matched: matchedAll,
    missing: missingAll,
    photosCount: getUniquePhotosCount(appState.globalPhotos),
    availablePhotos: getUniquePhotoList(appState.globalPhotos)
  };

  res.json({
    categories: appState.categories,
    stats,
    globalPhotoFolderPath: appState.globalPhotoFolderPath,
    globalPhotosCount: getUniquePhotosCount(appState.globalPhotos)
  });
});

// 2. Upload WhatsApp Chat (.md or .txt)
app.post('/api/upload-chat', upload.single('chatFile'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Chat file (.md / .txt) is required' });
    const targetCategory = (req.body.category || 'FAMILY').toUpperCase().trim();
    const chatContent = req.file.buffer.toString('utf8');

    const parsedPairs = engine.parseWhatsAppChat(chatContent, targetCategory);
    if (parsedPairs.length === 0) {
      return res.status(400).json({ error: 'No valid name/photo pairs found in the chat export.' });
    }

    const store = getOrCreateStore(targetCategory);
    store.records = parsedPairs;

    revalidateCategory(targetCategory);

    res.json({
      success: true,
      category: targetCategory,
      extractedCount: parsedPairs.length,
      records: store.records
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Upload Excel file
app.post('/api/upload-excel', upload.single('excel'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Excel file is required' });
    const targetCategory = (req.body.category || 'FAMILY').toUpperCase().trim();
    const parsedRows = engine.parseExcelFile(req.file.buffer, targetCategory);

    if (targetCategory === 'ALL') {
      // Split rows into respective categories
      for (const row of parsedRows) {
        const rowCat = (row.category || 'FAMILY').toUpperCase().trim();
        if (!appState.categories.includes(rowCat)) {
          appState.categories.push(rowCat);
        }
        const s = getOrCreateStore(rowCat);
        s.records.push({
          id: `rec_${Date.now()}_${Math.random()}`,
          rowNumber: s.records.length + 1,
          name: row.name,
          category: rowCat,
          photoFileName: row.photoFileName,
          isFound: false,
          statusMessage: 'Pending'
        });
      }
      revalidateAll();
    } else {
      const store = getOrCreateStore(targetCategory);
      store.records = parsedRows.map((r, i) => ({
        id: `rec_${Date.now()}_${i}`,
        rowNumber: i + 1,
        name: r.name,
        category: targetCategory,
        photoFileName: r.photoFileName,
        isFound: false,
        statusMessage: 'Pending'
      }));
      revalidateCategory(targetCategory);
    }

    res.json({
      success: true,
      totalRows: parsedRows.length,
      categories: appState.categories
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Upload Photos ZIP file
app.post('/api/upload-zip', upload.single('photosZip'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Zip file is required' });
    const targetCategory = (req.body.category || 'FAMILY').toUpperCase().trim();
    const extractedPhotos = engine.extractZipPhotos(req.file.buffer);

    const store = targetCategory === 'ALL' ? null : getOrCreateStore(targetCategory);

    if (targetCategory === 'ALL') {
      for (const [k, v] of extractedPhotos.entries()) {
        appState.globalPhotos.set(k, v);
      }
      revalidateAll();
    } else {
      for (const [k, v] of extractedPhotos.entries()) {
        store.photos.set(k, v);
      }
      revalidateCategory(targetCategory);
    }

    const uniqueExtracted = getUniquePhotosCount(extractedPhotos);
    const totalUniqueInStore = targetCategory === 'ALL' ? getUniquePhotosCount(appState.globalPhotos) : getUniquePhotosCount(store.photos);

    res.json({
      success: true,
      category: targetCategory,
      photosExtracted: uniqueExtracted,
      photosCount: totalUniqueInStore,
      availablePhotos: getUniquePhotoList(targetCategory === 'ALL' ? appState.globalPhotos : store.photos)
    });
  } catch (err) {
    res.status(500).json({ error: 'Zip error: ' + err.message });
  }
});

// 5. Set Local Photos Folder Path (Windows direct path)
app.post('/api/set-photo-folder', (req, res) => {
  try {
    const { folderPath, category } = req.body;
    if (!folderPath) return res.status(400).json({ error: 'Folder path required' });
    if (!fs.existsSync(folderPath)) return res.status(400).json({ error: 'Folder does not exist on disk' });

    const targetCategory = (category || 'FAMILY').toUpperCase().trim();
    const files = fs.readdirSync(folderPath);
    let count = 0;

    const targetStore = targetCategory === 'ALL' ? null : getOrCreateStore(targetCategory);

    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].includes(ext) || /\.(jpg|jpeg|png|webp|heic|heif)/i.test(f)) {
        const fullPath = path.join(folderPath, f);
        const item = { fileName: f, fullPath };
        const keys = engine.getBasePhotoKeys(f);

        for (const k of keys) {
          if (targetStore) {
            targetStore.photos.set(k, item);
          } else {
            appState.globalPhotos.set(k, item);
          }
        }
        count++;
      }
    }

    if (targetStore) {
      targetStore.photoFolderPath = folderPath;
      revalidateCategory(targetCategory);
    } else {
      appState.globalPhotoFolderPath = folderPath;
      revalidateAll();
    }

    const totalUnique = targetStore ? getUniquePhotosCount(targetStore.photos) : getUniquePhotosCount(appState.globalPhotos);
    res.json({ success: true, photosCount: totalUnique, photosLoaded: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Upload Custom Design Template (PDF or Image)
app.post('/api/upload-template', upload.single('templateFile'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Template file is required' });
    const targetCategory = (req.body.category || 'FAMILY').toUpperCase().trim();
    const store = getOrCreateStore(targetCategory);

    // If PDF, render first page using sharp or pdf2image/pdfplumber
    const ext = path.extname(req.file.originalname).toLowerCase();
    let rawBuffer = null;
    if (ext === '.pdf') {
      // Save temp pdf and render page 1
      const tempPdfPath = path.join(__dirname, `temp_template_${targetCategory}.pdf`);
      fs.writeFileSync(tempPdfPath, req.file.buffer);

      // Use python pdfplumber to render 300 DPI image
      const tempPngPath = path.join(__dirname, `temp_template_${targetCategory}.png`);
      const { execSync } = require('child_process');
      execSync(`python -c "import pdfplumber; pdf = pdfplumber.open('${tempPdfPath.replace(/\\/g, '/')}'); pdf.pages[0].to_image(resolution=300).original.save('${tempPngPath.replace(/\\/g, '/')}')"`);
      rawBuffer = fs.readFileSync(tempPngPath);
    } else {
      // It's image (PNG / JPG)
      rawBuffer = req.file.buffer;
    }

    // Auto-clean any placeholder name with matching card cream background
    const sharp = require('sharp');
    const cleanedBuffer = await sharp(rawBuffer)
      .resize(901, 1500, { fit: 'fill' })
      .composite([{
        input: Buffer.from(`
          <svg width="901" height="1500" viewBox="0 0 901 1500" xmlns="http://www.w3.org/2000/svg">
            <rect x="150" y="1025" width="600" height="60" fill="#FEF4DB" />
          </svg>
        `),
        left: 0,
        top: 0
      }])
      .png()
      .toBuffer();

    store.templateBuffer = cleanedBuffer;
    store.templateName = req.file.originalname;

    res.json({
      success: true,
      category: targetCategory,
      templateName: store.templateName
    });
  } catch (err) {
    res.status(500).json({ error: 'Template upload error: ' + err.message });
  }
});

// 7. Get Records for a category
app.get('/api/records', (req, res) => {
  const cat = (req.query.category || 'FAMILY').toUpperCase().trim();
  let records = [];

  if (cat === 'ALL') {
    for (const c of appState.categories) {
      if (c !== 'ALL') {
        records = records.concat(getOrCreateStore(c).records);
      }
    }
  } else {
    records = getOrCreateStore(cat).records;
  }

  const availablePhotos = getUniquePhotoList(cat === 'ALL' ? appState.globalPhotos : getOrCreateStore(cat).photos);

  res.json({
    category: cat,
    total: records.length,
    matched: records.filter(r => r.isFound).length,
    missing: records.filter(r => !r.isFound).length,
    availablePhotos,
    records
  });
});

// 8. Update Record Inline
app.post('/api/update-record', (req, res) => {
  const { id, name, photoFileName, category } = req.body;
  const targetCategory = (category || 'FAMILY').toUpperCase().trim();
  const store = getOrCreateStore(targetCategory);

  let rec = store.records.find(r => r.id === id);
  if (!rec) {
    for (const c of appState.categories) {
      if (c !== 'ALL') {
        const s = getOrCreateStore(c);
        const found = s.records.find(item => item.id === id);
        if (found) { rec = found; break; }
      }
    }
  }
  if (!rec) return res.status(404).json({ error: 'Record not found' });

  if (name !== undefined && name !== null) rec.name = name.trim();
  if (photoFileName !== undefined && photoFileName !== null) rec.photoFileName = photoFileName.trim();

  revalidateCategory(rec.category || targetCategory);
  res.json({ success: true, record: rec });
});

// 8b. Upload Single Photo for a Specific Record
app.post('/api/upload-record-photo', upload.single('photoFile'), async (req, res) => {
  try {
    const { id, category } = req.body;
    if (!req.file) return res.status(400).json({ error: 'Photo file is required' });

    const targetCategory = (category || 'FAMILY').toUpperCase().trim();
    const store = getOrCreateStore(targetCategory);

    let targetRec = store.records.find(r => r.id === id);
    if (!targetRec) {
      for (const c of appState.categories) {
        if (c !== 'ALL') {
          const s = getOrCreateStore(c);
          const r = s.records.find(item => item.id === id);
          if (r) { targetRec = r; break; }
        }
      }
    }

    if (!targetRec) return res.status(404).json({ error: 'Record not found' });

    const photoName = req.file.originalname;
    const item = {
      fileName: photoName,
      fullPath: null,
      buffer: req.file.buffer
    };

    // Store in category store & global photos map
    const keys = engine.getBasePhotoKeys(photoName);
    for (const k of keys) {
      store.photos.set(k, item);
      appState.globalPhotos.set(k, item);
    }

    targetRec.photoFileName = photoName;
    targetRec.photoBuffer = req.file.buffer;
    targetRec.photoPath = null;
    targetRec.isFound = true;
    targetRec.statusMessage = 'Found';

    revalidateCategory(targetRec.category || targetCategory);

    res.json({
      success: true,
      record: targetRec,
      availablePhotos: getUniquePhotoList(store.photos)
    });
  } catch (err) {
    res.status(500).json({ error: 'Photo upload error: ' + err.message });
  }
});

// 8c. Update Individual Record Photo Fit / Shift Config
app.post('/api/update-record-config', (req, res) => {
  const { id, category, config } = req.body;
  const targetCategory = (category || 'FAMILY').toUpperCase().trim();
  const store = getOrCreateStore(targetCategory);

  let targetRec = store.records.find(r => r.id === id);
  if (!targetRec) {
    for (const c of appState.categories) {
      if (c !== 'ALL') {
        const s = getOrCreateStore(c);
        const r = s.records.find(item => item.id === id);
        if (r) { targetRec = r; break; }
      }
    }
  }

  if (!targetRec) return res.status(404).json({ error: 'Record not found' });
  targetRec.config = Object.assign(targetRec.config || {}, config || {});
  res.json({ success: true, record: targetRec });
});

// 9. Delete Record
app.delete('/api/delete-record/:id', (req, res) => {
  const recId = req.params.id;
  for (const c of appState.categories) {
    if (c !== 'ALL') {
      const s = getOrCreateStore(c);
      const idx = s.records.findIndex(r => r.id === recId);
      if (idx !== -1) {
        s.records.splice(idx, 1);
        revalidateCategory(c);
        return res.json({ success: true, category: c });
      }
    }
  }
  res.status(404).json({ error: 'Record not found' });
});

// 10. Add Category
app.post('/api/add-category', (req, res) => {
  const { categoryName } = req.body;
  if (!categoryName) return res.status(400).json({ error: 'Category name required' });
  const cat = categoryName.toUpperCase().trim();
  if (!appState.categories.includes(cat)) {
    appState.categories.push(cat);
    getOrCreateStore(cat);
  }
  res.json({ categories: appState.categories });
});

// 11. Live Card Preview
app.get('/api/preview-card/:id', async (req, res) => {
  try {
    let targetRec = null;
    let targetStore = null;

    for (const c of appState.categories) {
      if (c !== 'ALL') {
        const s = getOrCreateStore(c);
        const r = s.records.find(item => item.id === req.params.id);
        if (r) {
          targetRec = r;
          targetStore = s;
          break;
        }
      }
    }

    if (!targetRec) return res.status(404).send('Record not found');

    let photoBuffer = null;
    if (targetRec.photoPath && fs.existsSync(targetRec.photoPath)) {
      photoBuffer = await engine.processPhoto(targetRec.photoPath);
    } else if (targetRec.photoBuffer) {
      photoBuffer = await engine.processPhoto(targetRec.photoBuffer);
    }

    const mergedConfig = Object.assign({}, targetStore ? targetStore.config : {}, targetRec.config || {});

    const cardPng = await engine.generateCardImage(
      targetRec.name,
      targetRec.category,
      photoBuffer,
      targetStore ? targetStore.templateBuffer : null,
      mergedConfig
    );

    res.setHeader('Content-Type', 'image/png');
    res.send(cardPng);
  } catch (err) {
    res.status(500).send('Preview error: ' + err.message);
  }
});

// Update Category Layout Positioning Config
app.post('/api/update-category-config', (req, res) => {
  const { category, config } = req.body;
  const targetCategory = (category || 'FAMILY').toUpperCase().trim();
  const store = getOrCreateStore(targetCategory);
  store.config = Object.assign(store.config, config || {});
  res.json({ success: true, category: targetCategory, config: store.config });
});

// Reset Category Data or Entire Workspace
app.post('/api/reset-category', (req, res) => {
  try {
    const targetCategory = (req.body.category || 'FAMILY').toUpperCase().trim();
    const defaultConfig = {
      photoX: 275,
      photoY: 576,
      photoW: 366,
      photoH: 406,
      nameY: 1065,
      nameFontSize: 40,
      nameColor: '#992A20',
      photoPosition: 'top'
    };

    if (targetCategory === 'ALL') {
      for (const c of appState.categories) {
        if (c !== 'ALL') {
          const s = getOrCreateStore(c);
          s.records = [];
          s.photos.clear();
          s.photoFolderPath = '';
          s.templateBuffer = null;
          s.templateName = 'Default Design';
          s.generatedPdf = null;
          s.generatedExcel = null;
          s.config = Object.assign({}, defaultConfig);
        }
      }
      appState.globalPhotos.clear();
      appState.globalPhotoFolderPath = '';
      revalidateAll();
    } else {
      const s = getOrCreateStore(targetCategory);
      s.records = [];
      s.photos.clear();
      s.photoFolderPath = '';
      s.templateBuffer = null;
      s.templateName = 'Default Design';
      s.generatedPdf = null;
      s.generatedExcel = null;
      s.config = Object.assign({}, defaultConfig);
      revalidateCategory(targetCategory);
    }

    res.json({ success: true, category: targetCategory, message: `Reset completed for ${targetCategory}` });
  } catch (err) {
    res.status(500).json({ error: 'Reset failed: ' + err.message });
  }
});

// 12. Bulk Generate
app.post('/api/generate', async (req, res) => {
  try {
    const category = (req.body.category || 'FAMILY').toUpperCase().trim();
    let records = [];
    let customTemplate = null;

    if (category === 'ALL') {
      for (const c of appState.categories) {
        if (c !== 'ALL') {
          records = records.concat(getOrCreateStore(c).records);
        }
      }
    } else {
      const store = getOrCreateStore(category);
      records = store.records;
      customTemplate = store.templateBuffer;
    }

    if (records.length === 0) {
      return res.status(400).json({ error: `No records found in category: ${category}` });
    }

    const missing = records.filter(r => !r.isFound);
    if (missing.length > 0 && !req.body.force) {
      return res.status(400).json({
        error: `Cannot generate: ${missing.length} photos are missing for category ${category}. Please check photo filenames or enable Force Generate.`,
        missingCount: missing.length,
        missingRecords: missing.slice(0, 10)
      });
    }

    broadcastProgress('generating_pdf', 0, records.length, `Generating PDF for ${category} (${records.length} cards)...`);

    // PDF
    const pdfBytes = await engine.generateCardsPdf(records, (curr, total, rec) => {
      broadcastProgress('generating_pdf', curr, total, `PDF: ${curr} / ${total} cards (${rec.name})`);
    }, customTemplate, category === 'ALL' ? null : getOrCreateStore(category).config);

    const pdfBuffer = Buffer.from(pdfBytes);

    if (category === 'ALL') {
      appState.generatedAllPdf = pdfBuffer;
    } else {
      const store = getOrCreateStore(category);
      store.generatedPdf = pdfBuffer;
    }

    // Auto-save PDF directly to user's Downloads and output folder
    try {
      const os = require('os');
      const filename = `Rudaah_Garba_ID_Cards_${category.replace(/\s+/g, '_')}.pdf`;
      const dest = path.join(os.homedir(), 'Downloads', filename);
      fs.writeFileSync(dest, pdfBuffer);
      const outDir = path.join(__dirname, 'output');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, filename), pdfBuffer);
    } catch (e) {
      console.warn('Auto-save note:', e.message);
    }

    broadcastProgress('done', records.length, records.length, `Generated ${records.length} cards PDF successfully!`);

    res.json({
      success: true,
      category,
      count: records.length,
      pdfReady: true
    });
  } catch (err) {
    broadcastProgress('error', 0, 0, err.message);
    res.status(500).json({ error: err.message });
  }
});

// 13. Download PDF (supports attachment, inline browser view, and auto-save)
app.get('/api/download/pdf', (req, res) => {
  const category = (req.query.category || 'FAMILY').toUpperCase().trim();
  let buffer = null;

  if (category === 'ALL') {
    buffer = appState.generatedAllPdf;
  } else {
    buffer = getOrCreateStore(category).generatedPdf;
  }

  if (!buffer) return res.status(404).send('PDF not generated yet for category: ' + category);

  const filename = `Rudaah_Garba_ID_Cards_${category.replace(/\s+/g, '_')}.pdf`;
  
  // Auto-save to Windows user's Downloads folder
  try {
    const os = require('os');
    const dest = path.join(os.homedir(), 'Downloads', filename);
    fs.writeFileSync(dest, buffer);
  } catch (e) {
    console.warn('Auto-save note:', e.message);
  }

  const isInline = req.query.inline === 'true' || req.query.view === 'true';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${isInline ? 'inline' : 'attachment'}; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
});

// 14. Download Excel with embedded photos
app.get('/api/download/excel', (req, res) => {
  const category = (req.query.category || 'FAMILY').toUpperCase().trim();
  let buffer = null;

  if (category === 'ALL') {
    buffer = appState.generatedAllExcel;
  } else {
    buffer = getOrCreateStore(category).generatedExcel;
  }

  if (!buffer) return res.status(404).send('Excel with photos not generated yet for category: ' + category);

  const filename = `Rudaah_Garba_ID_Cards_${category.replace(/\s+/g, '_')}_With_Photos.xlsx`;

  // Auto-save to Windows user's Downloads folder
  try {
    const os = require('os');
    const dest = path.join(os.homedir(), 'Downloads', filename);
    fs.writeFileSync(dest, buffer);
  } catch (e) {
    console.warn('Auto-save note:', e.message);
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
});

// 14b. Open File or Folder directly in Windows Explorer
app.post('/api/open-in-folder', (req, res) => {
  try {
    const { category, fileType } = req.body;
    const cat = (category || 'FAMILY').toUpperCase().trim().replace(/\s+/g, '_');
    const filename = fileType === 'excel'
      ? `Rudaah_Garba_ID_Cards_${cat}_With_Photos.xlsx`
      : `Rudaah_Garba_ID_Cards_${cat}.pdf`;

    const os = require('os');
    const filePath = path.join(os.homedir(), 'Downloads', filename);
    const { exec } = require('child_process');

    if (fs.existsSync(filePath)) {
      exec(`explorer.exe /select,"${filePath}"`);
      return res.json({ success: true, path: filePath, opened: 'file' });
    } else {
      const downloadsDir = path.join(os.homedir(), 'Downloads');
      exec(`explorer.exe "${downloadsDir}"`);
      return res.json({ success: true, path: downloadsDir, opened: 'directory' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14c. Open File directly in default Windows app (Bypasses IDM 100%)
app.post('/api/open-file', (req, res) => {
  try {
    const { category, fileType } = req.body;
    const cat = (category || 'FAMILY').toUpperCase().trim().replace(/\s+/g, '_');
    const filename = fileType === 'excel'
      ? `Rudaah_Garba_ID_Cards_${cat}_With_Photos.xlsx`
      : `Rudaah_Garba_ID_Cards_${cat}.pdf`;

    const os = require('os');
    const filePath = path.join(os.homedir(), 'Downloads', filename);
    const { exec } = require('child_process');

    if (fs.existsSync(filePath)) {
      exec(`cmd.exe /c start "" "${filePath}"`);
      return res.json({ success: true, path: filePath });
    } else {
      return res.status(404).json({ error: 'File not found. Please click Generate first.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. Load Real WhatsApp Chat Demo (extracted_assets/chat.md)
app.post('/api/load-chat-demo', (req, res) => {
  try {
    const chatPath = path.join(__dirname, 'extracted_assets', 'chat.md');
    if (!fs.existsSync(chatPath)) {
      return res.status(404).json({ error: 'chat.md not found in extracted_assets' });
    }

    const content = fs.readFileSync(chatPath, 'utf8');
    const store = getOrCreateStore('FAMILY');
    store.records = engine.parseWhatsAppChat(content, 'FAMILY');

    // Also populate demo photos in sample_data/photos
    const sampleDir = path.join(__dirname, 'sample_data', 'photos');
    fs.mkdirSync(sampleDir, { recursive: true });

    // Copy sample image as 0R1A2643.JPG, IMG-20261006-WA0081.jpg, etc.
    const priyanshImg = path.join(__dirname, 'extracted_assets', 'page_1_img_5_X15.jpg');
    if (fs.existsSync(priyanshImg)) {
      const demoNames = [
        '0R1A2643.JPG',
        'IMG-20261006-WA0081.jpg',
        'IMG-20261006-WA0020.jpg',
        'IMG-20261006-WA0021.jpg',
        'IMG-20261006-WA0108.jpg',
        'WA_1791393397402.jpg'
      ];
      demoNames.forEach(n => {
        fs.copyFileSync(priyanshImg, path.join(sampleDir, n));
        store.photos.set(n.toLowerCase().trim(), {
          fileName: n,
          fullPath: path.join(sampleDir, n)
        });
      });
    }

    store.photoFolderPath = sampleDir;
    revalidateCategory('FAMILY');

    res.json({
      success: true,
      category: 'FAMILY',
      recordsCount: store.records.length,
      photosCount: store.photos.size,
      records: store.records
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Default clean start - no automatic demo data injection
console.log('Clean workspace ready: no demo or cached data autoloaded.');

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(` RUDAAH GARBA ID CARD GENERATOR IS RUNNING!`);
  console.log(` Category-Wise Studio + WhatsApp Chat Parser Active!`);
  console.log(` Open URL in your browser: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
