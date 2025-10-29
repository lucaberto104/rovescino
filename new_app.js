//RICONTROLLA AGGIUNTA GIOCATORI: NON ENTRANO CON IL PUNTEGGIO MASSIMO

(() => {
  // ---------- PERSISTENCE KEYS ----------
  const STORAGE_KEY = 'rovescino_state_v1';

  // ---------- STATE ----------
  const defaultState = () => ({
    playersById: {},
    playerOrder: [],
    displayOrder: [],
    roundPointsById: {},
    ultimaId: null,
    cappottoId: null,
    basePerMano: 21,
    targetScore: 101,
    winners: [],
    eliminatedIds: [],
    nextId: 1,
    dealerIndex: 0,
    roundHistory: []
  });
  const state = defaultState();

  const undoStack = [];
  const redoStack = [];

  // ---------- DOM ----------
  const scoreCards = document.getElementById('score-cards');
  const badgeRestano = document.getElementById('restanoBadge');
  const confirmBtn = document.getElementById('update-round');
  const addPlayerBtn = document.getElementById('add-player');
  const errorArea = document.getElementById('errorArea');
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  const resetBtn = document.getElementById('resetBtn');
  const settingsBtn = document.getElementById('settingsBtn');

  // Settings modal
  const settingsOverlay = document.getElementById('settingsOverlay');
  const settingsDialog = document.getElementById('settingsDialog');
  const baseInput = document.getElementById('baseInput');
  const targetInput = document.getElementById('targetInput');
  const settingsSave = document.getElementById('settingsSave');
  const settingsCancel = document.getElementById('settingsCancel');
  
  // History modal
  const historyBtn   = document.getElementById('historyBtn');
  const historyOverlay = document.getElementById('historyOverlay');
  const historyDialog  = document.getElementById('historyDialog');
  const historyTable   = document.getElementById('historyTable');
  const historyClose   = document.getElementById('historyClose');
  
  // Settings Name Input
  const dialog = document.getElementById('addPlayerDialog');
  const form = document.getElementById('addPlayerForm');
  const input = document.getElementById('playerName');

  // ---------- HELPERS ----------
  function showError(message) {
    errorArea.textContent = message;
    errorArea.hidden = false;
    errorArea.focus({ preventScroll: true });
  }
  function hideError() {
    errorArea.hidden = true;
    errorArea.textContent = '';
  }

  function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function applyLoadedState(s) {
    // muta l'oggetto state mantenendo il riferimento
    const keys = Object.keys(state);
    for (const k of keys) delete state[k];
    Object.assign(state, s);
  }

  function snapshot() {
    undoStack.push(JSON.stringify(state));
    redoStack.length = 0;
    updateUndoRedoButtons();
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      // validazione minima
      if (!s || typeof s !== 'object' || !Array.isArray(s.playerOrder)) return false;
      
      if (!Array.isArray(s.roundHistory)) s.roundHistory = [];
      for (const id of Object.keys(s.playersById || {})) {
        if (typeof s.playersById[id].howManyReenters !== 'number') {
            s.playersById[id].howManyReenters = 0;
        }
      }
      if(!Array.isArray(s.displayOrder)) {
        const merged = [...(s.playerOrder || []), ...(s.eliminatedIds || [])];
        const unique = merged.filter((id,i) => merged.indexOf(id)===i);
        s.displayOrder = uniqe.filter(id => s.playersById && s.playersById[id]);
      }
      
      applyLoadedState(s);
      render();
      updateUndoRedoButtons();
      return true;
    } catch {
      return false;
    }
  }

  function getMaxActiveTotal({ excludeId=null, underTargetOnly=true } = {}) {
    let max = 0;
    for (const pid of state.playerOrder) {
     if (excludeId && pid === excludeId) continue;
     const t = Number(state.playersById[pid]?.total || 0);
     if (underTargetOnly && t >= state.targetScore) continue;
        if (t > max) max = t;
    }
    return max;
  }

  function removeFromOrderAndFixDealer(playerId) {
    const idx = state.playerOrder.indexOf(playerId);
    if (idx === -1) return;
    state.playerOrder = state.playerOrder.filter(id => id !== playerId);
    if (idx < state.dealerIndex) {
      state.dealerIndex--;
    } else if (idx === state.dealerIndex) {
      if (state.playerOrder.length === 0) state.dealerIndex = 0;
      else if (state.dealerIndex >= state.playerOrder.length) state.dealerIndex = 0;
    }
  }

  function rotateDealer() {
    const n = state.playerOrder.length;
    if (!n) return;
    state.dealerIndex = (state.dealerIndex + 1) % n;
    updateDealerHighlight();
  }

  function updateDealerHighlight() {
    scoreCards.querySelectorAll('.player-card.is-dealer')
      .forEach(card => card.classList.remove('is-dealer'));
    if (!state.playerOrder.length) return;
    const dealerId = state.playerOrder[state.dealerIndex];
    const card = scoreCards.querySelector(`.player-card[data-player-id="${dealerId}"]`);
    if (card) card.classList.add('is-dealer');
  }

  function updateRestanoAndConfirmState() {
    const base = state.basePerMano;
    let S = 0;
    for (const id of state.playerOrder) {
      if (id === state.ultimaId) continue;
      S += Number(state.roundPointsById[id] || 0);
    }
    const restano = base - S;
    if (badgeRestano) badgeRestano.textContent = `Restano: ${restano}`;
    if (confirmBtn) confirmBtn.disabled = !state.ultimaId || restano < 0;
  }

  function validateRound() {
    const base = state.basePerMano;
    const errors = [];
    if (!state.ultimaId) {
      errors.push({ type: 'ultima', message: 'Seleziona chi ha fatto l’ultima mano.' });
    }
    let S = 0;
    for (const id of state.playerOrder) {
      if (id === state.ultimaId) continue;
      const v = Number(state.roundPointsById[id] || 0);
      if (!Number.isFinite(v) || v < 0) {
        errors.push({ type: 'input', id, message: 'Inserisci un numero intero ≥ 0.' });
      } else {
        S += v;
      }
    }
    if (S > base) {
      errors.push({ type: 'sum', message: `La somma (${S}) supera ${base}.` });
    }
    return { ok: errors.length === 0, errors, S };
  }

  function applyRoundTotals(S) {
    const base = state.basePerMano;
    for (const id of state.playerOrder) {
      if (id === state.ultimaId) continue;
      state.playersById[id].total += (state.roundPointsById[id] || 0);
    }
    const puntiUltima = base - S;
    state.playersById[state.ultimaId].total += puntiUltima;
  }
  
  function openHistory() {
    renderHistoryTable();
    historyOverlay.hidden = false;
    historyDialog.focus();
  }
  
  function closeHistory(){
    historyOverlay.hidden = true;
  }

  function resetRoundStateAndUI() {
    for (const id of state.playerOrder) state.roundPointsById[id] = 0;
    state.ultimaId = null;
    state.cappottoId = null;
    scoreCards.querySelectorAll('.score-input').forEach(inp => { inp.value = ''; inp.disabled = false; });
    scoreCards.querySelectorAll('input.ultima-radio[name="ultima"]:checked').forEach(r => r.checked = false);
    scoreCards.querySelectorAll('.player-card.is-ultima').forEach(c => c.classList.remove('is-ultima'));
    if (badgeRestano) badgeRestano.textContent = `Restano: ${state.basePerMano}`;
  }

  // ---------- MODALS ----------
  function openChoiceModal({ title, message, primaryText = 'Rientra', secondaryText = 'Esci' }) {
    return new Promise(resolve => {
      const overlay = document.getElementById('modalOverlay');
      const dialog  = document.getElementById('modalDialog');
      const h2      = document.getElementById('modalTitle');
      const desc    = document.getElementById('modalDesc');
      const btnOk   = document.getElementById('modalPrimary');
      const btnNo   = document.getElementById('modalSecondary');

      h2.textContent = title;
      desc.textContent = message;
      btnOk.textContent = primaryText;
      btnNo.textContent = secondaryText;

      const onOk  = () => { cleanup(); resolve('reenter');};
      const onNo  = () => { cleanup(); resolve('exit'); };
      const onEsc = (e) => { if (e.key === 'Escape') { cleanup(); resolve('exit'); } };
      const cleanup = () => {
        btnOk.removeEventListener('click', onOk);
        btnNo.removeEventListener('click', onNo);
        document.removeEventListener('keydown', onEsc);
        overlay.hidden = true;
      };

      btnOk.addEventListener('click', onOk);
      btnNo.addEventListener('click', onNo);
      document.addEventListener('keydown', onEsc);

      overlay.hidden = false;
      dialog.focus({ preventScroll: true });
    });
  }
  
  function openNameModal({ title, message, primaryText = 'Conferma', secondaryText = 'Annulla' }) {
    return new Promise(resolve => {
      const overlay = document.getElementById('addPlayerDialog');
      const dialog  = document.getElementById('modalNameDialog');
      const h2      = document.getElementById('modalNameTitle');
      const desc    = document.getElementById('modalNameDesc');
      const nameInp = document.getElementById('playerNameInput');
      const btnOk   = document.getElementById('confirmAddPlayer');
      const btnNo   = document.getElementById('cancelAddPlayer');
      
      h2.textContent = title;
      desc.textContent = message;
      btnOk.textContent = primaryText;
      btnNo.textContent = secondaryText;
      
      const onOk = () => {const v = nameInp.value.trim(); cleanup(); resolve(v || null); };
      const onNo = () => { cleanup(); resolve(null);};
      const onEsc = (e) => { if (e.key === 'Escape') { cleanup();}};
      const onEnter = (e) => {if (e.key === 'Enter') {e.preventDefault(); onOk();}};
      
      function cleanup() {
        btnOk.removeEventListener('click', onOk);
        btnNo.removeEventListener('click', onNo);
        document.removeEventListener('keydown', onEsc);
        nameInp.removeEventListener('keydown', onEnter);
        overlay.hidden = true;
        addPlayerBtn.focus();
      }
      
      overlay.hidden = false;
      nameInp.value = '';
      nameInp.focus({preventScroll: true});
      btnOk.addEventListener('click', onOk);
      btnNo.addEventListener('click', onNo);
      document.addEventListener('keydown', onEsc);
      nameInp.addEventListener('keydown', onEnter);
    });
  }

  function openSettingsModal() {
    baseInput.value = String(state.basePerMano);
    targetInput.value = String(state.targetScore);
    settingsOverlay.hidden = false;
    settingsDialog.focus({ preventScroll: true });
  }
  
  function closeSettingsModal() {
    settingsOverlay.hidden = true;
  }

  // ---------- BUSTED ----------
  async function handleBustedPlayersSequential(bustedIds) {
    for (let i = 0; i < bustedIds.length; i++) {
      const id = bustedIds[i];
      if (!state.playersById[id]) continue;
      const p = state.playersById[id];

      const choice = await openChoiceModal({
        title: 'Sforamento target',
        message: `${p.name} ha ${p.total} punti (uscita impostata a ${state.targetScore}). Vuole rientrare al massimo tra i rimasti o uscire dal gioco?`,
        primaryText: 'Rientra',
        secondaryText: 'Esci'
      });

      if (choice === 'reenter') {
        let maxActive = getMaxActiveTotal({ excludedId: id, underTargetOnly: true });
        const safeTotal = Math.max(0, maxActive);
        //snapshot()
        p.total = safeTotal;
        p.howManyReenters = (p.howManyReenters || 0) + 1;
        render();
        persist();
      } else {
        //snapshot();
        removeFromOrderAndFixDealer(id);
        state.eliminatedIds.push(id);
        render();
        persist();
      }

      // ricalcola la lista degli sforati ancora presenti
      bustedIds = state.playerOrder.filter(pid => state.playersById[pid].total >= state.targetScore);
      i = -1; // riparti
    }
  }
  
  function pluralIT(n, s, p){ return n === 1 ? s : p; }
  
  function renderCardsPerPlayer(){
    const nPlayers = state.playerOrder.length;
    const cardsPerPlayer = Math.floor(40 / nPlayers);
    const remainingCards = 40 % nPlayers;
    const cardsPerPlayerPar = document.getElementById('cards-per-player');
    if(nPlayers === 0){
        cardsPerPlayerPar.textContent = `Aggiungi ${pluralIT(1,'un giocatore','dei giocatori')} per iniziare.`;
    } else if(remainingCards === 0){
        cardsPerPlayerPar.textContent = `Attualmente ${pluralIT(nPlayers, 'partecipa', 'partecipano')} ${nPlayers} ${pluralIT(nPlayers, 'giocatore', 'giocatori')}. Ogni giocatore riceve ${cardsPerPlayer} ${pluralIT(cardsPerPlayer, 'carta', 'carte')}, senza togliere nessuna carta dal mazzo.`;
    } else {
        cardsPerPlayerPar.textContent = `Attualmente ${pluralIT(nPlayers, 'partecipa', 'partecipano')} ${nPlayers} ${pluralIT(nPlayers, 'giocatore', 'giocatori')}. ${pluralIT(remainingCards, 'Si toglie', 'Si tolgono')} ${pluralIT(remainingCards, 'la', 'le ' + remainingCards)} ${pluralIT(remainingCards, 'carta', 'carte')} dal valore più basso dal mazzo, e ogni giocatore riceve ${cardsPerPlayer} ${pluralIT(cardsPerPlayer, 'carta', 'carte')}.`;
    }
    if(nPlayers >= 20) cardsPerPlayerPar.textContent = 'Ma quanti cazzo siete?';
  }

  // ---------- RENDER ----------
  function render() {
    scoreCards.innerHTML = '';
    renderCardsPerPlayer();
    for (const id of state.playerOrder) {
      const p = state.playersById[id];

      const card = document.createElement('div');
      card.className = 'player-card';
      card.dataset.playerId = id;

      const dealerIcon = document.createElement('span');
      dealerIcon.className = 'dealer-icon';
      //dealerIcon.textContent = '🃏';
      dealerIcon.setAttribute('role','img');
      dealerIcon.setAttribute('aria-label','Mazziere');
      card.appendChild(dealerIcon);

      const row1 = document.createElement('div');
      row1.className = 'row';
      const playerName = document.createElement('span');
      playerName.className = 'name_span';
      playerName.placeholder = 'Nome Giocatore';
      playerName.autocomplete = 'off';
      playerName.dataset.playerId = id;
      playerName.textContent = p.name;
      const total = document.createElement('span');
      total.className = 'score-total';
      total.dataset.playerId = id;
      total.textContent = p.total;
      row1.appendChild(playerName);
      row1.appendChild(total);
      card.appendChild(row1);

      const row2 = document.createElement('div');
      row2.className = 'row';
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.inputMode = 'numeric';
      inp.min = '0';
      inp.step = '1';
      inp.placeholder = '0';
      inp.className = 'score-input';
      inp.dataset.playerId = id;
      row2.appendChild(inp);

      const ultimaWrap = document.createElement('label');
      ultimaWrap.className = 'ultima-wrap';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.className = 'ultima-radio';
      radio.name = 'ultima';
      radio.dataset.playerId = id;
      const txt = document.createElement('span');
      txt.textContent = 'Ultima';
      ultimaWrap.appendChild(radio);
      ultimaWrap.appendChild(txt);
      row2.appendChild(ultimaWrap);

      card.appendChild(row2);

      const row3 = document.createElement('div');
      row3.className = 'row';
      const btnCappotto = document.createElement('button');
      btnCappotto.className = 'btn-cappotto';
      btnCappotto.dataset.playerId = id;
      btnCappotto.textContent = 'Cappotto';
      row3.appendChild(btnCappotto);
      const btnAccusoThree = document.createElement('button');
      btnAccusoThree.className = 'btn-accuso-three';
      btnAccusoThree.dataset.playerId = id;
      btnAccusoThree.dataset.delta = '3';
      btnAccusoThree.textContent = '-3';
      row3.appendChild(btnAccusoThree);
      const btnAccusoFour = document.createElement('button');
      btnAccusoFour.className = 'btn-accuso-four';
      btnAccusoFour.dataset.playerId = id;
      btnAccusoFour.dataset.delta = '4';
      btnAccusoFour.textContent = '-4';
      row3.appendChild(btnAccusoFour);
      const btnLeave = document.createElement('button');
      btnLeave.className = 'btn-leave';
      btnLeave.dataset.playerId = id;
      btnLeave.textContent = 'Esci';
      row3.appendChild(btnLeave);
      card.appendChild(row3);

      scoreCards.appendChild(card);
    }
    updateDealerHighlight();
    updateRestanoAndConfirmState();
    updateUndoRedoButtons();
  }
  
  function renderHistoryTable() {
    if (!state.roundHistory || !state.roundHistory.length) {
      historyTable.innerHTML = `<thead><tr><th>Giocatore</th></tr></thead><tbody><tr><td>Nessun round registrato.</td></tr></tbody>`;
      return;
    }

    const roundsCount = state.roundHistory.length;
    const thRounds = Array.from({ length: roundsCount }, (_, i) => `<th>R${i + 1}</th>`).join('');
    const thead = `<thead><tr><th>Giocatore</th>${thRounds}</tr></thead>`;

    const allPlayerIds = Object.keys(state.playersById || {});
    const ordered = (state.displayOrder || []).filter(pid => allPlayerIds.includes(String(pid)));

    let rows = '';
    for (const pid of ordered) {
      const p = state.playersById[pid];
      const reenters = p?.howManyReenters || 0;
      const nameCell = p
        ? `${p.name} <span class="player-reenters">(rientri: ${reenters})</span>`: `?`;

      let tds = '';
      for (let r = 0; r < roundsCount; r++) {
        const row = state.roundHistory[r];
        const rawVal = row?.totals?.[pid];              // numero o 'X'

        // classi condizionali: ultima mano e/o cappotto
        const classes = [];
        if (row?.ultimaId === pid) classes.push('ultima-cell');
        if (row?.cappotto === pid) classes.push('cappotto-cell'); // assicurati di impostare cappottoId in pushRoundToHistory()

        const clsAttr = classes.length ? ` class="${classes.join(' ')}"` : '';
        const cell = (rawVal === 'X' || typeof rawVal === 'number') ? rawVal : '—';

        tds += `<td${clsAttr}>${cell}</td>`;
      }
      rows += `<tr><td>${nameCell}</td>${tds}</tr>`;
    }

    historyTable.innerHTML = thead + `<tbody>${rows}</tbody>`;
  }

  function updateTotalsUI(playerId) {
    const el = scoreCards.querySelector(`.score-total[data-player-id="${playerId}"]`);
    if (el) el.textContent = state.playersById[playerId].total;
  }
  
  async function checkBusted() {
    let busted = state.playerOrder.filter(id => state.playersById[id].total >= state.targetScore);
    if (busted.length) {
      await handleBustedPlayersSequential(busted);
    }
  }

  function updateUndoRedoButtons() {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }

  // ---------- ADD/REMOVE PLAYER ----------
  function addPlayer(name) {
    // genera un id stringa e prepara l’oggetto giocatore
    const id = String(state.nextId++);
    const playerName = (name && String(name).trim()) || `Giocatore ${id}`;
    let safeTotal;
    if(state.playerOrder.length === 0 || getMaxActiveTotal() <= 0){
      safeTotal = 0;
    } else {
      safeTotal = getMaxActiveTotal()
    }
    
    const p = {
      id,
      name: playerName,
      total: safeTotal,
      howManyReenters: 0
    };

    snapshot(); // se usi undo/redo

    // registra il giocatore
    state.playersById[id] = p;

    // se usi ancora playerOrder per il giro, tienilo aggiornato
    if (!Array.isArray(state.playerOrder)) state.playerOrder = [];
    state.playerOrder.push(id);

    // ordine visivo stabile: sempre in fondo
    if (!Array.isArray(state.displayOrder)) state.displayOrder = [];
    if (!state.displayOrder.includes(id)) state.displayOrder.push(id);

    render();
    persist();

    return id; // utile se vuoi usarlo subito dopo
  }


  // ---------- EVENTS (delegation) ----------
  // Input nome
  scoreCards.addEventListener('input', (e) => {
    const input = e.target.closest('.name');
    if(!input) return;
    const id = input.dataset.playerId;
    state.playersById[id].name = input.value;
    persist();
  });
  
  // Input punteggi
  scoreCards.addEventListener('input', (e) => {
    const input = e.target.closest('.score-input');
    if (!input) return;
    const id = input.dataset.playerId;
    const raw = input.value.trim();
    const num = raw === '' ? 0 : Math.max(0, Math.floor(Number(raw) || 0));
    state.roundPointsById[id] = num;
    updateRestanoAndConfirmState();
  });

  // Radio ultima
  scoreCards.addEventListener('change', (e) => {
    const radio = e.target.closest('.ultima-radio');
    if (!radio) return;
    const selectedId = radio.dataset.playerId;
    state.ultimaId = selectedId;

    scoreCards.querySelectorAll('.player-card.is-ultima')
      .forEach(card => card.classList.remove('is-ultima'));
    const selectedCard = scoreCards.querySelector(`.player-card[data-player-id="${selectedId}"]`);
    if (selectedCard) selectedCard.classList.add('is-ultima');

    // disabilita/azzera input dell’ultima, riabilita/normalizza gli altri
    for (const id of state.playerOrder) {
      const inp = scoreCards.querySelector(`.score-input[data-player-id="${id}"]`);
      if (!inp) continue;
      if (id === selectedId) {
        inp.value = '';
        inp.disabled = true;
        state.roundPointsById[id] = 0;
      } else {
        inp.disabled = false;
        const raw = inp.value.trim();
        const num = raw === '' ? 0 : Math.max(0, Math.floor(Number(raw) || 0));
        state.roundPointsById[id] = num;
      }
    }
    updateRestanoAndConfirmState();
  });

  // Cappotto (delegation)
  scoreCards.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-cappotto');
    if (!btn) return;
    const clickedId = btn.dataset.playerId;
    snapshot();
    state.cappottoId = btn.dataset.playerId;
    for (const id of state.playerOrder) {
      if (id === clickedId) continue;
      state.playersById[id].total += state.basePerMano; // + base (es. 21)
      updateTotalsUI(id);
    }
    
    for (const id of state.playerOrder) checkBusted();
    pushRoundToHistory();
    resetRoundStateAndUI();
    rotateDealer();
    render();
    persist();
  });
  
  //Accuso -3
  scoreCards.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-accuso-three');
    if(!btn) return;
    const clickedId = btn.dataset.playerId;
    snapshot();
    state.playersById[clickedId].total -= 3;
    updateTotalsUI(clickedId);
    render();
    persist();
  });
  
  //Accuso -4
  scoreCards.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-accuso-four');
    if(!btn) return;
    const clickedId = btn.dataset.playerId;
    snapshot();
    state.playersById[clickedId].total -= 4;
    updateTotalsUI(clickedId);
    render();
    persist();
  });
  
  //button Esci
  scoreCards.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-leave');
    if(!btn) return;
    const clickedId = btn.dataset.playerId;
    snapshot();
    removeFromOrderAndFixDealer(clickedId);
    state.eliminatedIds.push(clickedId);
    render();
    persist();
  });
  
  function pushRoundToHistory() {
    const totals = {};

    // normalizza per confronti robusti
    const active = new Set((state.playerOrder || []).map(String));
    const eliminated = new Set((state.eliminatedIds || []).map(String));

    for (const pid of Object.keys(state.playersById || {})) {
      const pidStr = String(pid);

      if (active.has(pidStr)) {
        // ancora in gioco -> salva il punteggio numerico
        totals[pid] = state.playersById[pid].total;
      } else if (eliminated.has(pidStr)) {
        // eliminato -> salva 'X'
        totals[pid] = 'X';
      } else {
        // caso limite: non attivo né eliminato (es. giocatore appena creato ma non in lista)
        totals[pid] = state.playersById[pid].total ?? '—';
      }
    }

    state.roundHistory.push({
      timestamp: Date.now(),
      ultimaId: state.ultimaId,
      cappotto: state.cappottoId,
      totals
    });
    persist();
  }
  
  // Conferma mano
  async function onConfirmRoundClick() {
    const { ok, errors, S } = validateRound();
    if (!ok) {
      const first = errors[0];
      showError(first.message);
      return;
    }
    hideError();
    snapshot();

    applyRoundTotals(S);
    // aggiorna punteggi UI
    for (const id of state.playerOrder) updateTotalsUI(id);

    // Sforati
    let busted = state.playerOrder.filter(id => state.playersById[id].total >= state.targetScore);
    if (busted.length) {
      await handleBustedPlayersSequential(busted);
    }

    pushRoundToHistory();
    resetRoundStateAndUI();
    rotateDealer();
    render();
    persist();
  }

  confirmBtn.addEventListener('click', onConfirmRoundClick);
  addPlayerBtn.addEventListener('click', async() => {
    const name = await openNameModal({
        title: 'Inserisci Giocatore',
        message: 'Digita il nome e premi Aggiungi',
        primaryText: 'Aggiungi',
        secondaryText: 'Annulla'
    });
    if (name) addPlayer(name);
  });

  // Undo/Redo/Reset
  undoBtn.addEventListener('click', () => {
    if (!undoStack.length) return;
    const prev = undoStack.pop();
    redoStack.push(JSON.stringify(state));
    applyLoadedState(JSON.parse(prev));
    render();
    persist();
    updateUndoRedoButtons();
  });
  redoBtn.addEventListener('click', () => {
    if (!redoStack.length) return;
    const next = redoStack.pop();
    undoStack.push(JSON.stringify(state));
    applyLoadedState(JSON.parse(next));
    render();
    persist();
    updateUndoRedoButtons();
  });
  resetBtn.addEventListener('click', () => {
    snapshot();
    applyLoadedState(defaultState());
    localStorage.removeItem(STORAGE_KEY);
    render();
    updateUndoRedoButtons();
  });
  
  // History
  historyBtn.addEventListener('click', openHistory);
  historyClose.addEventListener('click', closeHistory);
  historyOverlay.addEventListener('click', (e) => {
    if(e.target === historyOverlay) closeHistory();
  });
  historyDialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeHistory();
  });

  // Settings
  settingsBtn.addEventListener('click', openSettingsModal);
  settingsCancel.addEventListener('click', closeSettingsModal);
  settingsSave.addEventListener('click', () => {
    const base = Math.max(1, Math.floor(Number(baseInput.value) || 21));
    const target = Math.max(1, Math.floor(Number(targetInput.value) || 101));
    snapshot();
    state.basePerMano = base;
    state.targetScore = target;
    closeSettingsModal();
    updateRestanoAndConfirmState();
    persist();
  });

  // ---------- INIT ----------
  // ___ INIT ___
  if (!loadFromStorage()) {
    // nessun giocatore predefinito
    render();
    persist();
  }

})();
