(function () {
  'use strict';

  // Presentation only. The existing renderer remains the source of every row,
  // quantity, price, total and company image. No Store or storage APIs are used.
  const jobs = new WeakMap();
  const finished = new WeakMap();
  const previews = new WeakMap();
  const noteSources = new WeakMap();
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

  function sourceLines(text) {
    const lines = [];
    const pattern = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
    for (const match of text.matchAll(pattern)) {
      if (!match[0]) continue;
      const newline = match[0].match(/(?:\r\n|\r|\n)$/);
      lines.push({ start: match.index, end: match.index + match[0].length,
        bodyEnd: match.index + match[0].length - (newline ? newline[0].length : 0) });
    }
    return lines;
  }

  function textRuns(text) {
    const runs = [];
    let cursor = 0;
    const escaped = index => {
      let count = 0;
      while (index > 0 && text[--index] === '\\') count += 1;
      return count % 2 === 1;
    };
    for (const match of text.matchAll(/\*\*([^*\s](?:[^*\r\n]*[^*\s])?)\*\*/g)) {
      const start = match.index;
      const end = start + match[0].length;
      if (text[start - 1] === '*' || text[end] === '*' || escaped(start) || escaped(end - 2)) continue;
      if (start > cursor) runs.push({ start: cursor, end: start, kind: 'text' });
      runs.push({ start, end: start + 2, kind: 'marker' });
      runs.push({ start: start + 2, end: end - 2, kind: 'strong' });
      runs.push({ start: end - 2, end, kind: 'marker' });
      cursor = end;
    }
    if (cursor < text.length) runs.push({ start: cursor, end: text.length, kind: 'text' });
    return runs;
  }

  function visibleSlice(text, runs, start, end) {
    return runs.filter(run => run.kind !== 'marker' && run.end > start && run.start < end)
      .map(run => text.slice(Math.max(start, run.start), Math.min(end, run.end))).join('');
  }

  function isClauseHeading(text) {
    return text.length <= 96 && /^(?:[一二三四五六七八九十百]+[、．.]|第[一二三四五六七八九十百\d]+[條章節]|[（(][一二三四五六七八九十\d]+[)）])/.test(text);
  }

  function isTermsTitle(text) {
    return /^工程請款[及與]付款(?:約定)?條款[：:]?$/.test(text);
  }

  function paragraphRanges(text, runs, lines, start, end, role) {
    if (start >= end) return [];
    const pieces = [];
    let leading = start;
    for (const line of lines) {
      if (line.end <= start || line.start >= end) continue;
      const first = Math.max(line.start, start);
      const last = Math.min(line.end, end);
      const label = visibleSlice(text, runs, first, Math.min(line.bodyEnd, last)).trim();
      if (!label) {
        if (pieces.length) pieces[pieces.length - 1].end = last;
        continue;
      }
      pieces.push({ start: pieces.length ? first : leading, end: last, role, heading: isClauseHeading(label) || isTermsTitle(label) });
    }
    if (!pieces.length) return [{ start, end, role }];
    pieces[pieces.length - 1].end = end;
    const grouped = [];
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = { ...pieces[index] };
      while (pieces[index].heading && index + 1 < pieces.length) piece.end = pieces[++index].end;
      grouped.push(piece);
    }
    return grouped;
  }

  function analyzeNote(text) {
    text = String(text ?? '');
    const lines = sourceLines(text);
    const runs = textRuns(text);
    const label = line => visibleSlice(text, runs, line.start, line.bodyEnd).trim();
    const titles = lines.filter(line => isTermsTitle(label(line)));
    let title = titles.length === 1 ? titles[0] : null;
    let supplementStart = text.length;
    if (title) {
      // Only a short, contiguous suffix with these explicit labels may move.
      // Unrecognized lines remain in their exact source order.
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (line.start <= title.start) break;
        const value = label(line);
        if (!value) continue;
        if (value.length <= 96 && (/^特殊品項/.test(value) || /^非人為[^\r\n。；]{0,24}保固/.test(value))) supplementStart = line.start;
        else break;
      }
      if (!/\S/.test(visibleSlice(text, runs, title.end, supplementStart))) title = null;
    }
    const mode = title ? 'contract' : 'generic';
    const scope = title ? paragraphRanges(text, runs, lines, 0, title.start, 'scope') : [];
    const supplements = title && supplementStart < text.length ? paragraphRanges(text, runs, lines, supplementStart, text.length, 'supplement') : [];
    const terms = title ? paragraphRanges(text, runs, lines, title.start, supplementStart, 'terms') : [];
    const generic = title ? [] : paragraphRanges(text, runs, lines, 0, text.length, 'generic');
    return { text, mode, lines, runs, title, titleText: title ? label(title) : '', scope, supplements, terms, generic };
  }

  function getSourceNotes(paper = document.getElementById('paper')) {
    if (!paper) return [];
    return Array.from(paper.querySelectorAll('[data-quote-note-fragment]')).map(node => {
      const source = noteSources.get(node);
      if (!source) throw fail('QUOTATION_NOTE_SOURCE_MISSING', '備註來源核對失敗，已停止列印。');
      return { ...source, visibleText: node.textContent,
        page: Number(node.closest('.p41-quote-page')?.dataset.quotePage || 0) };
    });
  }

  function attachPreview(paper) {
    let preview = previews.get(paper);
    if (!preview) {
      preview = document.createElement('div');
      preview.className = 'p41-quote-preview';
      paper.before(preview);
      preview.appendChild(paper);
      previews.set(paper, preview);
    }
    return preview;
  }

  function fitPreview(paper) {
    const preview = previews.get(paper);
    if (!preview || !paper.isConnected) return;
    // Transform the finished sheets as a single visual preview. Unlike CSS
    // zoom, this never changes table borders, line boxes or page-break layout.
    // The wrapper removes only the untransformed scroll footprint; its bounds
    // include every transformed sheet, including all notes and the final seal.
    const available = Math.max(1, document.documentElement.clientWidth - 24);
    const style = getComputedStyle(paper);
    const width = Math.max(parseFloat(style.width) || 0, paper.scrollWidth, paper.offsetWidth);
    const height = Math.max(parseFloat(style.height) || 0, paper.scrollHeight, paper.offsetHeight);
    if (!width || !height) throw fail('QUOTATION_PREVIEW_SIZE_UNAVAILABLE', '無法確認報價預覽尺寸，請重新開啟預覽。');
    const scale = Math.min(1, available / width);
    preview.style.width = `${Math.ceil(width * scale)}px`;
    preview.style.height = `${Math.ceil(height * scale)}px`;
    paper.style.setProperty('--p41-preview-scale', String(scale));
  }

  function previewContainsSheets(paper) {
    const preview = previews.get(paper);
    if (!preview) return false;
    const outer = preview.getBoundingClientRect();
    return Array.from(paper.querySelectorAll('.p41-quote-page')).every(sheet => {
      const rect = sheet.getBoundingClientRect();
      return rect.left >= outer.left - 0.5 && rect.right <= outer.right + 0.5 &&
        rect.top >= outer.top - 0.5 && rect.bottom <= outer.bottom + 0.5;
    });
  }

  async function build({ paper, noteText }) {
    if (!paper || !paper.classList.contains('quotation-document')) return { pageCount: 0, scale: 1, applied: false };
    const content = paper.querySelector('#quotationContent');
    if (!content) throw fail('QUOTATION_CONTENT_MISSING', '找不到報價單內容，請重新開啟預覽。');
    const head = content.querySelector(':scope > .head');
    const signature = content.querySelector(':scope > .sign');
    if (!head || !signature) throw fail('QUOTATION_STRUCTURE_MISSING', '報價單頁首或簽章區不完整，請重新開啟預覽。');

    const rawNote = String(noteText ?? '');
    let sourceBlocks;
    const originalRows = Array.from(content.querySelectorAll('.detail tbody tr'));
    let headTemplate;
    const backup = content.cloneNode(true);
    const noteModel = analyzeNote(rawNote);
    const originalSeal = signature.querySelector('#formalCompanySeal');
    const originalLogo = head.querySelector('#formalCompanyLogo');
    const originalPricing = content.querySelector(':scope > .actual-pricing-label');
    const contextTemplate = document.createElement('div');
    contextTemplate.className = 'p41-quote-contract-context';
    content.querySelectorAll(':scope > .info > div').forEach(node => {
      if (['案場', '日期'].includes(node.querySelector('.label')?.textContent.trim())) contextTemplate.appendChild(removeCloneIds(node.cloneNode(true)));
    });
    const pages = [];
    let current;

    paper.classList.add('p41-quote-paginated');
    content.style.removeProperty('width');
    content.style.removeProperty('zoom');
    content.style.removeProperty('transform');
    paper.dataset.quotationScale = '1.0000';
    window.__quotationPrintScale = 1;
    // Paginate at the physical print scale. The eventual screen transform
    // changes only the preview's painted size, never its layout dimensions.
    paper.style.setProperty('--p41-preview-scale', '1');

    function preparePresentation() {
      head.classList.add('p41-quote-contract-head');
      const title = head.querySelector('.doc-title h2');
      if (title && ['報價單', '工程報價單', '請款單'].includes(title.textContent.trim())) title.textContent = '工程報價單';
      const subtitle = document.createElement('div');
      subtitle.className = 'p41-quote-contract-subtitle';
      subtitle.textContent = '施工明細與範圍';
      head.querySelector('.doc-title')?.appendChild(subtitle);
      const sectionTitle = content.querySelector('section:has(table.detail) > .section-title');
      if (sectionTitle) {
        const label = document.createElement('span');
        label.className = 'p41-quote-section-label';
        label.textContent = sectionTitle.textContent;
        sectionTitle.replaceChildren(label);
        if (originalPricing) sectionTitle.appendChild(originalPricing);
      }
      signature.classList.add('p41-quote-contract-sign');
      for (const node of signature.querySelectorAll(':scope > .client-sign, :scope > .company-seals')) {
        const date = document.createElement('div');
        date.className = 'p41-quote-sign-date';
        date.textContent = '簽署日期：　　年　　月　　日';
        node.appendChild(date);
      }
      sourceBlocks = Array.from(content.children).filter(node => node !== head && node !== signature && !node.classList.contains('note'));
      headTemplate = head.cloneNode(true);
      paper.dataset.quotationNoteMode = noteModel.mode;
    }

    function fits(page = current) {
      // The inner flow has its natural height, unlike a fixed-height body's
      // scrollHeight (which is at least clientHeight even for short content).
      // Keep 4 mm of breathing space inside the printable body. Screen preview
      // transforms leave these dimensions unchanged at every viewport width.
      const reserve = 4 * 96 / 25.4;
      return page.body.scrollHeight <= page.frame.clientHeight - reserve &&
        page.body.scrollWidth <= page.frame.clientWidth + 1;
    }

    function newPage(first = false, role = 'details') {
      const sheet = document.createElement('article');
      sheet.className = `p41-quote-page ${first ? 'p41-quote-first-page' : 'p41-quote-continuation-page'}`;
      if (role === 'terms') sheet.classList.add('p41-quote-terms-page');
      sheet.dataset.quoteSection = role;
      const frame = document.createElement('div');
      frame.className = 'p41-quote-page-body';
      const body = document.createElement('div');
      body.className = 'p41-quote-page-flow';
      const pageHead = first ? head : removeCloneIds(headTemplate.cloneNode(true));
      if (!first) {
        pageHead.classList.add('p41-quote-continuation-head');
        pageHead.querySelector('.p41-quote-contract-subtitle')?.remove();
      }
      body.appendChild(pageHead);
      if (!first && contextTemplate.children.length) body.appendChild(contextTemplate.cloneNode(true));
      const footer = document.createElement('footer');
      footer.className = 'p41-quote-page-footer';
      const context = document.createElement('span');
      context.className = 'p41-quote-footer-context';
      context.textContent = '報價文件';
      const counter = document.createElement('span');
      counter.className = 'p41-quote-page-number';
      footer.append(context, counter);
      frame.appendChild(body);
      sheet.append(frame, footer);
      content.appendChild(sheet);
      current = { sheet, body, frame, context, counter };
      pages.push(current);
      if (frame.clientHeight < 100 || frame.clientWidth < 100) throw fail('QUOTATION_MEASUREMENT_UNAVAILABLE', '無法確認 A4 版面尺寸，請重新開啟預覽。');
      if (!fits()) throw fail('QUOTATION_HEADER_TOO_LARGE', '公司頁首超過 A4 可列印範圍，請檢查頁首文字。');
      return current;
    }

    function appendBlock(node) {
      current.body.appendChild(node);
      if (fitsFinalBlock(node)) return;
      node.remove();
      newPage();
      current.body.appendChild(node);
      if (!fitsFinalBlock(node)) throw fail('QUOTATION_BLOCK_TOO_LARGE', '報價內容區塊超過一頁，請檢查過長的欄位文字。');
    }

    function fitsFinalBlock(node, finalPart = true) {
      if (finalPart && node !== signature && node === sourceBlocks[sourceBlocks.length - 1] &&
          !/\S/.test(visibleSlice(rawNote, noteModel.runs, 0, rawNote.length))) {
        current.body.appendChild(signature);
        const result = fits();
        signature.remove();
        return result;
      }
      return fits();
    }

    function appendDetail(section) {
      const table = section.querySelector('table.detail');
      if (!table) return appendBlock(section);
      const rows = Array.from(table.querySelectorAll('tbody > tr'));
      const ornaments = Array.from(section.children).filter(node => node !== table);
      const ornamentTemplates = ornaments.map(node => node.cloneNode(true));
      let firstFragment = true;
      let fragmentUsesOriginal = false;
      let fragment;
      let tbody;
      function startFragment() {
        fragmentUsesOriginal = firstFragment;
        fragment = removeCloneIds(section.cloneNode(false));
        ornaments.forEach((child, index) => {
          const ornament = firstFragment ? child : removeCloneIds(ornamentTemplates[index].cloneNode(true));
          if (!firstFragment) ornament.querySelectorAll('.actual-pricing-label').forEach(node => node.remove());
          fragment.appendChild(ornament);
        });
        firstFragment = false;
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
      for (const [index, row] of rows.entries()) {
        tbody.appendChild(row);
        if (fitsFinalBlock(section, index === rows.length - 1)) continue;
        row.remove();
        if (!tbody.children.length) {
          fragment.remove();
          if (fragmentUsesOriginal) firstFragment = true;
        }
        newPage();
        startFragment();
        tbody.appendChild(row);
        if (!fitsFinalBlock(section, index === rows.length - 1)) throw fail('QUOTATION_ROW_TOO_LARGE', '單一施工明細列超過一頁，請縮短該列品名或分成多列後再匯出。');
      }
      if (!rows.length && !fits()) throw fail('QUOTATION_TABLE_TOO_LARGE', '報價明細表超過 A4 版面。');
    }

    function makeNoteBox(role = 'generic', continued = false) {
      const box = document.createElement('section');
      box.className = `note p41-quote-notes p41-quote-${role}`;
      if (role !== 'terms' || continued) {
        const title = document.createElement('div');
        title.className = 'p41-quote-notes-heading';
        title.textContent = role === 'scope' ? `施工範圍與補充說明${continued ? '（續）' : ''}` :
          role === 'terms' ? `${noteModel.titleText}（續）` : continued ? '備註（續）：' : '備註：';
        box.appendChild(title);
      }
      return box;
    }

    function setNoteFragment(paragraph, chunk) {
      const source = { start: chunk.start, end: chunk.end, rawText: rawNote.slice(chunk.start, chunk.end), role: chunk.role };
      noteSources.set(paragraph, source);
      paragraph.setAttribute('data-quote-source-start', String(chunk.start));
      paragraph.setAttribute('data-quote-source-end', String(chunk.end));
      paragraph.setAttribute('data-quote-note-role', chunk.role);
      paragraph.replaceChildren();
      function appendRange(target, start, end) {
        for (const run of noteModel.runs) {
          if (run.kind === 'marker' || run.end <= start || run.start >= end) continue;
          const text = document.createTextNode(rawNote.slice(Math.max(start, run.start), Math.min(end, run.end)));
          if (run.kind === 'strong') {
            const bold = document.createElement('strong');
            bold.appendChild(text);
            target.appendChild(bold);
          } else target.appendChild(text);
        }
      }
      for (const line of noteModel.lines) {
        if (line.end <= chunk.start || line.start >= chunk.end) continue;
        const start = Math.max(line.start, chunk.start);
        const end = Math.min(line.bodyEnd, chunk.end);
        const visible = visibleSlice(rawNote, noteModel.runs, start, end);
        const label = visibleSlice(rawNote, noteModel.runs, line.start, line.bodyEnd).trim();
        if (/\S/.test(visible)) {
          const isTitle = noteModel.title && line.start === noteModel.title.start;
          const lineNode = document.createElement(isClauseHeading(label) ? 'strong' : 'span');
          lineNode.className = 'p41-quote-note-line';
          if (isClauseHeading(label)) lineNode.classList.add('p41-quote-clause-heading');
          if (isTitle) lineNode.classList.add('p41-quote-contract-title');
          appendRange(lineNode, start, end);
          paragraph.appendChild(lineNode);
        } else appendRange(paragraph, start, end);
        const newlineStart = Math.max(line.bodyEnd, chunk.start);
        const newlineEnd = Math.min(line.end, chunk.end);
        if (newlineEnd > newlineStart) paragraph.appendChild(document.createTextNode(rawNote.slice(newlineStart, newlineEnd)));
      }
      paragraph.classList.toggle('p41-quote-whitespace', !/\S/.test(paragraph.textContent));
      paragraph.classList.toggle('p41-quote-supplement', chunk.role === 'supplement');
    }

    function noteFragment(chunk) {
      const paragraph = document.createElement('div');
      paragraph.className = 'p41-quote-note-text';
      paragraph.setAttribute('data-quote-note-fragment', '');
      setNoteFragment(paragraph, chunk);
      return paragraph;
    }

    function appendNoteChunks(chunks, role, withSignature = false, forceNew = false) {
      if (!chunks.length) {
        if (withSignature) appendBlock(signature);
        return;
      }
      const hasText = chunks.some(chunk => /\S/.test(visibleSlice(rawNote, noteModel.runs, chunk.start, chunk.end)));
      if (!hasText) {
        chunks.forEach(chunk => current.body.appendChild(noteFragment(chunk)));
        if (withSignature) appendBlock(signature);
        return;
      }

      const complete = makeNoteBox(role);
      chunks.forEach(chunk => complete.appendChild(noteFragment(chunk)));
      current.body.appendChild(complete);
      if (withSignature) current.body.appendChild(signature);
      if (!forceNew && fits()) return;
      complete.remove();
      signature.remove();

      let box;
      let notePageCount = 0;
      function startNotePage(fresh = true) {
        if (fresh) newPage(false, role);
        box = makeNoteBox(role, notePageCount++ > 0);
        current.body.appendChild(box);
      }
      startNotePage(forceNew || role === 'generic');
      const pending = chunks.map(chunk => ({ ...chunk }));
      while (pending.length) {
        const chunk = pending[0];
        const last = withSignature && pending.length === 1;
        const part = noteFragment(chunk);
        const priorParts = box.querySelectorAll('[data-quote-note-fragment]').length;
        box.appendChild(part);
        if (last) current.body.appendChild(signature);
        if (fits()) {
          pending.shift();
          continue;
        }
        part.remove();
        signature.remove();
        const otherContent = Array.from(current.body.children).some(node => node !== box &&
          !node.classList.contains('head') && !node.classList.contains('p41-quote-contract-context') &&
          !node.classList.contains('p41-quote-whitespace'));
        if (priorParts || otherContent) {
          if (!priorParts) {
            box.remove();
            notePageCount -= 1;
          }
          startNotePage(); // Prefer an intact paragraph on the next sheet.
          continue;
        }

        // Split only an oversized paragraph. Formatting is derived from global
        // source ranges, so cutting inside **bold** never loses delimiters or
        // changes the visible text. The last meaningful text stays with seals.
        const text = rawNote.slice(chunk.start, chunk.end);
        const units = graphemes(text);
        const ends = [];
        let offset = chunk.start;
        const meaningful = [];
        units.forEach((unit, index) => {
          const end = offset + unit.length;
          if (/\S/.test(visibleSlice(rawNote, noteModel.runs, offset, end))) meaningful.push(index);
          ends.push(end);
          offset = end;
        });
        let low = 1;
        let high = last ? (meaningful.length > 1 ? meaningful[Math.max(1, meaningful.length - 24)] : 0) : units.length;
        let best = 0;
        box.appendChild(part);
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          setNoteFragment(part, { ...chunk, end: ends[middle - 1] });
          if (fits()) { best = middle; low = middle + 1; }
          else high = middle - 1;
        }
        if (!best) throw fail('QUOTATION_NOTE_TOO_LARGE', '備註無法在 A4 版面中完整顯示，請重新開啟預覽。');
        for (let cursor = best; cursor >= Math.ceil(best * 0.65); cursor -= 1) {
          if (/[\s，。；！？、,.;!?]/.test(units[cursor - 1])) { best = cursor; break; }
        }
        const cut = ends[best - 1];
        setNoteFragment(part, { ...chunk, end: cut });
        pending[0] = { ...chunk, start: cut };
        if (cut === chunk.end) pending.shift();
        if (pending.length) startNotePage();
      }
    }

    function appendNotesAndSignature() {
      if (noteModel.mode === 'contract') {
        appendNoteChunks([...noteModel.scope, ...noteModel.supplements], 'scope');
        pages[0].context.textContent = '付款約定及簽章詳續頁';
        // A scope continuation is already a new sheet. Let payment clauses use
        // its remaining space instead of stranding two short supplements on a
        // mostly empty sheet. The grouped title + first clause body must still
        // fit intact; a scope on the details sheet keeps a separate terms page.
        const shareScopeContinuation = pages.length > 1 && current.sheet.dataset.quoteSection === 'scope';
        appendNoteChunks(noteModel.terms, 'terms', true, !shareScopeContinuation);
      } else {
        appendNoteChunks(noteModel.generic, 'generic', true);
        if (pages.length > 1) pages[0].context.textContent = '完整內容與簽章見續頁';
      }
    }

    try {
      preparePresentation();
      content.replaceChildren();
      newPage(true);
      for (const node of sourceBlocks) {
        if (node.querySelector('table.detail')) appendDetail(node);
        else appendBlock(node);
      }
      appendNotesAndSignature();
      for (const page of pages) {
        page.sheet.classList.toggle('p41-quote-terms-page',
          Boolean(page.body.querySelector('.p41-quote-terms [data-quote-note-fragment]')));
      }
      const renderedRows = Array.from(content.querySelectorAll('.detail tbody tr'));
      if (renderedRows.length !== originalRows.length || renderedRows.some((row, index) => row !== originalRows[index])) {
        throw fail('QUOTATION_ROW_PRESERVATION_FAILED', '報價明細分頁核對失敗，已停止列印。');
      }
      const sources = getSourceNotes(paper).sort((left, right) => left.start - right.start);
      let sourceEnd = 0;
      for (const source of sources) {
        if (source.start !== sourceEnd || source.end <= source.start || source.end > rawNote.length ||
            source.rawText !== rawNote.slice(source.start, source.end) ||
            source.visibleText !== visibleSlice(rawNote, noteModel.runs, source.start, source.end)) {
          throw fail('QUOTATION_NOTE_PRESERVATION_FAILED', '備註來源或顯示內容分頁核對失敗，已停止列印。');
        }
        sourceEnd = source.end;
      }
      if (sourceEnd !== rawNote.length || sources.map(source => source.rawText).join('') !== rawNote) {
        throw fail('QUOTATION_NOTE_PRESERVATION_FAILED', '備註內容分頁核對失敗，已停止列印。');
      }
      if (originalPricing && (!content.contains(originalPricing) || content.querySelectorAll('.actual-pricing-label').length !== 1)) {
        throw fail('QUOTATION_PRICING_LABEL_PRESERVATION_FAILED', '計價方式顯示核對失敗，已停止列印。');
      }
      if (!content.contains(signature)) throw fail('QUOTATION_SIGNATURE_MISSING', '簽章區分頁核對失敗，已停止列印。');
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
      attachPreview(paper);
      fitPreview(paper);
      await nextFrame();
      for (const page of pages) {
        if (page.frame.scrollHeight > page.frame.clientHeight + 1 || page.frame.scrollWidth > page.frame.clientWidth + 1) {
          throw fail('QUOTATION_PREVIEW_OVERFLOW', '報價預覽超出 A4 範圍，已停止列印。');
        }
      }
      if (!previewContainsSheets(paper)) {
        throw fail('QUOTATION_PREVIEW_CLIPPED', '報價預覽未完整顯示所有頁面，已停止列印。');
      }
      paper.dataset.quotationPages = String(pages.length);
      if (!paper.dataset.p41ResizeBound) {
        paper.dataset.p41ResizeBound = 'true';
        window.addEventListener('resize', () => fitPreview(paper), { passive: true });
        window.addEventListener('afterprint', () => fitPreview(paper));
      }
      const result = { applied: true, pageCount: pages.length, scale: 1, noteTextPreserved: true,
        noteMode: noteModel.mode, sourceOffsetsPreserved: true, rowsPreserved: originalRows.length };
      finished.set(paper, { noteText: rawNote, result });
      window.__quotationPagination = result;
      return result;
    } catch (error) {
      // Restore a complete readable source for diagnosis. The caller keeps its
      // existing print-ready gate closed when pagination rejects.
      content.replaceChildren(...Array.from(backup.childNodes));
      paper.classList.remove('p41-quote-paginated');
      delete paper.dataset.quotationNoteMode;
      paper.style.removeProperty('--p41-preview-scale');
      const preview = previews.get(paper);
      if (preview) {
        preview.replaceWith(paper);
        previews.delete(paper);
      }
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

  window.KusheQuotePagination = Object.freeze({ paginate, splitNoteParagraphs: noteParagraphs, analyzeNote, getSourceNotes });
}());
