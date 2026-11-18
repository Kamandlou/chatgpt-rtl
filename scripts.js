/**
 * ChatGPT RTL - Content Script
 * Intelligent, real-time RTL/LTR direction manager for ChatGPT.
 * Supports all RTL languages (Hebrew, Arabic, Persian, Urdu, etc.),
 * dynamic streaming detection, LTR isolation for math & code,
 * and seamless input direction switching with keyboard shortcuts.
 */

(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. Unicode Directional Matchers
  // ---------------------------------------------------------------------------
  // Covers Hebrew, Arabic, Persian/Farsi, Urdu, Pashto, Yiddish, Syriac, Thaana
  const RTL_CHAR_REGEX = /[\u0590-\u05FF\uFB1D-\uFB4F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0700-\u074F\u0780-\u07BF]/g;
  // Standard LTR characters (Latin, Cyrillic, Greek, etc.)
  const LTR_CHAR_REGEX = /[a-zA-Z\u00C0-\u024F\u0400-\u04FF\u0370-\u03FF]/g;

  // Extension Settings (sync with chrome.storage)
  let settings = {
    autoDetectResponse: true,
    autoDetectInput: true,
    forceCodeMathLTR: true,
    useVazirmatn: false,
    defaultInputDirection: 'auto'
  };

  // State
  let manualInputOverride = false;
  let currentInputDirection = 'ltr';
  let isProcessingBatch = false;
  let vazirmatnLoadPromise;

  function ensureVazirmatnFont() {
    if (!vazirmatnLoadPromise) {
      const fontUrl = chrome.runtime.getURL('fonts/Vazirmatn.woff2');
      vazirmatnLoadPromise = fetch(fontUrl)
        .then((response) => {
          if (!response.ok) throw new Error(`Font request failed: ${response.status}`);
          return response.arrayBuffer();
        })
        .then((data) => new FontFace('ChatGPT RTL Vazirmatn', data, {
          style: 'normal', weight: '100 900'
        }).load())
        .then((face) => {
          document.fonts.add(face);
          return true;
        })
        .catch((error) => {
          vazirmatnLoadPromise = undefined;
          console.error('ChatGPT RTL: Could not load bundled Vazirmatn font:', error);
          return false;
        });
    }
    return vazirmatnLoadPromise;
  }

  // Load initial settings
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(settings, (loaded) => {
      if (chrome.runtime.lastError) {
        console.warn('ChatGPT RTL: Could not load sync storage, using defaults');
        return;
      }
      settings = { ...settings, ...loaded };
      applyCurrentSettings();
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync') {
        for (const [key, { newValue }] of Object.entries(changes)) {
          settings[key] = newValue;
        }
        applyCurrentSettings();
      }
    });
  }

  function applyCurrentSettings() {
    if (settings.useVazirmatn) {
      ensureVazirmatnFont().then((loaded) => {
        document.documentElement.classList.toggle('chatgpt-vazirmatn-enabled', loaded && settings.useVazirmatn);
      });
    } else {
      document.documentElement.classList.remove('chatgpt-vazirmatn-enabled');
    }
    // Re-evaluate existing messages if auto-detect was toggled
    processAllMessages();
    // Update composer button visibility or state
    updateComposerButton();
  }

  // ---------------------------------------------------------------------------
  // 2. Intelligent Direction Calculation
  // ---------------------------------------------------------------------------
  /**
   * Calculates the text direction.
   * - For short text (< 15 directional characters, e.g. early streaming): starts with the first strong character.
   * - For full text (>= 15 directional characters): decides based on majority count.
   */
  function determineDirection(text) {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed) return null;

    const rtlMatches = trimmed.match(RTL_CHAR_REGEX);
    const rtlCount = rtlMatches ? rtlMatches.length : 0;

    const ltrMatches = trimmed.match(LTR_CHAR_REGEX);
    const ltrCount = ltrMatches ? ltrMatches.length : 0;

    const total = rtlCount + ltrCount;
    if (total === 0) return null;

    // Decisive majority wins
    if (rtlCount > ltrCount) return 'rtl';
    if (ltrCount > rtlCount) return 'ltr';

    // Tie-breaker: use first strong directional character
    const firstRtl = trimmed.search(RTL_CHAR_REGEX);
    const firstLtr = trimmed.search(LTR_CHAR_REGEX);

    if (firstRtl !== -1 && (firstLtr === -1 || firstRtl < firstLtr)) {
      return 'rtl';
    }
    return 'ltr';
  }

  // ---------------------------------------------------------------------------
  // 3. Math & Code Guard
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // 3. Math & Code Guard
  // ---------------------------------------------------------------------------
  function isInsideCodeOrMath(el) {
    if (!el || !el.closest) return false;
    return !!el.closest(
      'pre, [data-code-block="true"], [class*="CodeBlock"], [class*="CodeSurface"], .cm-editor, [data-testid*="code"], div[class*="code-block"], .katex, .MathJax, [data-d-component="math"]'
    );
  }

  function applyMathAndCodeIsolation(container) {
    if (!settings.forceCodeMathLTR) return;

    // Isolate Math containers
    const mathElements = container.querySelectorAll(
      '.katex, .katex-display, .katex-html, .MathJax, [class*="math-"], [data-d-component="math"]'
    );
    mathElements.forEach((el) => {
      el.setAttribute('dir', 'ltr');
      el.classList.add('chatgpt-ltr');
    });

    // Isolate Code blocks (covers legacy <pre>, Tailwind, and new CodeBlock/cm-editor)
    const codeBlocks = container.querySelectorAll(
      'pre, [data-code-block="true"], [class*="CodeBlock"], [class*="CodeSurface"], .cm-editor, [data-testid*="code"], div[class*="code-block"]'
    );
    codeBlocks.forEach((el) => {
      el.setAttribute('dir', 'ltr');
      el.classList.add('chatgpt-ltr');
      el.classList.remove('chatgpt-rtl', 'chatgpt-block-rtl');
    });
  }

  /**
   * Returns text content of an element excluding code blocks and math,
   * so programming language keywords don't bias overall conversational direction.
   */
  function getNonCodeText(el) {
    if (!el.querySelector('pre, [data-code-block], [class*="CodeBlock"], [class*="CodeSurface"], .cm-editor, [data-testid*="code"], .katex, .MathJax, [data-d-component="math"]')) {
      return el.textContent || '';
    }
    try {
      const clone = el.cloneNode(true);
      clone.querySelectorAll(
        'pre, [data-code-block], [class*="CodeBlock"], [class*="CodeSurface"], .cm-editor, [data-testid*="code"], div[class*="code-block"], .katex, .MathJax, [data-d-component="math"]'
      ).forEach((c) => c.remove());
      return clone.textContent || '';
    } catch {
      return el.textContent || '';
    }
  }

  /**
   * Evaluates the natural prose direction of a block element by excluding
   * embedded math formulas (KaTeX/MathJax) and inspecting prose around inline code.
   */
  function determineBlockDirection(block) {
    if (!block) return null;

    // 1. Get text stripped of math formulas (KaTeX, MathJax, LaTeX annotations)
    let text = block.textContent || '';
    if (block.querySelector('.katex, .MathJax, math, [data-d-component="math"], [class*="math-"], pre, [data-code-block], [class*="CodeBlock"], .cm-editor')) {
      try {
        const clone = block.cloneNode(true);
        clone.querySelectorAll(
          '.katex, .MathJax, math, [data-d-component="math"], [class*="math-"], pre, [data-code-block], [class*="CodeBlock"], .cm-editor'
        ).forEach((el) => el.remove());
        text = clone.textContent || '';
      } catch {
        text = block.textContent || '';
      }
    }

    const dir = determineDirection(text);
    if (dir === 'rtl') return 'rtl';

    // 2. If it evaluated to LTR, verify if Latin count was inflated by inline code identifiers
    if (block.querySelector('code, [data-d-component="code"]')) {
      try {
        const clone = block.cloneNode(true);
        clone.querySelectorAll(
          '.katex, .MathJax, math, [data-d-component="math"], [class*="math-"], pre, [data-code-block], [class*="CodeBlock"], .cm-editor, code, [data-d-component="code"]'
        ).forEach((el) => el.remove());
        const proseText = clone.textContent || '';
        const proseDir = determineDirection(proseText);
        if (proseDir === 'rtl') {
          return 'rtl';
        }
      } catch {}
    }

    return dir;
  }

  // ---------------------------------------------------------------------------
  // 4. Message Turn Processing (Per-Paragraph & Overall Majority)
  // ---------------------------------------------------------------------------
  function processMessageElement(messageEl) {
    if (!settings.autoDetectResponse) return;
    if (messageEl.closest('#prompt-textarea') || isInsideCodeOrMath(messageEl)) return;
    // Do not process individual table elements as messages; tables are handled as unified units
    if (messageEl.closest('table, [data-d-component="table"]') &&
        messageEl.tagName !== 'TABLE' &&
        !messageEl.matches?.('[data-d-component="table"]')) {
      return;
    }

    // Ensure math & code remain strictly LTR
    applyMathAndCodeIsolation(messageEl);

    // Block-level granularity (p, li, h1-h6, blockquote, user bubbles, whitespace-pre-wrap)
    const blocks = messageEl.querySelectorAll(
      'p, li, h1, h2, h3, h4, h5, h6, blockquote, [data-d-component="text"], [data-d-component="list-item"], .whitespace-pre-wrap, [data-user-message-bubble="true"], [data-message-author-role="user"]'
    );
    let totalRtlBlocks = 0;
    let totalLtrBlocks = 0;

    blocks.forEach((block) => {
      // Never change direction inside code, math, or tables (tables are handled cohesively)
      if (isInsideCodeOrMath(block) || block.closest('table, [data-d-component="table"]')) {
        return;
      }

      const dir = determineBlockDirection(block);
      if (dir === 'rtl') {
        if (block.getAttribute('dir') !== 'rtl') {
          block.setAttribute('dir', 'rtl');
        }
        if (!block.classList.contains('chatgpt-block-rtl')) {
          block.classList.add('chatgpt-block-rtl');
        }
        block.classList.remove('chatgpt-block-ltr');
        totalRtlBlocks++;

        // If this block is a list item or inside a list item, update parent ol / ul
        const parentLi = (block.tagName === 'LI' || block.matches?.('[data-d-component="list-item"]'))
          ? block
          : block.closest('li, [data-d-component="list-item"]');

        if (parentLi) {
          if (parentLi.getAttribute('dir') !== 'rtl') {
            parentLi.setAttribute('dir', 'rtl');
          }
          if (!parentLi.classList.contains('chatgpt-block-rtl')) {
            parentLi.classList.add('chatgpt-block-rtl');
          }
          parentLi.classList.remove('chatgpt-block-ltr');

          const parentList = parentLi.closest('ol, ul, [data-d-component="list"]');
          if (parentList && !isInsideCodeOrMath(parentList)) {
            if (parentList.getAttribute('dir') !== 'rtl') {
              parentList.setAttribute('dir', 'rtl');
            }
            if (!parentList.classList.contains('chatgpt-rtl')) {
              parentList.classList.add('chatgpt-rtl');
            }
            parentList.classList.remove('chatgpt-ltr');
          }
        }

        // If inside a user bubble, also update the bubble container
        const userBubble = block.closest('[data-user-message-bubble="true"], [data-message-author-role="user"]');
        if (userBubble) {
          if (userBubble.getAttribute('dir') !== 'rtl') {
            userBubble.setAttribute('dir', 'rtl');
          }
          if (!userBubble.classList.contains('chatgpt-rtl')) {
            userBubble.classList.add('chatgpt-rtl');
          }
          userBubble.classList.remove('chatgpt-ltr');
        }
      } else if (dir === 'ltr') {
        if (block.getAttribute('dir') !== 'ltr') {
          block.setAttribute('dir', 'ltr');
        }
        if (!block.classList.contains('chatgpt-block-ltr')) {
          block.classList.add('chatgpt-block-ltr');
        }
        block.classList.remove('chatgpt-block-rtl');
        totalLtrBlocks++;
      }
    });

    // Ensure tables reflect the direction of their content as a unified grid
    const isTableRoot = messageEl.tagName === 'TABLE' || messageEl.matches?.('[data-d-component="table"]');
    const tables = isTableRoot
      ? [messageEl]
      : messageEl.querySelectorAll('table, [data-d-component="table"]');

    tables.forEach((table) => {
      if (isInsideCodeOrMath(table)) return;

      const cleanText = getNonCodeText(table);
      const tableDir = determineDirection(cleanText);
      if (tableDir === 'rtl') {
        if (table.getAttribute('dir') !== 'rtl') {
          table.setAttribute('dir', 'rtl');
        }
        if (!table.classList.contains('chatgpt-rtl')) {
          table.classList.add('chatgpt-rtl');
        }
        table.classList.remove('chatgpt-ltr');

        // Align all headers, cells, and their contents uniformly to the right in RTL tables
        const tableElements = table.querySelectorAll('th, td, th *, td *');
        tableElements.forEach((el) => {
          if (isInsideCodeOrMath(el) || el.tagName === 'CODE' || el.tagName === 'PRE') return;

          if (el.getAttribute('dir') !== 'rtl') {
            el.setAttribute('dir', 'rtl');
          }
          if (!el.classList.contains('chatgpt-block-rtl')) {
            el.classList.add('chatgpt-block-rtl');
          }
          el.classList.remove('chatgpt-block-ltr', 'chatgpt-ltr');
          el.style.setProperty('text-align', 'right', 'important');
          el.style.setProperty('direction', 'rtl', 'important');
          el.style.setProperty('justify-content', 'flex-start', 'important');
        });
      } else if (tableDir === 'ltr') {
        if (table.getAttribute('dir') !== 'ltr') {
          table.setAttribute('dir', 'ltr');
        }
        if (!table.classList.contains('chatgpt-ltr')) {
          table.classList.add('chatgpt-ltr');
        }
        table.classList.remove('chatgpt-rtl');

        const tableElements = table.querySelectorAll('th, td, th *, td *');
        tableElements.forEach((el) => {
          if (isInsideCodeOrMath(el) || el.tagName === 'CODE' || el.tagName === 'PRE') return;

          if (el.getAttribute('dir') !== 'ltr') {
            el.setAttribute('dir', 'ltr');
          }
          if (!el.classList.contains('chatgpt-block-ltr')) {
            el.classList.add('chatgpt-block-ltr');
          }
          el.classList.remove('chatgpt-block-rtl', 'chatgpt-rtl');
          el.style.setProperty('text-align', 'left', 'important');
          el.style.setProperty('direction', 'ltr', 'important');
          el.style.setProperty('justify-content', 'flex-start', 'important');
        });
      }
    });

    // Ensure parent lists (<ol>, <ul>, [data-d-component="list"]) have correct direction based on their items
    const lists = messageEl.querySelectorAll('ol, ul, [data-d-component="list"]');
    lists.forEach((list) => {
      if (isInsideCodeOrMath(list)) return;

      const hasRtlLi = list.querySelector(':scope > li[dir="rtl"], :scope > li.chatgpt-block-rtl, :scope > [data-d-component="list-item"][dir="rtl"], [dir="rtl"]');
      if (hasRtlLi) {
        if (list.getAttribute('dir') !== 'rtl') {
          list.setAttribute('dir', 'rtl');
        }
        if (!list.classList.contains('chatgpt-rtl')) {
          list.classList.add('chatgpt-rtl');
        }
        list.classList.remove('chatgpt-ltr');
      } else {
        const hasLtrLi = list.querySelector(':scope > li[dir="ltr"], :scope > li.chatgpt-block-ltr');
        if (hasLtrLi) {
          if (list.getAttribute('dir') !== 'ltr') {
            list.setAttribute('dir', 'ltr');
          }
          if (!list.classList.contains('chatgpt-ltr')) {
            list.classList.add('chatgpt-ltr');
          }
          list.classList.remove('chatgpt-rtl');
        }
      }
    });

    // Determine overall message direction based on conversational text (excluding code/math)
    const overallText = getNonCodeText(messageEl);
    const overallDir = determineDirection(overallText);

    if (overallDir === 'rtl') {
      if (messageEl.getAttribute('dir') !== 'rtl') {
        messageEl.setAttribute('dir', 'rtl');
      }
      if (!messageEl.classList.contains('chatgpt-rtl')) {
        messageEl.classList.add('chatgpt-rtl');
      }
      messageEl.classList.remove('chatgpt-ltr');
    } else if (overallDir === 'ltr') {
      if (messageEl.getAttribute('dir') !== 'ltr') {
        messageEl.setAttribute('dir', 'ltr');
      }
      if (!messageEl.classList.contains('chatgpt-ltr')) {
        messageEl.classList.add('chatgpt-ltr');
      }
      messageEl.classList.remove('chatgpt-rtl');
    }

    // If messageEl is inside a user bubble or is a user bubble, sync it
    const parentBubble = messageEl.closest('[data-user-message-bubble="true"], [data-message-author-role="user"]');
    if (parentBubble && overallDir) {
      if (parentBubble.getAttribute('dir') !== overallDir) {
        parentBubble.setAttribute('dir', overallDir);
      }
      if (overallDir === 'rtl') {
        parentBubble.classList.add('chatgpt-rtl');
        parentBubble.classList.remove('chatgpt-ltr');
      } else {
        parentBubble.classList.add('chatgpt-ltr');
        parentBubble.classList.remove('chatgpt-rtl');
      }
    }

    // Attach message turn action button if not already present
    attachTurnActionButton(messageEl);
  }

  function processAllMessages() {
    const messages = document.querySelectorAll(
      // User containers
      '[data-user-message-bubble="true"], ' +
      '[data-message-author-role="user"], ' +
      '.whitespace-pre-wrap, ' +
      // Assistant containers (covers new DilRenderer, MarkdownRoot, and legacy)
      '[data-markdown-text-style="assistant-message"], ' +
      '[class*="DilResponseRoot"], ' +
      '[class*="DilRenderer"], ' +
      '[class*="MarkdownRoot"], ' +
      '[data-content-search-unit-key*="assistant"], ' +
      '[data-chatgpt-search-unit-key*="assistant"], ' +
      '[data-message-author-role="assistant"], ' +
      '[data-testid^="conversation-turn-"], ' +
      'div[data-dil-message-id], ' +
      'table, [data-d-component="table"]'
    );
    messages.forEach((msg) => processMessageElement(msg));
  }

  // ---------------------------------------------------------------------------
  // 5. Message Turn Manual Toggle Button
  // ---------------------------------------------------------------------------
  const TURN_BUTTON_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 6h16M4 12h10M4 18h16" />
    </svg>
  `;

  function createTurnToggleButton(targetEl) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chatgpt-rtl-turn-btn';
    btn.setAttribute('aria-label', 'Toggle RTL/LTR direction');
    btn.setAttribute('title', 'Toggle RTL/LTR direction for this message');
    btn.innerHTML = TURN_BUTTON_SVG;

    const isCurrentlyRtl = targetEl.getAttribute('dir') === 'rtl' || targetEl.classList.contains('chatgpt-rtl');
    if (isCurrentlyRtl) {
      btn.classList.add('is-rtl');
      btn.setAttribute('title', 'Text Direction: RTL (Click to toggle to LTR)');
    } else {
      btn.setAttribute('title', 'Text Direction: LTR (Click to toggle to RTL)');
    }

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const currentDir = targetEl.getAttribute('dir') === 'rtl' || targetEl.classList.contains('chatgpt-rtl') ? 'rtl' : 'ltr';
      const newDir = currentDir === 'rtl' ? 'ltr' : 'rtl';

      targetEl.setAttribute('dir', newDir);

      if (newDir === 'rtl') {
        targetEl.classList.add('chatgpt-rtl');
        targetEl.classList.remove('chatgpt-ltr');
        btn.classList.add('is-rtl');
        btn.setAttribute('title', 'Text Direction: RTL (Click to toggle to LTR)');

        targetEl.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, [data-d-component="text"], [data-d-component="list-item"], .whitespace-pre-wrap').forEach((el) => {
          if (!isInsideCodeOrMath(el) && !el.closest('table, [data-d-component="table"]')) {
            el.setAttribute('dir', 'rtl');
            el.classList.add('chatgpt-block-rtl');
            el.classList.remove('chatgpt-block-ltr');
          }
        });

        targetEl.querySelectorAll('ol, ul, [data-d-component="list"]').forEach((list) => {
          if (!isInsideCodeOrMath(list)) {
            list.setAttribute('dir', 'rtl');
            list.classList.add('chatgpt-rtl');
            list.classList.remove('chatgpt-ltr');
          }
        });

        targetEl.querySelectorAll('table, [data-d-component="table"]').forEach((table) => {
          if (!isInsideCodeOrMath(table)) {
            table.setAttribute('dir', 'rtl');
            table.classList.add('chatgpt-rtl');
            table.classList.remove('chatgpt-ltr');
            table.querySelectorAll('th, td, th *, td *').forEach((cell) => {
              if (!isInsideCodeOrMath(cell) && cell.tagName !== 'CODE' && cell.tagName !== 'PRE') {
                cell.setAttribute('dir', 'rtl');
                cell.classList.add('chatgpt-block-rtl');
                cell.classList.remove('chatgpt-block-ltr', 'chatgpt-ltr');
                cell.style.setProperty('text-align', 'right', 'important');
                cell.style.setProperty('direction', 'rtl', 'important');
              }
            });
          }
        });
      } else {
        targetEl.setAttribute('dir', 'ltr');
        targetEl.classList.add('chatgpt-ltr');
        targetEl.classList.remove('chatgpt-rtl');
        btn.classList.remove('is-rtl');
        btn.setAttribute('title', 'Text Direction: LTR (Click to toggle to RTL)');

        targetEl.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, [data-d-component="text"], [data-d-component="list-item"], .whitespace-pre-wrap').forEach((el) => {
          if (!isInsideCodeOrMath(el) && !el.closest('table, [data-d-component="table"]')) {
            el.setAttribute('dir', 'ltr');
            el.classList.add('chatgpt-block-ltr');
            el.classList.remove('chatgpt-block-rtl');
          }
        });

        targetEl.querySelectorAll('ol, ul, [data-d-component="list"]').forEach((list) => {
          if (!isInsideCodeOrMath(list)) {
            list.setAttribute('dir', 'ltr');
            list.classList.add('chatgpt-ltr');
            list.classList.remove('chatgpt-rtl');
          }
        });

        targetEl.querySelectorAll('table, [data-d-component="table"]').forEach((table) => {
          if (!isInsideCodeOrMath(table)) {
            table.setAttribute('dir', 'ltr');
            table.classList.add('chatgpt-ltr');
            table.classList.remove('chatgpt-rtl');
            table.querySelectorAll('th, td, th *, td *').forEach((cell) => {
              if (!isInsideCodeOrMath(cell) && cell.tagName !== 'CODE' && cell.tagName !== 'PRE') {
                cell.setAttribute('dir', 'ltr');
                cell.classList.add('chatgpt-block-ltr');
                cell.classList.remove('chatgpt-block-rtl', 'chatgpt-rtl');
                cell.style.setProperty('text-align', 'left', 'important');
                cell.style.setProperty('direction', 'ltr', 'important');
              }
            });
          }
        });
      }

      applyMathAndCodeIsolation(targetEl);
    });

    return btn;
  }

  function attachAllTurnActionButtons() {
    // 1. Locate all buttons in assistant response turn action bars
    const buttons = document.querySelectorAll(
      'button[data-testid="copy-turn-action-button"], ' +
      'button[data-testid*="copy-turn"], ' +
      'button[aria-label="Copy"], ' +
      'button[aria-label="העתק"], ' +
      'button[aria-label*="Copy" i], ' +
      'button[data-testid*="voice-play"], ' +
      'button[data-testid*="read-aloud"], ' +
      'button[aria-label*="Read aloud" i], ' +
      'button[aria-label*="הקרא" i], ' +
      'button[data-testid*="good-response"], ' +
      'button[aria-label*="Good response" i], ' +
      'button[aria-label*="תגובה טובה" i], ' +
      'button[aria-label*="Try again" i], ' +
      'button[aria-label*="נסה שוב" i], ' +
      'button[aria-label*="More" i], ' +
      'button[aria-label*="עוד" i]'
    );

    const actionBars = new Set();

    buttons.forEach((btn) => {
      // Must not be inside a code block, form, or composer area
      if (btn.closest('pre, [data-code-block="true"], div[class*="CodeBlock"], [class*="CodeSurface"], .cm-editor, form, #prompt-textarea, [data-testid*="composer"], [class*="composer"]')) {
        return;
      }

      // Ascend to find the parent toolbar containing multiple action buttons (true action bar)
      let parent = btn.parentElement;
      while (parent && parent !== document.body) {
        if (parent.closest('form, [data-testid*="composer"], #prompt-textarea')) {
          break;
        }
        if (parent.querySelectorAll('button').length >= 2 &&
            (parent.classList.contains('flex') || window.getComputedStyle(parent).display.includes('flex'))) {
          actionBars.add(parent);
          break;
        }
        parent = parent.parentElement;
      }
    });

    actionBars.forEach((actionBar) => {
      // Must not be inside the composer or prompt area
      if (actionBar.closest('form, #prompt-textarea, [data-testid*="composer"], [class*="composer"]')) {
        return;
      }

      // If our button is already in this action bar, do not duplicate
      if (actionBar.querySelector('.chatgpt-rtl-turn-btn')) {
        return;
      }

      // Locate the conversation turn container
      const turnContainer = actionBar.closest(
        '[data-testid^="conversation-turn-"], ' +
        '[data-content-search-unit-key*="assistant"], ' +
        '[data-chatgpt-search-unit-key*="assistant"], ' +
        'article, ' +
        '[data-message-author-role="assistant"], ' +
        '.group\\/conversation-turn'
      );

      // Only inject if inside a confirmed assistant turn
      if (!turnContainer) return;

      const messageEl = turnContainer.querySelector(
        '[data-markdown-text-style="assistant-message"], ' +
        '[class*="MarkdownRoot"], ' +
        '[class*="DilResponseRoot"], ' +
        '[class*="DilRenderer"], ' +
        '.markdown, ' +
        '[data-message-author-role="assistant"], ' +
        'div[data-dil-message-id]'
      );

      if (!messageEl) return;

      const toggleBtn = createTurnToggleButton(messageEl);

      // Place at the very end of the action bar, after the '...' menu,
      // so native button groups (Copy, Speaker, Share, Regenerate, ...) remain in original order
      actionBar.appendChild(toggleBtn);
    });
  }

  function attachTurnActionButton(messageEl) {
    attachAllTurnActionButtons();
  }

  // ---------------------------------------------------------------------------
  // 6. Composer Input Direction (Auto-detect & Manual Override)
  // ---------------------------------------------------------------------------
  const COMPOSER_RTL_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 6h16M10 12h10M4 18h16" />
      <path d="M7 9l-3 3 3 3" />
    </svg>
  `;

  function getPromptInput() {
    return document.getElementById('prompt-textarea') || document.querySelector('.ProseMirror[contenteditable="true"]');
  }

  function setInputDirection(dir, isManual = false) {
    currentInputDirection = dir;
    if (isManual) {
      manualInputOverride = true;
    }

    const input = getPromptInput();
    if (!input) return;

    if (dir === 'rtl') {
      input.setAttribute('dir', 'rtl');
      input.classList.add('chatgpt-rtl');
      input.classList.remove('chatgpt-ltr');
      input.querySelectorAll('p').forEach((p) => p.setAttribute('dir', 'rtl'));
    } else {
      input.setAttribute('dir', 'ltr');
      input.classList.add('chatgpt-ltr');
      input.classList.remove('chatgpt-rtl');
      input.querySelectorAll('p').forEach((p) => p.setAttribute('dir', 'ltr'));
    }

    updateComposerBtnState(dir === 'rtl');
  }

  function handleInputChange() {
    const input = getPromptInput();
    if (!input) return;

    const text = input.innerText || input.textContent || '';

    // If input is emptied, clear manual override so auto-detect is ready for next prompt
    if (text.trim() === '') {
      manualInputOverride = false;
      if (settings.defaultInputDirection !== 'auto') {
        setInputDirection(settings.defaultInputDirection, false);
      } else {
        setInputDirection('ltr', false);
      }
      return;
    }

    // If user manually overrode direction for this session, don't auto-flip
    if (manualInputOverride) return;
    if (!settings.autoDetectInput) return;

    const dir = determineDirection(text);
    if (dir) {
      setInputDirection(dir, false);
    }
  }

  function updateComposerBtnState(isRtl) {
    const btn = document.getElementById('chatgpt-rtl-composer-toggle');
    if (!btn) return;
    if (isRtl) {
      btn.classList.add('is-rtl', 'active');
      btn.setAttribute('title', 'Text Direction: RTL (Click to toggle)');
    } else {
      btn.classList.remove('is-rtl', 'active');
      btn.setAttribute('title', 'Text Direction: LTR (Click to toggle)');
    }
  }

  function updateComposerButton() {
    if (document.getElementById('chatgpt-rtl-composer-toggle')) return;

    const input = getPromptInput();
    if (!input) return;

    // Search for a suitable toolbar/actions container in composer
    const composerActions = document.querySelector('[data-testid="composer-footer-actions"]') ||
                            document.querySelector('[data-testid="fruitjuice-send-button"]')?.parentElement ||
                            input.closest('form')?.querySelector('.flex.items-center.justify-between') ||
                            input.parentElement;

    if (!composerActions) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'chatgpt-rtl-composer-toggle';
    btn.className = 'chatgpt-rtl-composer-btn';
    btn.setAttribute('aria-label', 'Toggle input direction');
    btn.setAttribute('title', 'Toggle input direction (Ctrl+Right/Left Shift)');
    btn.style.width = '32px';
    btn.style.minWidth = '32px';
    btn.style.maxWidth = '32px';
    btn.style.height = '32px';
    btn.style.minHeight = '32px';
    btn.style.maxHeight = '32px';
    btn.style.padding = '0';
    btn.style.margin = '0 4px';
    btn.style.borderRadius = '50%';
    btn.style.flex = '0 0 32px';
    btn.style.background = 'transparent';
    btn.style.border = 'none';
    btn.innerHTML = COMPOSER_RTL_SVG;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const newDir = currentInputDirection === 'rtl' ? 'ltr' : 'rtl';
      setInputDirection(newDir, true);
    });

    // Insert as first action or right before send button
    if (composerActions.firstChild) {
      composerActions.insertBefore(btn, composerActions.firstChild);
    } else {
      composerActions.appendChild(btn);
    }

    updateComposerBtnState(currentInputDirection === 'rtl');
  }

  // ---------------------------------------------------------------------------
  // 7. Keyboard Shortcuts
  // ---------------------------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    try {
      const input = getPromptInput();
      const isInputActive = input && (document.activeElement === input || input.contains(document.activeElement));

      // Direct direction switch: Ctrl+RightShift -> RTL, Ctrl+LeftShift -> LTR
      if ((e.ctrlKey || e.metaKey) && isInputActive) {
        if (e.code === 'ShiftRight') {
          setInputDirection('rtl', true);
        } else if (e.code === 'ShiftLeft') {
          setInputDirection('ltr', true);
        }
      }

      // Detect Enter without shift: user sends message, reset manual override for next turn
      if (e.key === 'Enter' && !e.shiftKey && isInputActive) {
        setTimeout(() => {
          manualInputOverride = false;
        }, 150);
      }
    } catch (err) {
      console.error('ChatGPT RTL: Keydown handler error:', err);
    }
  });

  // Listen to input events on document (delegated)
  document.addEventListener('input', (e) => {
    const input = getPromptInput();
    if (input && (e.target === input || input.contains(e.target))) {
      handleInputChange();
    }
  });

  // ---------------------------------------------------------------------------
  // 8. Resilient MutationObserver (Streaming + SPA Navigation)
  // ---------------------------------------------------------------------------
  function scheduleBatchProcessing() {
    if (isProcessingBatch) return;
    isProcessingBatch = true;

    requestAnimationFrame(() => {
      try {
        processAllMessages();
        updateComposerButton();
        attachAllTurnActionButtons();
      } catch (err) {
        console.error('ChatGPT RTL: Error during batch processing:', err);
      } finally {
        isProcessingBatch = false;
      }
    });
  }

  // Persistent observer on body — NEVER DISCONNECTS
  const observer = new MutationObserver((mutations) => {
    let hasRelevantChanges = false;
    for (let i = 0; i < mutations.length; i++) {
      const mut = mutations[i];
      if (mut.type === 'childList' && (mut.addedNodes.length > 0 || mut.removedNodes.length > 0)) {
        hasRelevantChanges = true;
        break;
      }
      if (mut.type === 'characterData') {
        hasRelevantChanges = true;
        break;
      }
    }

    if (hasRelevantChanges) {
      scheduleBatchProcessing();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  // Initial trigger
  scheduleBatchProcessing();

  console.info('ChatGPT RTL v1.6 initialized successfully.');
})();