/* La voce resta nel file registrato; i tempi provengono dalla sua trascrizione. */
(() => {
  'use strict';
  const $ = name => document.getElementById('lettore-' + name);
  const audio = $('audio'), player = document.getElementById('player');
  const play = $('play');
  const chapter = $('capitolo'), options = [...chapter.options], progress = $('progresso');
  const speed = $('velocita'), volume = $('volume'), follow = $('segui'), status = $('stato');
  const sync = window.ARTICLE_SYNC;
  const format = seconds => {
    seconds = Math.max(0, Math.floor(seconds || 0));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  };
  const normalize = word => word.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const storeKey = 'macros-frankenstein-audio-' + (sync?.audioHash || 'v1');
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(storeKey)); } catch {}
  const restoredRate = saved?.rate;
  let pendingSeek = null, scrubbing = false, engaged = false, frame = 0;
  let autoScrollUntil = 0, autoScrollTarget = null;
  let wordIndex = -1, activeWord = null, activeBlock = null, autoScrollAt = 0, lastSave = 0;
  let words = [], spans = [], blocks = [], syncReady = false;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const duration = () => Number.isFinite(audio.duration) ? audio.duration : (sync?.duration || 1528.25);
  const announce = message => { status.textContent = message; };
  function save(force = false) {
    if (!engaged || (!force && Date.now() - lastSave < 2000)) return;
    lastSave = Date.now();
    try { localStorage.setItem(storeKey, JSON.stringify({time: audio.ended ? 0 : audio.currentTime, rate: audio.playbackRate})); } catch {}
  }
  function overlaySize() {
    document.documentElement.style.setProperty('--altezza-player', Math.ceil(player.getBoundingClientRect().height + 36) + 'px');
  }
  function buttons() {
    const playing = !audio.paused && !audio.ended;
    for (const button of [play]) {
      button.querySelector('use').setAttribute('href', playing ? '#ic-pause' : '#ic-play');
      button.setAttribute('aria-label', playing ? 'Metti in pausa la lettura' : 'Ascolta la lettura');
    }
    play.querySelector('span').textContent = playing ? 'Pausa' : audio.currentTime > 1 && !audio.ended ? 'Riprendi' : 'Ascolta';
  }
  async function start() {
    try { await audio.play(); }
    catch { announce('La riproduzione non è partita. Premi Ascolta per riprovare.'); }
  }
  function toggle() { if (audio.paused || audio.ended) start(); else audio.pause(); }
  function seek(time, autoplay = false) {
    const target = Math.min(duration(), Math.max(0, time));
    if (audio.readyState >= 1) { audio.currentTime = target; update(); highlight(true); }
    else { pendingSeek = target; audio.load(); }
    if (autoplay) start();
  }
  function update() {
    const time = scrubbing ? Number(progress.value) : audio.currentTime;
    const length = duration();
    progress.max = length;
    if (!scrubbing) progress.value = time;
    progress.style.setProperty('--avanzamento', (100 * time / length) + '%');
    progress.setAttribute('aria-valuetext', format(time) + ' di ' + format(length));
    $('tempo').textContent = format(time);
    $('restante').textContent = '−' + format(length - time);
    const current = Math.max(0, options.findLastIndex(option => Number(option.value) <= audio.currentTime + 0.05));
    chapter.selectedIndex = current;
    $('capitolo-corrente').textContent = options[current].textContent;
    save();
  }
  function findWord(time) {
    let low = 0, high = words.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (words[mid].t <= time) low = mid + 1; else high = mid;
    }
    return low - 1;
  }
  function goToText(manual = false) {
    if (!syncReady) return;
    const target = spans[Math.max(0, findWord(audio.currentTime))];
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const visibleBottom = Math.min(innerHeight, player.getBoundingClientRect().top) - 30;
    if (manual || rect.top < 40 || rect.bottom > visibleBottom) {
      const top = window.scrollY + rect.top - Math.max(45, visibleBottom * 0.38);
      autoScrollTarget = Math.max(0, Math.min(top, document.documentElement.scrollHeight - innerHeight));
      autoScrollUntil = Date.now() + 1800;
      window.scrollTo({top: autoScrollTarget, behavior: reducedMotion.matches ? 'instant' : 'smooth'});
      autoScrollAt = Date.now();
    }
  }
  function highlight(force = false) {
    if (!syncReady) return;
    const index = findWord(audio.currentTime);
    const showing = engaged || audio.currentTime > 0.05;
    const visibleIndex = showing && index >= 0 && audio.currentTime <= words[index].e + 0.12 && !audio.ended ? index : -1;
    if (visibleIndex !== wordIndex || force) {
      activeWord?.classList.remove('parola-in-lettura');
      activeWord = visibleIndex >= 0 ? spans[visibleIndex] : null;
      activeWord?.classList.add('parola-in-lettura');
      wordIndex = visibleIndex;
      const block = showing && index >= 0 && !audio.ended ? blocks[index] : null;
      if (activeBlock !== block) {
        activeBlock?.classList.remove('brano-in-lettura');
        activeBlock = block;
        activeBlock?.classList.add('brano-in-lettura');
      }
    }
    if (follow.checked && !audio.paused && !audio.seeking && Date.now() - autoScrollAt > 900) goToText();
  }
  function tick() {
    highlight();
    if (!audio.paused && !audio.ended) frame = requestAnimationFrame(tick);
  }
  function setupText() {
    if (!sync?.words?.length) return;
    const elements = [...document.querySelectorAll('.apertura > h1, .apertura > .sottotitolo, .apertura > .attacco, #articolo .testo > h2, #articolo .testo > h3, #articolo .testo > p:not(.numero)')];
    const nodes = [], tokens = [];
    for (const block of elements) {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
        acceptNode: node => node.parentElement.closest('.fonte, button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      });
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const matches = [...node.textContent.matchAll(/[\p{L}\p{N}]+/gu)];
        nodes.push({node, matches, block});
        matches.forEach(match => tokens.push(match[0]));
      }
    }
    if (tokens.length !== sync.words.length || tokens.some((word, i) => normalize(word) !== normalize(sync.words[i].p))) {
      announce('Il testo è stato aggiornato: la registrazione è disponibile, ma l’evidenziazione deve essere riallineata.');
      return;
    }
    words = sync.words;
    for (const {node, matches, block} of nodes) {
      if (!matches.length) continue;
      const fragment = document.createDocumentFragment();
      let end = 0;
      for (const match of matches) {
        fragment.append(document.createTextNode(node.textContent.slice(end, match.index)));
        const span = document.createElement('span');
        span.className = 'parola-audio';
        span.dataset.word = spans.length;
        span.textContent = match[0];
        fragment.append(span);
        if (block.dataset.firstWord === undefined) block.dataset.firstWord = spans.length;
        spans.push(span); blocks.push(block);
        end = match.index + match[0].length;
      }
      fragment.append(document.createTextNode(node.textContent.slice(end)));
      node.replaceWith(fragment);
    }
    elements.forEach(block => {
      block.classList.add('brano-audio');
      if (block.tagName !== 'P') return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'audio-da-qui';
      button.setAttribute('aria-label', 'Ascolta da: ' + block.textContent.trim().slice(0, 85));
      button.innerHTML = '<svg aria-hidden="true"><use href="#ic-play"/></svg>';
      button.addEventListener('click', () => seek(words[Number(block.dataset.firstWord)].t, true));
      block.append(button);
    });
    document.addEventListener('click', event => {
      const span = event.target.closest('.parola-audio');
      if (span && !window.getSelection()?.toString()) seek(words[Number(span.dataset.word)].t, true);
    });
    syncReady = true;
    player.dataset.sync = 'ready';
  }
  setupText();
  if (!syncReady) {
    follow.disabled = true;
    follow.checked = false;
    $('aiuto').textContent = 'Lettura integrale con la voce Cedar.';
  }
  function metadata() {
    if (pendingSeek !== null) { audio.currentTime = pendingSeek; pendingSeek = null; }
    else if (!engaged && saved && Number.isFinite(saved.time) && saved.time > 3 && saved.time < duration() - 5) {
      audio.currentTime = saved.time;
      announce('Riprendi da ' + format(saved.time) + '. Il punto di ascolto è salvato su questo dispositivo.');
      saved = null;
    }
    update(); buttons(); highlight(true);
  }
  audio.addEventListener('loadedmetadata', metadata);
  if (audio.readyState >= 1) metadata();
  if ([...speed.options].some(option => Number(option.value) === restoredRate)) {
    speed.value = restoredRate; audio.playbackRate = restoredRate;
  }
  audio.addEventListener('play', () => {
    engaged = true; announce(''); buttons();
    cancelAnimationFrame(frame); tick();
  });
  audio.addEventListener('pause', () => { cancelAnimationFrame(frame); buttons(); save(true); highlight(); });
  audio.addEventListener('timeupdate', () => { update(); highlight(); });
  audio.addEventListener('seeked', () => { highlight(true); update(); if (follow.checked && engaged) goToText(true); });
  audio.addEventListener('ended', () => { cancelAnimationFrame(frame); buttons(); highlight(true); save(true); announce('Lettura completata.'); });
  audio.addEventListener('waiting', () => { if (!audio.paused) announce('Caricamento dell’audio…'); });
  audio.addEventListener('playing', () => announce(''));
  audio.addEventListener('error', () => announce('Non riesco a caricare l’audio. Ricarica la pagina o scarica la registrazione dalle opzioni.'));
  play.addEventListener('click', toggle);
  document.querySelectorAll('[data-skip]').forEach(button => button.addEventListener('click', () => seek(audio.currentTime + Number(button.dataset.skip))));
  progress.addEventListener('input', () => { scrubbing = true; update(); });
  progress.addEventListener('change', () => { const time = Number(progress.value); scrubbing = false; seek(time); });
  chapter.addEventListener('change', () => seek(Number(chapter.value)));
  speed.addEventListener('change', () => { audio.playbackRate = Number(speed.value); save(true); });
  volume.addEventListener('input', () => { audio.volume = Number(volume.value); });
  $('stop').addEventListener('click', () => {
    audio.pause(); seek(0); save(true); announce('Premi Ascolta per ricominciare dall’inizio.');
  });
  follow.addEventListener('change', () => {
    if (follow.checked) { announce(''); goToText(true); }
    else stopFollowing();
  });
  function stopFollowing() {
    follow.checked = false;
    // Interrompe anche un eventuale scorrimento dolce ancora in corso.
    const wasMoving = Date.now() < autoScrollUntil;
    autoScrollUntil = 0;
    autoScrollTarget = null;
    if (wasMoving) window.scrollTo({top: window.scrollY, behavior: 'instant'});
  }
  const manualScroll = event => {
    if (event.target instanceof Element && event.target.closest('input, select, button, .lettore')) return;
    if (follow.checked) stopFollowing();
  };
  window.addEventListener('wheel', manualScroll, {passive: true});
  window.addEventListener('touchmove', manualScroll, {passive: true});
  document.addEventListener('keydown', event => {
    if (['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' '].includes(event.key)) manualScroll(event);
  });
  // Cattura anche trascinamento della scrollbar e navigazione per ancore.
  window.addEventListener('scroll', () => {
    if (!follow.checked) return;
    if (autoScrollTarget !== null && Date.now() < autoScrollUntil) {
      if (Math.abs(scrollY - autoScrollTarget) < 2) autoScrollUntil = Date.now() + 100;
      return;
    }
    stopFollowing();
  }, {passive: true});
  window.addEventListener('pointerdown', event => {
    if (event.clientX >= document.documentElement.clientWidth && follow.checked) stopFollowing();
  }, {passive: true});
  $('espandi').addEventListener('click', () => {
    const expanded = $('espandi').getAttribute('aria-expanded') !== 'true';
    $('espandi').setAttribute('aria-expanded', String(expanded));
    $('espandi').setAttribute('aria-label', expanded ? 'Chiudi le opzioni di ascolto' : 'Apri le opzioni di ascolto');
    $('dettagli').hidden = !expanded;
    overlaySize();
    if (follow.checked && engaged) goToText(true);
  });
  player.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('dettagli').hidden) { $('espandi').click(); $('espandi').focus({preventScroll:true}); }
  });
  window.addEventListener('pagehide', () => save(true));
  audio.controls = false;
  audio.hidden = true;
  $('controlli').hidden = false;
  player.classList.add('lettore-pronto');
  document.body.classList.add('audio-overlay');
  new ResizeObserver(overlaySize).observe(player);
  overlaySize();
  update(); buttons();
})();

