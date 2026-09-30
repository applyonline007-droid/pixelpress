(() => {
  const $ = s => document.querySelector(s);
  const input = $('#file-input'), dropzone = $('#dropzone'), quality = $('#quality');
  const fileInfo = $('#file-info'), result = $('#result'), compress = $('#compress-btn'), toast = $('#toast');
  const outputFormat = $('#output-format'), keepSize = $('#keep-size');
  let selectedFiles = [], objectUrls = [], toastTimer;
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

  const formatBytes = bytes => {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB']; let n = bytes / 1024, i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n >= 10 ? 1 : 2)} ${units[i]}`;
  };
  const escapeHTML = text => text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function showToast(message) {
    toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3600);
  }
  function setQualityUI() {
    const n = Number(quality.value); $('#quality-value').textContent = n;
    quality.style.background = `linear-gradient(to right,#6255e8 0%,#6255e8 ${n}%,#e8eaf0 ${n}%,#e8eaf0 100%)`;
    if (n < 45) { $('#quality-label').textContent = 'Maximum savings'; $('#quality-description').textContent = 'Smaller file, with more visible changes'; }
    else if (n < 82) { $('#quality-label').textContent = 'Balanced'; $('#quality-description').textContent = 'A great balance of size and quality'; }
    else { $('#quality-label').textContent = 'High quality'; $('#quality-description').textContent = 'More detail, with a larger file'; }
  }
  function updateModeUI() {
    const isPdf = outputFormat.value === 'application/pdf';
    $('.quality-head').hidden = outputFormat.value === 'image/png';
    $('.slider').hidden = outputFormat.value === 'image/png';
    $('.range-labels').hidden = outputFormat.value === 'image/png';
    $('#target-size').disabled = outputFormat.value === 'image/png';
    $('#target-size').placeholder = outputFormat.value === 'image/png' ? 'PNG size varies' : 'e.g. 200';
    $('#quality-description').textContent = isPdf ? 'Used for images placed into the PDF' : $('#quality-description').textContent;
    if (selectedFiles.some(f => f.type === 'application/pdf') && !isPdf) $('#quality-description').textContent = 'PDF pages will be rendered as images';
    if (isPdf) compress.querySelector('span').textContent = selectedFiles.length > 1 ? 'Merge into one PDF' : 'Create PDF';
    else compress.querySelector('span').textContent = selectedFiles.length > 1 ? 'Convert files' : 'Convert image';
  }
  function renderFileList() {
    fileInfo.hidden = !selectedFiles.length;
    fileInfo.innerHTML = selectedFiles.map((f, i) => `<div class="file-info"><span class="file-name" title="${escapeHTML(f.name)}">${escapeHTML(f.name)}</span><span class="file-size">${formatBytes(f.size)}</span><button type="button" class="remove-file" data-remove="${i}" aria-label="Remove ${escapeHTML(f.name)}">×</button></div>`).join('');
    compress.disabled = !selectedFiles.length;
    $('#dropzone').classList.toggle('has-files', selectedFiles.length > 0);
    updateModeUI();
  }
  function acceptFiles(files) {
    const incoming = Array.from(files || []);
    if (!incoming.length) return;
    for (const f of incoming) {
      const ext = f.name.toLowerCase().split('.').pop();
      const type = f.type || ({pdf:'application/pdf', jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp'}[ext] || '');
      if (!allowedTypes.includes(type)) { showToast(`${f.name}: choose a JPG, PNG, WebP or PDF file.`); continue; }
      if (f.size > 20 * 1024 * 1024) { showToast(`${f.name} is over 20 MB. Choose a smaller file.`); continue; }
      if (f.size && !selectedFiles.some(existing => existing.name === f.name && existing.size === f.size)) {
        selectedFiles.push(f);
      }
    }
    renderFileList(); result.hidden = true;
  }
  function blobFromCanvas(canvas, type, q) {
    return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not encode this image in the chosen format.')), type, q));
  }
  function targetBytes() {
    const n = Number($('#target-size').value);
    if (!n) return 0;
    return n * ($('#target-unit').value === 'MB' ? 1024 * 1024 : 1024);
  }
  function outputDimensions(sourceWidth, sourceHeight) {
    if (keepSize.classList.contains('active')) return [sourceWidth, sourceHeight];
    const width = Number($('#width').value), height = Number($('#height').value);
    if (!width || !height || width < 1 || height < 1) throw new Error('Enter both output width and height.');
    const unit = $('#dimension-unit').value;
    const dpi = Math.max(72, Math.min(600, Number($('#dpi').value) || 300));
    const factor = unit === 'cm' ? dpi / 2.54 : unit === 'in' ? dpi : 1;
    return [Math.max(1, Math.round(width * factor)), Math.max(1, Math.round(height * factor))];
  }
  async function imageToCanvas(file) {
    const bitmap = await createImageBitmap(file);
    const [w, h] = outputDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const keepsAlpha = outputFormat.value === 'image/png' || outputFormat.value === 'image/webp';
    const ctx = canvas.getContext('2d', { alpha: keepsAlpha });
    if (!keepsAlpha) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    const scale = Math.min(w / bitmap.width, h / bitmap.height);
    const dw = Math.round(bitmap.width * scale), dh = Math.round(bitmap.height * scale);
    ctx.drawImage(bitmap, Math.floor((w - dw) / 2), Math.floor((h - dh) / 2), dw, dh);
    bitmap.close?.(); return canvas;
  }
  async function rasterImage(file, type, q, target) {
    const canvas = await imageToCanvas(file);
    let blob = await blobFromCanvas(canvas, type, q);
    if (target && type !== 'image/png' && blob.size > target) {
      let low = .05, high = q, best = null;
      for (let i = 0; i < 8; i++) {
        const mid = (low + high) / 2, candidate = await blobFromCanvas(canvas, type, mid);
        if (candidate.size <= target) { best = candidate; low = mid; } else high = mid;
      }
      if (best) blob = best;
    }
    return blob;
  }
  async function pdfPageCanvases(file) {
    if (!window.pdfjsLib) throw new Error('PDF tools could not load. Connect to the internet, refresh, and try again.');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const canvases = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i), base = page.getViewport({ scale: 96 / 72 });
      const [w, h] = outputDimensions(base.width, base.height);
      const viewport = page.getViewport({ scale: Math.min(w / base.width, h / base.height) });
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [1, 0, 0, 1, (w - viewport.width) / 2, (h - viewport.height) / 2] }).promise;
      canvases.push(canvas);
    }
    return canvases;
  }
  async function makePdf() {
    if (!window.PDFLib) throw new Error('PDF tools could not load. Connect to the internet, refresh, and try again.');
    const { PDFDocument } = PDFLib, out = await PDFDocument.create(), target = targetBytes();
    for (const file of selectedFiles) {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const source = await PDFDocument.load(await file.arrayBuffer()), pages = await out.copyPages(source, source.getPageIndices());
        pages.forEach(page => out.addPage(page));
      } else {
        const canvas = await imageToCanvas(file), jpeg = await blobFromCanvas(canvas, 'image/jpeg', Number(quality.value) / 100);
        const embedded = await out.embedJpg(await jpeg.arrayBuffer());
        const pageDpi = !keepSize.classList.contains('active') && $('#dimension-unit').value !== 'px' ? (Number($('#dpi').value) || 300) : 96;
        const pageWidth = embedded.width * 72 / pageDpi, pageHeight = embedded.height * 72 / pageDpi;
        const page = out.addPage([pageWidth, pageHeight]);
        page.drawImage(embedded, { x: 0, y: 0, width: pageWidth, height: pageHeight });
      }
    }
    let bytes = await out.save();
    if (target && bytes.length > target) showToast('PDF created, but its size is above the target. PDF size depends on its pages and images.');
    return new Blob([bytes], { type: 'application/pdf' });
  }
  function addDownload(blob, name, index) {
    const url = URL.createObjectURL(blob); objectUrls.push(url);
    if (index === 0) return { url, name, blob };
    const a = document.createElement('a'); a.href = url; a.download = name; a.textContent = `Download ${name} · ${formatBytes(blob.size)}`; a.className = 'extra-download'; $('#extra-downloads').append(a);
    return { url, name, blob };
  }
  async function convert() {
    if (!selectedFiles.length) return;
    const originalButton = compress.innerHTML; compress.disabled = true;
    compress.innerHTML = '<span>Working…</span><span aria-hidden="true">◌</span>';
    objectUrls.forEach(URL.revokeObjectURL); objectUrls = []; $('#extra-downloads').innerHTML = '';
    try {
      let outputs = [], type = outputFormat.value;
      if (type === 'application/pdf') {
        outputs = [{ blob: await makePdf(), name: selectedFiles.length > 1 ? 'merged-file.pdf' : `${selectedFiles[0].name.replace(/\.[^.]+$/, '')}.pdf` }];
      } else {
        let ext = type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : 'webp';
        const target = targetBytes();
        for (const file of selectedFiles) {
          if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            const canvases = await pdfPageCanvases(file);
            for (let i = 0; i < canvases.length; i++) {
              const canvas = canvases[i];
              outputs.push({ blob: await blobFromCanvas(canvas, type, Number(quality.value)/100), name: `${file.name.replace(/\.pdf$/i,'')}-page-${i+1}.${ext}` });
            }
          } else {
            outputs.push({ blob: await rasterImage(file, type, Number(quality.value)/100, target), name: `${file.name.replace(/\.[^.]+$/, '')}-converted.${ext}` });
          }
        }
      }
      if (!outputs.length) throw new Error('No pages or images were created.');
      const ready = outputs.map((o,i) => addDownload(o.blob,o.name,i));
      const first = ready[0], originalSize = selectedFiles.reduce((sum,f)=>sum+f.size,0), outputSize = outputs.reduce((sum,o)=>sum+o.blob.size,0), reduction = Math.max(0,(1-outputSize/originalSize)*100);
      $('#original-size').textContent = formatBytes(originalSize); $('#compressed-size').textContent = formatBytes(outputSize);
      $('#savings-percent').textContent = `${Math.round(reduction)}%`;
      $('#download-btn').href = first.url; $('#download-btn').download = first.name;
      $('#download-btn').querySelector('span').textContent = outputs.length > 1 ? `Download first (${outputs.length} files)` : `Download ${first.name}`;
      const target = targetBytes();
      const targetMissed = target && (outputFormat.value === 'application/pdf' ? outputSize > target : outputs.some(o => o.blob.size > target));
      const targetText = targetMissed ? `Target not reached; output size is ${formatBytes(outputSize)}.` : target ? `Target: ${$('#target-size').value} ${$('#target-unit').value}${outputs.length > 1 ? ' per image' : ''}.` : '';
      $('#format-note').textContent = outputs.length > 1 ? `${outputs.length} output files created. Additional pages are listed below. ${targetText}` : `${first.name} · processed in this browser. ${targetText}`;
      const imagePreview = $('#preview'), pdfPreview = $('#pdf-preview');
      if (type === 'application/pdf') { imagePreview.hidden=true; pdfPreview.hidden=false; pdfPreview.src=first.url; }
      else { pdfPreview.hidden=true; pdfPreview.src='about:blank'; imagePreview.hidden=false; imagePreview.src=first.url; }
      result.hidden = false; result.scrollIntoView({behavior:'smooth',block:'nearest'});
    } catch (error) { showToast(error.message || 'Could not convert these files.'); }
    finally { compress.disabled = !selectedFiles.length; compress.innerHTML = originalButton; }
  }
  function reset() {
    objectUrls.forEach(URL.revokeObjectURL); objectUrls=[]; selectedFiles=[]; input.value=''; result.hidden=true;
    $('#extra-downloads').innerHTML=''; $('#pdf-preview').src='about:blank'; $('#preview').src='';
    renderFileList(); dropzone.focus({preventScroll:true});
  }
  $('#browse-btn').addEventListener('click', e=>{e.stopPropagation();input.click()});
  dropzone.addEventListener('click', e=>{if(e.target!==$('#browse-btn'))input.click()});
  dropzone.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click()}});
  input.addEventListener('change',()=>acceptFiles(input.files));
  ['dragenter','dragover'].forEach(t=>dropzone.addEventListener(t,e=>{e.preventDefault();dropzone.classList.add('dragging')}));
  ['dragleave','drop'].forEach(t=>dropzone.addEventListener(t,e=>{e.preventDefault();dropzone.classList.remove('dragging')}));
  dropzone.addEventListener('drop',e=>acceptFiles(e.dataTransfer.files));
  fileInfo.addEventListener('click',e=>{const i=e.target.dataset.remove;if(i!==undefined){selectedFiles.splice(Number(i),1);renderFileList()}});
  quality.addEventListener('input',setQualityUI); outputFormat.addEventListener('change',updateModeUI);
  keepSize.addEventListener('click',()=>{const active=keepSize.classList.toggle('active');keepSize.textContent=active?'Keep original':'Set dimensions';keepSize.setAttribute('aria-pressed',String(active));$('#dimension-controls').hidden=active;$('#dpi-row').hidden=active||$('#dimension-unit').value==='px'});
  $('#dimension-unit').addEventListener('change',()=>{$('#dpi-row').hidden=keepSize.classList.contains('active')||$('#dimension-unit').value==='px'});
  compress.addEventListener('click',convert); $('#reset-btn').addEventListener('click',reset);
  setQualityUI(); updateModeUI();
})();
