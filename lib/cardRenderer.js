import { PDFDocument } from 'pdf-lib';

/**
 * Draws a single ID card to an HTML5 canvas at 901 x 1500 resolution
 */
export async function renderCardOnCanvas(canvas, record, templateImg, config, photoImg) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = 901;
  canvas.height = 1500;

  const cfg = Object.assign({
    photoX: 275,
    photoY: 576,
    photoW: 366,
    photoH: 406,
    nameY: 1065,
    nameFontSize: 40,
    nameColor: '#992A20',
    photoPosition: 'contain',
    photoShiftY: 0,
    photoShiftX: 0,
    photoZoom: 100
  }, config || {}, record?.config || {});

  // 1. Draw Template Background
  if (templateImg && templateImg.width) {
    ctx.drawImage(templateImg, 0, 0, 901, 1500);
  } else {
    // Default Canva Rudaah Theme
    ctx.fillStyle = '#FEF4DB';
    ctx.fillRect(0, 0, 901, 1500);

    // Maroon bottom banner shape
    ctx.fillStyle = '#992A20';
    ctx.beginPath();
    ctx.moveTo(0, 1150);
    ctx.bezierCurveTo(250, 1050, 650, 1050, 901, 1150);
    ctx.lineTo(901, 1500);
    ctx.lineTo(0, 1500);
    ctx.closePath();
    ctx.fill();

    // Rudaah Garba gold/cream text
    ctx.textAlign = 'center';
    ctx.font = 'bold 36px Cinzel, serif';
    ctx.fillStyle = '#FEF4DB';
    ctx.fillText('RUDAAH GARBA', 450, 1340);

    ctx.font = 'bold 22px Outfit, sans-serif';
    ctx.fillStyle = '#E6B800';
    ctx.fillText((record?.category || 'FAMILY').toUpperCase(), 450, 1380);

    // Top Emblem Circle
    ctx.fillStyle = '#992A20';
    ctx.beginPath();
    ctx.arc(450, 290, 120, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = 'bold 34px Cinzel, serif';
    ctx.fillStyle = '#FEF4DB';
    ctx.fillText('Rudaah', 450, 285);
    ctx.font = 'bold 22px Outfit, sans-serif';
    ctx.fillStyle = '#E6B800';
    ctx.fillText('Garba', 450, 315);
  }

  // 2. Draw Photo (Strictly bounded inside frame with cream background)
  const frameX = cfg.photoX || 275;
  const frameY = cfg.photoY || 576;
  const frameW = cfg.photoW || 366;
  const frameH = cfg.photoH || 406;

  // Cream base for photo frame
  ctx.fillStyle = '#FEF4DB';
  ctx.fillRect(frameX, frameY, frameW, frameH);

  if (photoImg && photoImg.width) {
    ctx.save();
    // Clip strictly to photo box
    ctx.beginPath();
    ctx.rect(frameX, frameY, frameW, frameH);
    ctx.clip();

    const zoomFactor = Math.max(0.4, Math.min(2.5, (cfg.photoZoom || 100) / 100));
    const shiftX = parseInt(cfg.photoShiftX || 0);
    const shiftY = parseInt(cfg.photoShiftY || 0);
    const mode = (cfg.photoPosition || 'contain').toLowerCase();

    const imgW = photoImg.width;
    const imgH = photoImg.height;

    if (mode === 'contain') {
      // 100% fit with aspect ratio
      const ratio = Math.min(frameW / imgW, frameH / imgH) * zoomFactor;
      const drawW = imgW * ratio;
      const drawH = imgH * ratio;
      const drawX = frameX + (frameW - drawW) / 2 + shiftX;
      const drawY = frameY + (frameH - drawH) / 2 + shiftY;
      ctx.drawImage(photoImg, drawX, drawY, drawW, drawH);
    } else {
      // Cover mode (smart center or top)
      const ratio = Math.max(frameW / imgW, frameH / imgH) * zoomFactor;
      const drawW = imgW * ratio;
      const drawH = imgH * ratio;
      const drawX = frameX + (frameW - drawW) / 2 + shiftX;
      let drawY = frameY + (frameH - drawH) / 2 + shiftY;
      if (mode === 'top') {
        drawY = frameY + shiftY;
      }
      ctx.drawImage(photoImg, drawX, drawY, drawW, drawH);
    }

    ctx.restore();
  }

  // 3. Clear placeholder name area and Draw Person Name
  const safeName = String(record?.name || 'NAME').toUpperCase().trim();
  const nameY = cfg.nameY || 1065;

  ctx.fillStyle = '#FEF4DB';
  ctx.fillRect(140, nameY - 48, 620, 82);

  let fontSize = cfg.nameFontSize || 40;
  if (safeName.length > 22) fontSize = Math.round(fontSize * 0.7);
  else if (safeName.length > 18) fontSize = Math.round(fontSize * 0.8);
  else if (safeName.length > 14) fontSize = Math.round(fontSize * 0.9);

  ctx.textAlign = 'center';
  ctx.font = `800 ${fontSize}px Poppins, sans-serif`;
  ctx.fillStyle = cfg.nameColor || '#992A20';
  ctx.letterSpacing = '1.5px';
  ctx.fillText(safeName, 450, nameY);
}

/**
 * Generate 300 DPI Print-Ready Multi-Page PDF Document directly in browser
 */
export async function generateCardsPdf(records, templateImg, loadPhotoFn, config, onProgress) {
  const pdfDoc = await PDFDocument.create();
  const PAGE_WIDTH_PT = 216; // 3 inches
  const PAGE_HEIGHT_PT = 360; // 5 inches

  const offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = 901;
  offscreenCanvas.height = 1500;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    let photoImg = null;

    if (loadPhotoFn) {
      try {
        photoImg = await loadPhotoFn(rec);
      } catch (e) {
        console.warn('Error loading photo for', rec.name, e);
      }
    }

    await renderCardOnCanvas(offscreenCanvas, rec, templateImg, config, photoImg);

    const dataUrl = offscreenCanvas.toDataURL('image/png');
    const imageBytes = await fetch(dataUrl).then(res => res.arrayBuffer());
    const embeddedImg = await pdfDoc.embedPng(imageBytes);

    const page = pdfDoc.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);
    page.drawImage(embeddedImg, {
      x: 0,
      y: 0,
      width: PAGE_WIDTH_PT,
      height: PAGE_HEIGHT_PT
    });

    if (onProgress) {
      onProgress(i + 1, records.length, rec);
    }
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes], { type: 'application/pdf' });
}
