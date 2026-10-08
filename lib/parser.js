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

export function parseWhatsAppChat(chatContent, defaultCategory = 'FAMILY') {
  const lines = (chatContent || '').split(/\r?\n/);
  
  const junkRegex = /Messages and calls are end-to-end encrypted|created the group|added You|left the group|security code changed|^# WhatsApp Chat Export|^Export date:|^---|^## /i;
  
  const chatterWords = new Set([
    'sado nai mukavano divy', 'sado nai mukavano', 'hn hn', 'haan', 'ha ha', 'ha', 'hn', 'na', 
    'ano avo ayo ne atale', 'badha na avaj chhe shu karu ke', 'kale joia hed ne', 'shu karu', 
    'ok', 'done', 'yes', 'no', 'thanks', 'thank you', 'theek', 'acha', 'saras', 'barobar'
  ]);

  const imageRegex = /([a-zA-Z0-9_\-–\s()]+\.(?:jpg|jpeg|png|webp|JPG|JPEG|PNG|WEBP|heic|HEIC))/i;

  const sequence = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || junkRegex.test(raw)) continue;

    let text = raw;
    const match = raw.match(/(?:\[.*?\]\s*(?:\*\*)?[^:]+(?:\*\*)?:\s*)(.*)/);
    if (match) text = match[1].trim();

    let cleaned = text
      .replace(/\[Forwarded\]/gi, '')
      .replace(/\[Document\]/gi, '')
      .replace(/<document omitted>/gi, '')
      .replace(/<image omitted>/gi, '')
      .replace(/<media omitted>/gi, '')
      .replace(/__.*?__/g, '')
      .replace(/\*\*/g, '')
      .trim();

    if (!cleaned) continue;

    const lower = cleaned.toLowerCase().trim();
    if (chatterWords.has(lower) || lower.length < 2) continue;

    const imgMatch = cleaned.match(imageRegex);
    if (imgMatch) {
      sequence.push({ type: 'photo', value: imgMatch[1].trim(), line: i + 1 });
    } else {
      if (!lower.includes('shu karu') && !lower.includes('mukavano')) {
        sequence.push({ type: 'name', value: cleaned, line: i + 1 });
      }
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
          i++;
        } else {
          pairs.push({
            id: `rec_${Date.now()}_${pairs.length}`,
            name: item.value.replace(/\.[^.]+$/, ''),
            category: defaultCategory,
            photoFileName: item.value,
            rowNumber: pairs.length + 1,
            line: item.line
          });
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
