const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
sharp.cache(false);
const { PDFDocument } = require('pdf-lib');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const AdmZip = require('adm-zip');

const heicConvert = require('heic-convert');

const DEFAULT_TEMPLATE_PATH = path.join(__dirname, 'clean_card_template_v3.png');

// 300 DPI coordinates on 901 x 1500 canvas (matching user's Family (2).png red box)
const PHOTO_X = 275;
const PHOTO_Y = 576;
const PHOTO_W = 366;
const PHOTO_H = 406;

/**
 * Check if buffer contains HEIC/HEIF magic bytes
 */
function isHeicBuffer(buffer) {
  if (!buffer || buffer.length < 12) return false;
  const brand = buffer.toString('ascii', 4, 12).toLowerCase();
  return brand.startsWith('ftyp') && (
    brand.includes('heic') ||
    brand.includes('heix') ||
    brand.includes('mif1') ||
    brand.includes('msf1') ||
    brand.includes('hevc')
  );
}

/**
 * Ensures any image (including Apple iPhone HEIC/HEIF) is converted to standard buffer
 */
async function ensureStandardImageBuffer(imageBufferOrPath) {
  if (!imageBufferOrPath) return null;
  let buf = null;
  const isPath = typeof imageBufferOrPath === 'string';

  if (isPath) {
    if (!fs.existsSync(imageBufferOrPath)) return null;
    buf = fs.readFileSync(imageBufferOrPath);
  } else {
    buf = Buffer.isBuffer(imageBufferOrPath) ? imageBufferOrPath : Buffer.from(imageBufferOrPath);
  }

  const isHeic = (isPath && /\.(heic|heif)$/i.test(imageBufferOrPath)) || isHeicBuffer(buf);
  if (isHeic) {
    try {
      buf = await heicConvert({
        buffer: buf,
        format: 'JPEG',
        quality: 0.95
      });
    } catch (err) {
      console.warn('HEIC to JPEG conversion note:', err.message);
    }
  }

  return buf;
}

/**
 * Preprocess photo: EXIF auto-rotate, center cover crop to fixed 366x406 container
 * Fully supports HEIC / HEIF / JPG / PNG / WEBP
 */
async function processPhoto(imageBufferOrPath) {
  const buf = await ensureStandardImageBuffer(imageBufferOrPath);
  if (!buf) return null;

  return await sharp(buf)
    .rotate() // auto-orient based on EXIF
    .png()
    .toBuffer();
}

/**
 * Generate a single ID card PNG buffer
 * Supports custom category template if provided
 */
function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '');
}

function getCategoryTemplate(categoryName, customBuffer) {
  if (customBuffer) return customBuffer;
  const safeName = (categoryName || 'FAMILY').toUpperCase().trim().replace(/\s+/g, '_');
  const catFile = path.join(__dirname, 'templates', `${safeName}.png`);
  if (fs.existsSync(catFile)) {
    return catFile;
  }
  return DEFAULT_TEMPLATE_PATH;
}

/**
 * Generate a single ID card PNG buffer
 * Uses user's uploaded design file (or default if none uploaded)
 * Places Photo at (photoX, photoY, photoW, photoH)
 * Places Name at (nameX, nameY)
 */
async function generateCardImage(personName, categoryName, photoBuffer, customTemplateBuffer = null, config = null) {
  const safeName = escapeXml((personName || 'NAME').toUpperCase().trim());
  const cfg = Object.assign({
    photoX: 275,
    photoY: 576,
    photoW: 366,
    photoH: 406,
    nameY: 1065,
    nameFontSize: 40,
    nameColor: '#992A20',
    photoPosition: 'top'
  }, config || {});

  // Dynamic font sizing for long names
  let nameFontSize = cfg.nameFontSize || 40;
  if (safeName.length > 22) nameFontSize = Math.round(nameFontSize * 0.7);
  else if (safeName.length > 18) nameFontSize = Math.round(nameFontSize * 0.8);
  else if (safeName.length > 14) nameFontSize = Math.round(nameFontSize * 0.9);

  const textSvg = `
    <svg width="901" height="1500" viewBox="0 0 901 1500" xmlns="http://www.w3.org/2000/svg">
      <style>
        .person-name {
          font-family: 'Poppins', 'Segoe UI', Arial, sans-serif;
          font-weight: 800;
          font-size: ${nameFontSize}px;
          fill: ${cfg.nameColor || '#992A20'};
          text-anchor: middle;
          letter-spacing: 1.5px;
        }
      </style>
      <!-- Erase any placeholder name (like PRIYANSH PANCHAL) with matching cream card background -->
      <rect x="150" y="${(cfg.nameY || 1065) - 40}" width="600" height="58" fill="#FEF4DB" />
      <text x="450" y="${cfg.nameY || 1065}" class="person-name">${safeName}</text>
    </svg>
  `;

  const composites = [];
  if (photoBuffer) {
    const stdBuf = await ensureStandardImageBuffer(photoBuffer);
    if (stdBuf) {
      const mode = (cfg.photoPosition || 'contain').toLowerCase().trim();
      const baseW = cfg.photoW || 366;
      const baseH = cfg.photoH || 406;
      const shiftY = parseInt(cfg.photoShiftY || 0);
      const shiftX = parseInt(cfg.photoShiftX || 0);
      const zoomPercent = parseInt(cfg.photoZoom || 100);
      const zoomFactor = Math.max(0.5, Math.min(2.0, zoomPercent / 100));

      const targetW = Math.round(baseW * zoomFactor);
      const targetH = Math.round(baseH * zoomFactor);

      let photoFrame;

      if (mode === 'contain') {
        // Fit entire photo without cutting ANY part of the person
        const innerW = Math.round(baseW * zoomFactor);
        const innerH = Math.round(baseH * zoomFactor);
        const fitted = await sharp(stdBuf)
          .rotate()
          .resize(innerW, innerH, {
            fit: 'contain',
            background: { r: 254, g: 244, b: 219, alpha: 1 } // Exact Canva cream
          })
          .png()
          .toBuffer();

        const pasteX = Math.round((baseW - innerW) / 2) + shiftX;
        const pasteY = Math.round((baseH - innerH) / 2) + shiftY;

        photoFrame = await sharp({
          create: {
            width: baseW,
            height: baseH,
            channels: 4,
            background: { r: 254, g: 244, b: 219, alpha: 1 }
          }
        })
        .composite([{
          input: fitted,
          left: Math.max(0, Math.min(baseW - 1, pasteX)),
          top: Math.max(0, Math.min(baseH - 1, pasteY))
        }])
        .png()
        .toBuffer();
      } else {
        // Cover mode: smart face attention or chosen position
        const validPositions = ['attention', 'entropy', 'top', 'center', 'bottom'];
        const chosenPos = validPositions.includes(mode) ? mode : 'attention';
        
        const scaledW = Math.round(baseW * zoomFactor);
        const scaledH = Math.round(baseH * zoomFactor);

        const resized = await sharp(stdBuf)
          .rotate()
          .resize(scaledW, scaledH, {
            fit: 'cover',
            position: chosenPos
          })
          .png()
          .toBuffer();

        // Calculate offset to crop strictly to baseW x baseH, respecting shiftX and shiftY
        const targetLeft = Math.max(0, Math.min(scaledW - baseW, Math.round((scaledW - baseW) / 2) - shiftX));
        const targetTop = Math.max(0, Math.min(scaledH - baseH, Math.round((scaledH - baseH) / 2) - shiftY));
        const extractW = Math.min(baseW, scaledW);
        const extractH = Math.min(baseH, scaledH);

        photoFrame = await sharp(resized)
          .extract({
            left: targetLeft,
            top: targetTop,
            width: extractW,
            height: extractH
          })
          .resize(baseW, baseH, { fit: 'fill' })
          .png()
          .toBuffer();
      }

      composites.push({
        input: photoFrame,
        left: cfg.photoX || 275,
        top: cfg.photoY || 576
      });
    }
  }

  composites.push({
    input: Buffer.from(textSvg),
    left: 0,
    top: 0
  });

  const baseInput = customTemplateBuffer || getCategoryTemplate(categoryName);

  return await sharp(baseInput)
    .resize(901, 1500, { fit: 'fill' })
    .composite(composites)
    .png({ quality: 95 })
    .toBuffer();
}

/**
 * Generate Multi-page Print-Ready PDF
 * Each page is 216 pt x 360 pt (3" x 5" standard badge)
 */
async function generateCardsPdf(records, onProgress, customTemplateBuffer = null, config = null) {
  const pdfDoc = await PDFDocument.create();
  const PAGE_WIDTH_PT = 216;
  const PAGE_HEIGHT_PT = 360;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    let photoBuffer = null;

    if (record.photoPath && fs.existsSync(record.photoPath)) {
      try {
        photoBuffer = await processPhoto(record.photoPath);
      } catch (err) {
        console.warn(`Error processing photo for ${record.name}:`, err.message);
      }
    } else if (record.photoBuffer) {
      try {
        photoBuffer = await processPhoto(record.photoBuffer);
      } catch (err) {
        console.warn(`Error processing photo buffer for ${record.name}:`, err.message);
      }
    }

    const mergedConfig = Object.assign({}, config || {}, record.config || {});
    const cardPngBuffer = await generateCardImage(record.name, record.category, photoBuffer, customTemplateBuffer, mergedConfig);
    const embeddedImage = await pdfDoc.embedPng(cardPngBuffer);

    const page = pdfDoc.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);
    page.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: PAGE_WIDTH_PT,
      height: PAGE_HEIGHT_PT
    });

    if (onProgress) {
      onProgress(i + 1, records.length, record);
    }
  }

  return await pdfDoc.save();
}

/**
 * Generate Excel file with ACTUALLY EMBEDDED PHOTOS in cells
 */
async function generateExcelWithPhotos(records, categoryName = 'General', onProgress) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Rudaah Garba ID Card Generator';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(`${categoryName} ID Cards`);

  worksheet.columns = [
    { header: 'S.No', key: 'sno', width: 8 },
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Category', key: 'category', width: 20 },
    { header: 'Photo Filename', key: 'photoFileName', width: 24 },
    { header: 'Photo (Embedded)', key: 'embeddedPhoto', width: 18 },
    { header: 'Status', key: 'status', width: 14 }
  ];

  // Header styling
  worksheet.getRow(1).height = 28;
  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF992A20' }
  };
  worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const rowIdx = i + 2;
    const row = worksheet.addRow({
      sno: i + 1,
      name: rec.name,
      category: rec.category,
      photoFileName: rec.photoFileName,
      embeddedPhoto: '',
      status: rec.isFound ? 'Verified' : 'Missing'
    });

    row.height = 80;
    row.alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell('name').alignment = { vertical: 'middle', horizontal: 'left' };
    row.font = { size: 11 };

    // Process & embed image (supports HEIC, JPG, PNG, WEBP)
    let rawBuffer = null;
    const inputBuf = (rec.photoPath && fs.existsSync(rec.photoPath)) ? rec.photoPath : rec.photoBuffer;
    if (inputBuf) {
      try {
        const stdBuf = await ensureStandardImageBuffer(inputBuf);
        if (stdBuf) {
          rawBuffer = await sharp(stdBuf)
            .rotate()
            .resize(120, 134, { fit: 'cover', position: 'top' })
            .jpeg({ quality: 85 })
            .toBuffer();
        }
      } catch (e) {
        console.warn('Error reading photo for excel embed:', e.message);
      }
    }

    if (rawBuffer) {
      const imgId = workbook.addImage({
        buffer: rawBuffer,
        extension: 'jpeg'
      });

      worksheet.addImage(imgId, {
        tl: { col: 4.15, row: rowIdx - 0.9 },
        ext: { width: 75, height: 84 },
        editAs: 'oneCell'
      });
    }

    if (onProgress) {
      onProgress(i + 1, records.length, rec);
    }
  }

  // Border styling
  worksheet.eachRow((r) => {
    r.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        right: { style: 'thin', color: { argb: 'FFDDDDDD' } }
      };
    });
  });

  return await workbook.xlsx.writeBuffer();
}

/**
 * Intelligently parse WhatsApp Chat Export (.md or .txt)
 * Extracts (Name <-> Photo Filename) pairs in sequential chat flow
 */
const FILE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'svg', 'bmp', 'tiff', 'tif',
  'raw', 'dng', 'cr2', 'nef', 'arw', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt',
  'mp4', 'mov', 'avi', 'mkv', '3gp', 'mp3', 'm4a', 'opus', 'wav', 'aac',
  'zip', 'rar', '7z'
]);

const GENERIC_FILE_WORDS = new Set([
  'image', 'images', 'photo', 'photos', 'picture', 'pictures', 'pic', 'pics',
  'img', 'imgs', 'document', 'documents', 'doc', 'docs', 'file', 'files',
  'attachment', 'attachments', 'media', 'video', 'videos', 'audio', 'audios',
  'voice', 'recording', 'sticker', 'stickers', 'gif', 'gifs', 'camera', 'screenshot',
  'whatsapp', 'wa', 'null', 'undefined', 'unknown'
]);

const chatterWords = new Set([
  'sado nai mukavano divy', 'sado nai mukavano', 'hn hn', 'haan', 'ha ha', 'ha', 'hn', 'na', 
  'ano avo ayo ne atale', 'badha na avaj chhe shu karu ke', 'kale joia hed ne', 'shu karu', 
  'ok', 'done', 'yes', 'no', 'thanks', 'thank you', 'theek', 'acha', 'saras', 'barobar',
  'please', 'pls', 'good morning', 'good night', 'gm', 'gn'
]);

function cleanNameCandidate(text) {
  if (!text) return '';
  let str = text;

  // 1. Strip WhatsApp timestamp prefix: e.g. "[8:16 PM]" or "[8:16 PM, 10/8/2026]"
  str = str.replace(/^\[?\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?(?:\s*,\s*[^\]]+)?\s*\]?\s*[-–:]?\s*/i, '');
  
  // 2. Strip standard WhatsApp date/time without brackets: e.g. "10/8/2026, 8:16 PM - "
  str = str.replace(/^\d{1,4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,4}(?:,\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)?\s*[-–:]?\s*/i, '');

  // 3. Strip sender names if formatted with colon e.g. "**You:**", "Divy Thakkar:"
  str = str.replace(/^(?:\*\*)?[^:\n]{1,30}(?:\*\*)?:\s*/, '');

  // 4. Strip tags like [Forwarded], [Document], [Image], [Photo], etc.
  str = str.replace(/\[\s*(?:Forwarded|Document|Image|Photo|Picture|Video|Audio|Sticker|GIF|Media|File)\s*\]/gi, '');
  str = str.replace(/<(?:document|image|photo|video|media)\s+omitted>/gi, '');

  // 5. Strip Markdown formatting
  str = str.replace(/!\[.*?\]\(.*?\)/g, '');
  str = str.replace(/\[(.*?)\]\(.*?\)/g, '$1');
  str = str.replace(/__.*?__/g, '');
  str = str.replace(/[*_~`#]/g, '');

  // 6. Strip leading bullets / numbers: "1. ", "- ", "• "
  str = str.replace(/^[\s\-\*•\d+\.\)]+/, '');

  // 7. Strip labels like "Name:", "Full Name:", "Name -"
  str = str.replace(/^(?:full\s*)?name\s*[:\-–]\s*/i, '');

  // 8. Strip trailing image extension if someone named the file after a person (e.g. "Nirav Sangani.jpg")
  str = str.replace(/\.(?:jpg|jpeg|png|webp|heic|heif|gif|pdf|doc|docx)$/i, '');

  // 9. Strip trailing phone numbers if attached
  str = str.replace(/(?:\+?91[\s\-]?)?[6-9]\d{9}$/, '');

  // 10. Clean punctuation at start/end
  str = str.replace(/^[\s,.:;_\-]+|[\s,.:;_\-]+$/g, '');

  // 11. Collapse multiple spaces
  str = str.replace(/\s+/g, ' ');

  return str.trim();
}

function isValidName(str) {
  if (!str) return false;
  const s = str.trim();
  if (s.length < 2 || s.length > 50) return false;

  const lower = s.toLowerCase();

  // Exactly a file extension (e.g. 'jpg', 'jpeg', 'png', 'pdf') or generic media word ('image', 'document')
  if (FILE_EXTENSIONS.has(lower) || GENERIC_FILE_WORDS.has(lower)) return false;

  // Bracket tags alone e.g. [Image], [Photo], etc.
  if (/^\[.*?\]$/.test(s)) return false;

  // Timestamps / dates
  if (/^\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?$/i.test(s)) return false;
  if (/^\d{1,4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,4}/.test(s)) return false;

  // Any extension with or without dot (e.g. '.jpg', 'jpg', 'something.jpg')
  if (/^\.?(?:jpg|jpeg|png|webp|heic|heif|mp4|mov|pdf|doc|docx|gif|svg)$/i.test(lower)) return false;
  if (/\.(?:jpg|jpeg|png|webp|heic|heif|mp4|mov|pdf|doc|docx)$/i.test(s)) return false;

  // Camera / device generated filenames (e.g. IMG-20261006-WA0081, WA_1791393397402, 0R1A2643, DSC_0001)
  if (/^(?:img|vid|wa|dsc|pxl|sam|pic|photo|scan)[_\-0-9]/i.test(lower)) return false;
  if (/^\d{1,4}[a-z]\d{1,6}$/i.test(lower)) return false;

  // Numbers only / phone numbers
  if (/^[\+0-9\s\-\(\)]{5,}$/.test(s) && !/[a-zA-Z]/.test(s)) return false;

  // URLs
  if (/^(?:https?:\/\/|www\.)/i.test(s)) return false;

  // Must contain at least two letters
  const letters = s.match(/[a-zA-Z\u0900-\u0D7F]/g);
  if (!letters || letters.length < 2) return false;

  if (chatterWords.has(lower)) return false;

  const chatterPatterns = [
    /sado nai mukavano/i,
    /shu karu/i,
    /kale joia/i,
    /badha na avaj/i,
    /ano avo ayo/i,
    /photo moklo/i,
    /photo bhej/i,
    /send photo/i,
    /end-to-end encrypted/i,
    /created the group/i,
    /added you/i,
    /left the group/i
  ];
  for (const pat of chatterPatterns) {
    if (pat.test(lower)) return false;
  }

  return true;
}

function parseWhatsAppChat(chatContent, defaultCategory = 'FAMILY') {
  const lines = chatContent.split(/\r?\n/);
  
  const junkRegex = /Messages and calls are end-to-end encrypted|created the group|added You|left the group|security code changed|^# WhatsApp Chat Export|^Export date:|^---|^## /i;
  const imageRegex = /([a-zA-Z0-9_\-–\s()]+\.(?:jpg|jpeg|png|webp|JPG|JPEG|PNG|WEBP|heic|HEIC))/i;

  const sequence = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || junkRegex.test(raw)) continue;

    const candidateName = cleanNameCandidate(raw);
    const imgMatch = raw.match(imageRegex);

    if (isValidName(candidateName)) {
      sequence.push({ type: 'name', value: candidateName, line: i + 1 });
    } else if (imgMatch) {
      sequence.push({ type: 'photo', value: imgMatch[1].trim(), line: i + 1 });
    }
  }

  const pairs = [];
  let pendingName = null;

  for (let i = 0; i < sequence.length; i++) {
    const item = sequence[i];

    if (item.type === 'name') {
      if (pendingName) {
        pairs.push({
          id: `rec_${Date.now()}_${pairs.length}`,
          name: pendingName.value,
          category: defaultCategory,
          photoFileName: '',
          rowNumber: pairs.length + 1,
          line: pendingName.line
        });
      }
      pendingName = item;
    } else if (item.type === 'photo') {
      if (pendingName) {
        pairs.push({
          id: `rec_${Date.now()}_${pairs.length}`,
          name: pendingName.value,
          category: defaultCategory,
          photoFileName: item.value,
          rowNumber: pairs.length + 1,
          line: pendingName.line
        });
        pendingName = null;
      } else {
        if (i + 1 < sequence.length && sequence[i + 1].type === 'name') {
          pairs.push({
            id: `rec_${Date.now()}_${pairs.length}`,
            name: sequence[i + 1].value,
            category: defaultCategory,
            photoFileName: item.value,
            rowNumber: pairs.length + 1,
            line: sequence[i + 1].line
          });
          i++; // consumed name
        }
      }
    }
  }

  if (pendingName) {
    pairs.push({
      id: `rec_${Date.now()}_${pairs.length}`,
      name: pendingName.value,
      category: defaultCategory,
      photoFileName: '',
      rowNumber: pairs.length + 1,
      line: pendingName.line
    });
  }

  return pairs;
}

/**
 * Parse Excel Buffer to Rows
 */
function parseExcelFile(fileBuffer, defaultCategory = 'FAMILY') {
  const wb = XLSX.read(fileBuffer, { type: 'buffer' });
  const firstSheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[firstSheetName];
  const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  return jsonRows.map((r, index) => {
    const keys = Object.keys(r);
    const findVal = (keywords) => {
      for (const k of keys) {
        const clean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (keywords.some(kw => clean.includes(kw))) {
          return String(r[k]).trim();
        }
      }
      return '';
    };

    const name = findVal(['name', 'person', 'fullname', 'member']) || String(r[keys[0]] || '').trim();
    const category = findVal(['category', 'cat', 'dept', 'role', 'type']) || defaultCategory;
    const photoFileName = findVal(['photo', 'image', 'picture', 'file', 'img']) || String(r[keys[2]] || '').trim();

    return {
      id: `rec_${Date.now()}_${index}`,
      rowNumber: index + 2,
      name,
      category: (category || defaultCategory).toUpperCase().trim(),
      photoFileName
    };
  });
}

/**
 * Normalized keys for a photo filename (handles double extensions like .jpg.jpeg, paths, and casing)
 */
function getBasePhotoKeys(fileName) {
  if (!fileName) return [];
  const raw = String(fileName).trim().toLowerCase();
  const keys = new Set();
  keys.add(raw);

  // Extract base filename (handles Windows \ and Unix /)
  const base = raw.replace(/^.*[\\\/]/, '').trim();
  keys.add(base);

  // Repeatedly strip image extensions (.jpg, .jpeg, .png, .webp, .heic, .heif)
  let stripped = base;
  while (/\.(jpg|jpeg|png|webp|heic|heif)$/i.test(stripped)) {
    stripped = stripped.replace(/\.(jpg|jpeg|png|webp|heic|heif)$/i, '');
    keys.add(stripped);
  }

  // Also strip copy suffixes like " (1)", "_1", etc.
  const withoutCopy = stripped.replace(/\s*\(\d+\)$/, '').replace(/_\d+$/, '');
  keys.add(withoutCopy);

  return Array.from(keys).filter(Boolean);
}

/**
 * Extract Zip Buffer into a map of { fileName: Buffer } with multi-key index
 */
function extractZipPhotos(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  const zipEntries = zip.getEntries();
  const photos = new Map();

  for (const entry of zipEntries) {
    if (!entry.isDirectory) {
      const rawEntryName = entry.entryName.replace(/\\/g, '/');
      if (rawEntryName.includes('__MACOSX') || path.basename(rawEntryName).startsWith('._')) {
        continue; // skip AppleDouble metadata
      }

      const ext = path.extname(rawEntryName).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].includes(ext) || /\.(jpg|jpeg|png|webp|heic|heif)/i.test(rawEntryName)) {
        const baseName = path.basename(rawEntryName);
        const item = {
          fileName: baseName,
          buffer: entry.getData()
        };

        const keys = getBasePhotoKeys(baseName);
        for (const k of keys) {
          photos.set(k, item);
        }
      }
    }
  }

  return photos;
}

module.exports = {
  processPhoto,
  generateCardImage,
  generateCardsPdf,
  generateExcelWithPhotos,
  parseWhatsAppChat,
  parseExcelFile,
  extractZipPhotos,
  getBasePhotoKeys
};
