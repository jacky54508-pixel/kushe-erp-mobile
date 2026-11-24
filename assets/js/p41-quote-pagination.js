(function () {
  'use strict';

  // Presentation only. The existing renderer remains the source of every row,
  // quantity, price, total and company image. No Store or storage APIs are used.
  const jobs = new WeakMap();
  const finished = new WeakMap();
  const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

  function fail(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function removeCloneIds(node) {
    node.removeAttribute('id');
    node.querySelectorAll('[id]').forEach(child => child.removeAttribute('id'));
    return node;
  }

  function noteParagraphs(text) {
    const lines = text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g).filter(Boolean);
    const paragraphs = [];
    for (const line of lines) {
      if (/^\s*$/.test(line) && paragraphs.length) paragraphs[paragraphs.length - 1] += line;
      else paragraphs.push(line);
    }
    const grouped = [];
    for (let index = 0; index < paragraphs.length; index += 1) {
      let part = paragraphs[index];
      const heading = part.trim();
      // Keep a short clause heading with its following paragraph. Never rewrite
      // or trim the stored text; trimming here is only for heading detection.
      if (heading.length <= 96 && /^(?:[一二三四五六七八九十百]+[、．.]|第[一二三四五六七八九十百\d]+[條章節]|[（(][一二三四五六七八九十\d]+[)）])/.test(heading) && index + 1 < paragraphs.length) {
        part += paragraphs[++index];
      }
      grouped.push(part);
    }
    return grouped;
  }

  function graphemes(text) {
    if (typeof Intl.Segmenter === 'function') {
      return Array.from(new Intl.Segmenter('zh-Hant', { granularity: 'grapheme' }).segment(text), value => value.segment);
    }
    return Array.from(text);
  }

  function fitPreview(paper) {
    // Only the on-screen sheet preview adapts to a narrow viewport. Its internal
    // A4 dimensions and all print font sizes remain unchanged.
    const available = Math.max(1, document.documentElement.clientWidth - 24);
    paper.style.setProperty('--p41-preview-scale', String(Math.min(1, available / (210 * 96 / 25.4))));
  }

  async function build({ paper, noteText }) {
    if (!paper || !paper.classList.contains('quotation-document')) return { pageCount: 0, scale: 1, applied: false };
    const content = paper.querySelector('#quotationContent');
    if (!content) throw fail('QUOTATION_CONTENT_MISSING', '找不到報價單內容，請重新開啟預覽。');
    const head = content.querySelector(':scope > .head');
    const signature = content.querySelector(':scope > .sign');
    if (!head || !signature) throw fail('QUOTATION_STRUCTURE_MISSING', '報價單頁首或簽章區不完整，請重新開啟預覽。');

    const rawNote = String(noteText ?? '');
    const sourceBlocks = Array.from(content.children).filter(node => node !== head && node !== signature && !node.classList.contains('note'));
    const originalRows = Array.from(content.querySelectorAll('.detail tbody tr'));
    const headTemplate = head.cloneNode(true);
    const backup = content.cloneNode(true);
    const originalSeal = signature.querySelector('#formalCompanySeal');
    const originalLogo = head.querySelector('#formalCompanyLogo');
    const pages = [];
    let current;

    paper.classList.add('p41-quote-paginated');
    content.style.removeProperty('width');
    content.style.removeProperty('zoom');
    content.style.removeProperty('transform');
    paper.dataset.quotationScale = '1.0000';
    window.__quotationPrintScale = 1;
    fitPreview(paper);
    content.replaceChildren();

    function fits(page = current) {
      return page.body.scrollHeight <= page.body.clientHeight + 1 && page.body.scrollWidth <= page.body.clientWidth + 1;
    }

    function newPage(first = false) {
      const sheet = document.createElement('article');
      sheet.className = 'p41-quote-page';
      const body = document.createElement('div');
      body.className = 'p41-quote-page-body';
      const pageHead = first ? head : removeCloneIds(headTemplate.cloneNode(true));
      if (!first) pageHead.classList.add('p41-quote-continuation-head');
      body.appendChild(pageHead);
      const footer = document.createElement('footer');
      footer.className = 'p41-quote-page-footer';
      const context = document.createElement('span');
      context.className = 'p41-quote-footer-context';
      context.textContent = '報價文件';
      const counter = document.createElement('span');
      counter.className = 'p41-quote-page-number';
      footer.append(context, counter);
      sheet.append(body, footer);
      content.appendChild(sheet);
      current = { sheet, body, context, counter };
      pages.push(current);
      if (body.clientHeight < 100 || body.clientWidth < 100) throw fail('QUOTATION_MEASUREMENT_UNAVAILABLE', '無法確認 A4 版面尺寸，請重新開啟預覽。');
      if (!fits()) throw fail('QUOTATION_HEADER_TOO_LARGE', '公司頁首超過 A4 可列印範圍，請檢查頁首文字。');
      return current;
    }

    function appendBlock(node) {
      current.body.appendChild(node);
      if (fits()) return;
      node.remove();
      newPage();
      current.body.appendChild(node);
      if (!fits()) throw fail('QUOTATION_BLOCK_TOO_LARGE', '報價內容區塊超過一頁，請檢查過長的欄位文字。');
    }

    function appendDetail(section) {
      const table = section.querySelector('table.detail');
      if (!table) return appendBlock(section);
      const rows = Array.from(table.querySelectorAll('tbody > tr'));
      let fragment;
      let tbody;
      function startFragment() {
        fragment = removeCloneIds(section.cloneNode(false));
        for (const child of section.children) {
          if (child !== table) fragment.appendChild(removeCloneIds(child.cloneNode(true)));
        }
        const copy = removeCloneIds(table.cloneNode(false));
        for (const child of table.children) {
          if (child.tagName !== 'TBODY') copy.appendChild(removeCloneIds(child.cloneNode(true)));
        }
        tbody = document.createElement('tbody');
        copy.appendChild(tbody);
        fragment.appendChild(copy);
        current.body.appendChild(fragment);
      }
      startFragment();
      for (const row of rows) {
        tbody.appendChild(row);
        if (fits()) continue;
        row.remove();
        if (!tbody.children.length) fragment.remove();
        newPage();
        startFragment();
        tbody.appendChild(row);
        if (!fits()) throw fail('QUOTATION_ROW_TOO_LARGE', '單一施工明細列超過一頁，請縮短該列品名或分成多列後再匯出。');
      }
      if (!rows.length && !fits()) throw fail('QUOTATION_TABLE_TOO_LARGE', '報價明細表超過 A4 版面。');
    }

    function makeNoteBox(continued = false) {
      const box = document.createElement('section');
      box.className = 'note p41-quote-notes';
      const title = document.createElement('div');
      title.className = 'p41-quote-notes-heading';
      title.textContent = continued ? '備註（續）：' : '備註：';
      box.appendChild(title);
      return box;
    }

    function noteFragment(text) {
      const paragraph = document.createElement('div');
      paragraph.className = 'p41-quote-note-text';
      paragraph.setAttribute('data-quote-note-fragment', '');
      paragraph.textContent = text;
      return paragraph;
    }

    function appendNotesAndSignature() {
      if (!rawNote) return appendBlock(signature);
      const chunks = noteParagraphs(rawNote);
      const complete = makeNoteBox();
      chunks.forEach(text => complete.appendChild(noteFragment(text)));
      current.body.append(complete, signature);
      if (fits()) return; // A short note stays on the current page with its seal.
      complete.remove();
      signature.remove();
      pages[0].context.textContent = '詳細備註與簽章見續頁';

      let box;
      let notePageCount = 0;
      function nextNotePage() {
        newPage();
        box = makeNoteBox(notePageCount++ > 0);
        current.body.appendChild(box);
      }
      nextNotePage();
      const pending = chunks.slice();
      while (pending.length) {
        const text = pending[0];
        const last = pending.length === 1;
        const part = noteFragment(text);
        const priorParts = box.querySelectorAll('[data-quote-note-fragment]').length;
        box.appendChild(part);
        if (last) current.body.appendChild(signature);
        if (fits()) {
          pending.shift();
          continue;
        }
        part.remove();
        signature.remove();
        if (priorParts) {
          nextNotePage(); // Prefer a complete paragraph on the next sheet.
          continue;
        }

        // A paragraph taller than a sheet may be split, but its exact text is
        // retained. The final fragment shares a page with the original seal.
        const units = graphemes(text);
        let low = 1;
        let high = units.length;
        if (last) {
          // Keep meaningful final text with the seal, not just trailing blanks.
          const meaningful = units.map((unit, index) => /\S/.test(unit) ? index : -1).filter(index => index >= 0);
          high = meaningful.length > 1 ? meaningful[Math.max(1, meaningful.length - 24)] : Math.max(0, units.length - 1);
        }
        let best = 0;
        box.appendChild(part);
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          part.textContent = units.slice(0, middle).join('');
          if (fits()) { best = middle; low = middle + 1; }
          else high = middle - 1;
        }
        if (!best) throw fail('QUOTATION_NOTE_TOO_LARGE', '備註無法在 A4 版面中完整顯示，請重新開啟預覽。');
        // Prefer the nearest sentence/word boundary without dropping a single
        // separator or changing numbering. A long unbroken string still wraps.
        for (let cursor = best; cursor >= Math.ceil(best * 0.65); cursor -= 1) {
          if (/[\s，。；！？、,.;!?]/.test(units[cursor - 1])) { best = cursor; break; }
        }
        part.textContent = units.slice(0, best).join('');
        pending[0] = units.slice(best).join('');
        if (!pending[0]) pending.shift();
        nextNotePage();
      }
    }

    try {
      newPage(true);
      for (const node of sourceBlocks) {
        if (node.querySelector('table.detail')) appendDetail(node);
        else appendBlock(node);
      }
      appendNotesAndSignature();
      const renderedRows = Array.from(content.querySelectorAll('.detail tbody tr'));
      if (renderedRows.length !== originalRows.length || renderedRows.some((row, index) => row !== originalRows[index])) {
        throw fail('QUOTATION_ROW_PRESERVATION_FAILED', '報價明細分頁核對失敗，已停止列印。');
      }
      const renderedNote = Array.from(content.querySelectorAll('[data-quote-note-fragment]')).map(node => node.textContent).join('');
      if (renderedNote !== rawNote) throw fail('QUOTATION_NOTE_PRESERVATION_FAILED', '備註內容分頁核對失敗，已停止列印。');
      if (document.querySelectorAll('#formalCompanyLogo').length !== 1 || document.querySelectorAll('#formalCompanySeal').length !== 1 ||
          document.getElementById('formalCompanyLogo') !== originalLogo || document.getElementById('formalCompanySeal') !== originalSeal) {
        throw fail('QUOTATION_ASSET_PRESERVATION_FAILED', '公司圖片分頁核對失敗，已停止列印。');
      }
      await Promise.all(Array.from(content.querySelectorAll('img')).filter(image => image.src).map(async image => {
        if (typeof image.decode === 'function') await image.decode();
      }));
      await nextFrame();
      for (const [index, page] of pages.entries()) {
        page.sheet.dataset.quotePage = String(index + 1);
        page.sheet.setAttribute('aria-label', `報價單第 ${index + 1} 頁，共 ${pages.length} 頁`);
        page.counter.textContent = `第 ${index + 1} 頁 / 共 ${pages.length} 頁`;
        if (!fits(page)) throw fail('QUOTATION_PAGE_OVERFLOW', '分頁後內容超出 A4 範圍，已停止列印。');
      }
      paper.dataset.quotationPages = String(pages.length);
      if (!paper.dataset.p41ResizeBound) {
        paper.dataset.p41ResizeBound = 'true';
        window.addEventListener('resize', () => fitPreview(paper), { passive: true });
      }
      const result = { applied: true, pageCount: pages.length, scale: 1, noteTextPreserved: true, rowsPreserved: originalRows.length };
      finished.set(paper, { noteText: rawNote, result });
      window.__quotationPagination = result;
      return result;
    } catch (error) {
      // Restore a complete readable source for diagnosis. The caller keeps its
      // existing print-ready gate closed when pagination rejects.
      content.replaceChildren(...Array.from(backup.childNodes));
      paper.classList.remove('p41-quote-paginated');
      throw error;
    }
  }

  function paginate(options = {}) {
    const paper = options.paper || document.getElementById('paper');
    if (!paper || !paper.classList.contains('quotation-document')) return Promise.resolve({ applied: false, pageCount: 0, scale: 1 });
    const noteText = String(options.noteText ?? '');
    const prior = finished.get(paper);
    if (prior) {
      if (prior.noteText !== noteText) return Promise.reject(fail('QUOTATION_SOURCE_CHANGED', '報價內容已變更，請重新開啟預覽。'));
      return Promise.resolve(prior.result);
    }
    if (jobs.has(paper)) return jobs.get(paper);
    const job = build({ paper, noteText }).finally(() => jobs.delete(paper));
    jobs.set(paper, job);
    return job;
  }

  window.KusheQuotePagination = Object.freeze({ paginate, splitNoteParagraphs: noteParagraphs });
}());
