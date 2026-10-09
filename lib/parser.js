/**
 * WhatsApp Chat & Photo Matching Utilities for Next.js
 */

export function getBasePhotoKeys(fileName) {
  if (!fileName) return [];
  const raw = String(fileName).trim().toLowerCase();
  const keys = new Set();
  keys.add(raw);

  const base = raw.replace(/^.*[\\\/]/, '').trim();
  keys.add(base);

  let stripped = base;
  while (/\.(jpg|jpeg|png|webp|heic|heif)$/i.test(stripped)) {
    stripped = stripped.replace(/\.(jpg|jpeg|png|webp|heic|heif)$/i, '');
    keys.add(stripped);
  }

  const withoutCopy = stripped.replace(/\s*\(\d+\)$/, '').replace(/_\d+$/, '');
  keys.add(withoutCopy);

  return Array.from(keys).filter(Boolean);
}

export function matchPhotoInCollection(targetFileName, availablePhotosMap) {
  if (!targetFileName || !availablePhotosMap) return null;
  const targetKeys = getBasePhotoKeys(targetFileName);

  for (const k of targetKeys) {
    if (availablePhotosMap.has(k)) {
      return availablePhotosMap.get(k);
    }
  }

  for (const [key, item] of availablePhotosMap.entries()) {
    const itemKeys = getBasePhotoKeys(item.fileName || key);
    for (const tk of targetKeys) {
      if (itemKeys.includes(tk)) return item;
    }
  }

  return null;
}

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

export function cleanNameCandidate(text) {
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

  // 9. Strip trailing phone numbers if attached (e.g. "Nirav Sangani 9876543210")
  str = str.replace(/(?:\+?91[\s\-]?)?[6-9]\d{9}$/, '');

  // 10. Clean punctuation at start/end
  str = str.replace(/^[\s,.:;_\-]+|[\s,.:;_\-]+$/g, '');

  // 11. Collapse multiple spaces
  str = str.replace(/\s+/g, ' ');

  return str.trim();
}

export function isValidName(str) {
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

  // Must contain at least two letters (English, Gujarati, Hindi, etc.)
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

export function parseWhatsAppChat(chatContent, defaultCategory = 'FAMILY') {
  const lines = (chatContent || '').split(/\r?\n/);
  
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

  // Pair valid names with corresponding photos (if available)
  // Non-name items are NEVER converted into records
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
        // If a photo filename appeared just before a name
        if (i + 1 < sequence.length && sequence[i + 1].type === 'name') {
          pairs.push({
            id: `rec_${Date.now()}_${pairs.length}`,
            name: sequence[i + 1].value,
            category: defaultCategory,
            photoFileName: item.value,
            rowNumber: pairs.length + 1,
            line: sequence[i + 1].line
          });
          i++; // consumed the following name
        }
        // If standalone photo without any associated name, DO NOT create a dummy record
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
