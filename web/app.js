// ============================================================
// Family Tree Builder - canvas + sidebar app
// ============================================================

const NODE_W = 148;
const NODE_H = 160;
const NODE_CENTER_X = 74;
const NODE_CENTER_Y = 40; // visual center of the card (below the overlapping photo)
const INITIAL_CANVAS_W = 2400;
const INITIAL_CANVAS_H = 1600;
const CANVAS_EDGE_PADDING = 240;
const CANVAS_GROW_PADDING = 600;
const CLICK_DRAG_THRESHOLD = 4; // px of movement before a mousedown counts as a drag, not a click

let currentPersons = [];
let currentRelationships = [];
let dragState = null;
let pendingQuickAdd = null; // { anchorId, type }
let pendingLink = null;
let zoom = 1;
let canvasW = INITIAL_CANVAS_W;
let canvasH = INITIAL_CANVAS_H;
let panState = null;
let storageMode = 'local';
let connectMode = false;
let selectedNodeId = null;
let sidebarCollapsed = false;
let dateFormat = 'dmy';
let latestReleaseUrl = '';
let currentTheme = 'white';
let quickAddCroppedPhoto = null;
let photoDialogCroppedPhoto = null;
let cropperState = null;
let sidebarDirty = false;        // sidebar fields changed since the last save
let undoStack = [];              // newest last: { label, run() }
let searchMatches = [];          // people matching the current search query
let searchActiveIndex = -1;      // keyboard-highlighted row in the results list

const CHECKLIST_KEY = 'familytree.checklistDismissed';
const EXPORTED_KEY = 'familytree.exported';
const CHECKLIST_STEPS = [
    { id: 'root', label: 'Add yourself or a first relative', action: 'Start', run: () => openQuickAdd(null, 'root') },
    { id: 'parents', label: 'Add your parents', action: 'Add', run: () => openQuickAdd(null, 'parent') },
    { id: 'partner', label: 'Add a partner', action: 'Add', run: () => openQuickAdd(null, 'spouse') },
    { id: 'children', label: 'Add children', action: 'Add', run: () => openQuickAdd(null, 'child') },
    { id: 'photo', label: 'Give someone a photo', action: 'Upload', run: () => focusPhotoTab() },
    { id: 'export', label: 'Export or share your tree', action: 'Export', run: () => exportImage('png') }
];

// Placeholder silhouette for people without a photo. Fully URL-encoded so it
// survives being dropped into an HTML attribute.
const placeholderAvatar = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2393a19e%22%20stroke-width%3D%221.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Ccircle%20cx%3D%2212%22%20cy%3D%228.5%22%20r%3D%223.6%22%2F%3E%3Cpath%20d%3D%22M5%2020a7%207%200%200%201%2014%200%22%2F%3E%3C%2Fsvg%3E';

function showToast(message, isError) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast show' + (isError ? ' error' : '');
    setTimeout(() => { toast.className = 'toast'; }, 2500);
}

// --- Confirmation dialog (replaces browser confirm()) ---
// Returns a Promise<boolean>. Wire-up of the buttons happens in window.onload.
let confirmResolve = null;

function showConfirm(options) {
    const opts = options || {};
    const dialog = document.getElementById('confirmDialog');
    document.getElementById('confirmTitle').textContent = opts.title || 'Are you sure?';
    document.getElementById('confirmMessage').textContent = opts.message || '';

    const okBtn = document.getElementById('confirmOkBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');
    okBtn.textContent = opts.confirmLabel || 'Confirm';
    cancelBtn.textContent = opts.cancelLabel || 'Cancel';
    okBtn.className = opts.danger === false ? 'btn-primary' : 'btn-danger';

    if (confirmResolve) { const pending = confirmResolve; confirmResolve = null; pending(false); }

    return new Promise(resolve => {
        confirmResolve = resolve;
        if (!dialog.open) dialog.showModal();
        setTimeout(() => cancelBtn.focus(), 30);
    });
}

function settleConfirm(value) {
    const dialog = document.getElementById('confirmDialog');
    if (dialog.open) dialog.close();
    if (confirmResolve) { const pending = confirmResolve; confirmResolve = null; pending(value); }
}

// --- Undo ---
// Every destructive action pushes an inverse operation. Undo only ever adds
// data back (or restores saved coordinates); it never deletes anything.
function pushUndo(entry) {
    undoStack.push(entry);
    if (undoStack.length > 40) undoStack.shift();
    updateUndoUI();
}

function updateUndoUI() {
    const btn = document.getElementById('undoBtn');
    const count = document.getElementById('undoCount');
    const total = undoStack.length;
    if (!btn || !count) return;
    btn.disabled = total === 0;
    count.hidden = total === 0;
    count.textContent = String(total);
    btn.title = total
        ? `Undo: ${undoStack[total - 1].label} (Ctrl+Z)`
        : 'Nothing to undo yet (Ctrl+Z)';
}

async function postJson(path, body) {
    const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error((await res.text()) || res.statusText);
    return res.status === 204 ? null : res.json().catch(() => null);
}

function undoRestore(persons, relationships, events) {
    return postJson('/api/undo', { persons: persons || [], relationships: relationships || [], events: events || [] });
}

async function performUndo() {
    const entry = undoStack.pop();
    if (!entry) return showToast('Nothing to undo yet', true);
    try {
        await entry.run();
        updateUndoUI();
        showToast('Undone: ' + entry.label);
    } catch (err) {
        updateUndoUI();
        showToast('Undo failed: ' + err.message, true);
    }
}

// --- Backup & restore ---
async function downloadBackup() {
    try {
        const res = await fetch('/api/backup');
        if (!res.ok) throw new Error(await res.text());
        const blob = await res.blob();
        const stamp = new Date().toISOString().slice(0, 10);
        downloadBlob(blob, `family-tree-backup-${stamp}.json`);
        showToast('Backup downloaded');
    } catch (err) {
        showToast('Backup failed: ' + err.message, true);
    }
}

function openRestorePicker() {
    const input = document.getElementById('restoreFileInput');
    input.value = '';
    input.click();
}

async function handleRestoreFileChosen(input) {
    const file = input.files && input.files[0];
    if (!file) return;

    let payload;
    try {
        payload = JSON.parse(await file.text());
    } catch (err) {
        return showToast('That file is not valid JSON', true);
    }
    if (!payload || !Array.isArray(payload.persons)) {
        return showToast('That file does not look like a family tree backup', true);
    }

    const ok = await showConfirm({
        title: 'Restore this backup?',
        message: `This replaces your current tree (${currentPersons.length} ${currentPersons.length === 1 ? 'person' : 'people'}) with the ${payload.persons.length} ${payload.persons.length === 1 ? 'person' : 'people'} in this file. You can undo it straight afterwards.`,
        confirmLabel: 'Restore',
        danger: true
    });
    if (!ok) return;

    try {
        const before = { persons: currentPersons, relationships: currentRelationships };
        await postJson('/api/restore', payload);
        pushUndo({
            label: 'the restore',
            run: async () => {
                await postJson('/api/restore', before);
                selectedNodeId = null;
                showSidebarEmpty();
                await loadTree();
                centerTree();
            }
        });
        selectedNodeId = null;
        showSidebarEmpty();
        await loadTree();
        centerTree();
        showToast('Backup restored');
    } catch (err) {
        showToast('Restore failed: ' + err.message, true);
    }
}

function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function findPerson(id) {
    return currentPersons.find(p => p.id === Number(id));
}

function cssVar(name, fallback) {
    const source = document.body || document.documentElement;
    const value = getComputedStyle(source).getPropertyValue(name).trim();
    return value || fallback;
}

function applyTheme(theme) {
    currentTheme = theme || 'white';
    document.body.dataset.theme = currentTheme;
    localStorage.setItem('familytree.theme', currentTheme);
    const select = document.getElementById('themeSelect');
    if (select) select.value = currentTheme;
    drawLines();
}

function toggleLegend() {
    const panel = document.getElementById('legendPanel');
    const button = document.getElementById('legendBtn');
    const isOpen = panel.style.display !== 'none';
    panel.style.display = isOpen ? 'none' : 'block';
    if (button) {
        button.classList.toggle('active', !isOpen);
        button.setAttribute('aria-pressed', String(!isOpen));
    }
}

// --- Rail menus (Add a person / Export) ---
// Only one rail menu is open at a time, and both close on an outside click,
// on Escape, or as soon as an action is chosen.
function closeMenus() {
    document.getElementById('exportMenu').classList.remove('open');
    document.getElementById('addMenu').classList.remove('open');
    document.getElementById('addBtn').setAttribute('aria-expanded', 'false');
    document.querySelectorAll('[aria-haspopup="menu"]').forEach(btn => btn.setAttribute('aria-expanded', 'false'));
}

function toggleAddMenu() {
    const menu = document.getElementById('addMenu');
    const button = document.getElementById('addBtn');
    const willOpen = !menu.classList.contains('open');

    if (willOpen) {
        // Relative options only make sense with someone selected, so the menu
        // says who they would be added to instead of failing after the click.
        const hasSelection = selectedNodeId !== null;
        const person = hasSelection ? findPerson(selectedNodeId) : null;
        menu.querySelectorAll('[data-needs-selection]').forEach(item => { item.disabled = !hasSelection; });
        const hint = document.getElementById('addMenuHint');
        hint.textContent = hasSelection
            ? 'Relative to ' + (person ? person.name : 'the selected person')
            : 'Select someone on the tree to add them as a relative.';
    }

    closeMenus();
    if (willOpen) {
        menu.classList.add('open');
        button.setAttribute('aria-expanded', 'true');
    }
}

function syncCanvasSize() {
    const viewport = document.getElementById('treeViewport');
    const lines = document.getElementById('treeLines');
    const sizer = document.getElementById('treeSizer');

    if (viewport) {
        viewport.style.width = canvasW + 'px';
        viewport.style.height = canvasH + 'px';
    }
    if (lines) {
        lines.style.width = canvasW + 'px';
        lines.style.height = canvasH + 'px';
        lines.setAttribute('width', canvasW);
        lines.setAttribute('height', canvasH);
    }
    if (sizer) {
        sizer.style.width = (canvasW * zoom) + 'px';
        sizer.style.height = (canvasH * zoom) + 'px';
    }
}

function savePersonPosition(p) {
    return fetch(`/api/persons/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pos_x: p.pos_x || 0, pos_y: p.pos_y || 0 })
    });
}

function persistPersonPosition(p) {
    savePersonPosition(p).catch(() => {});
}

function updateNodeElementPositions() {
    currentPersons.forEach(p => {
        const node = document.querySelector(`.tree-node[data-id="${p.id}"]`);
        if (!node) return;
        node.style.left = (p.pos_x || 0) + 'px';
        node.style.top = (p.pos_y || 0) + 'px';
    });
}

function moveCanvasOrigin(shiftX, shiftY, persistShift) {
    if (!shiftX && !shiftY) return;

    canvasW += shiftX;
    canvasH += shiftY;
    currentPersons.forEach(p => {
        p.pos_x = (p.pos_x || 0) + shiftX;
        p.pos_y = (p.pos_y || 0) + shiftY;
    });

    syncCanvasSize();
    updateNodeElementPositions();

    const canvas = document.getElementById('treeCanvas');
    if (canvas) {
        canvas.scrollLeft += shiftX * zoom;
        canvas.scrollTop += shiftY * zoom;
    }

    if (persistShift) currentPersons.forEach(persistPersonPosition);
}

function expandCanvasForPosition(x, y, persistShift) {
    let shiftX = 0;
    let shiftY = 0;

    if (x < 0) shiftX = -x + CANVAS_GROW_PADDING;
    if (y < 0) shiftY = -y + CANVAS_GROW_PADDING;

    if (shiftX || shiftY) {
        moveCanvasOrigin(shiftX, shiftY, persistShift);
        x += shiftX;
        y += shiftY;
    }

    const nextW = Math.max(canvasW, x + NODE_W + CANVAS_GROW_PADDING);
    const nextH = Math.max(canvasH, y + NODE_H + CANVAS_GROW_PADDING);
    if (x + NODE_W + CANVAS_EDGE_PADDING > canvasW || y + NODE_H + CANVAS_EDGE_PADDING > canvasH) {
        canvasW = nextW;
        canvasH = nextH;
        syncCanvasSize();
    }

    return { x: Math.max(0, x), y: Math.max(0, y) };
}

function expandCanvasToFitTree(persistShift) {
    canvasW = INITIAL_CANVAS_W;
    canvasH = INITIAL_CANVAS_H;
    syncCanvasSize();

    if (!currentPersons.length) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    currentPersons.forEach(p => {
        minX = Math.min(minX, p.pos_x || 0);
        minY = Math.min(minY, p.pos_y || 0);
        maxX = Math.max(maxX, p.pos_x || 0);
        maxY = Math.max(maxY, p.pos_y || 0);
    });

    const shiftX = minX < 0 ? -minX + CANVAS_GROW_PADDING : 0;
    const shiftY = minY < 0 ? -minY + CANVAS_GROW_PADDING : 0;
    moveCanvasOrigin(shiftX, shiftY, persistShift);

    currentPersons.forEach(p => {
        maxX = Math.max(maxX, p.pos_x || 0);
        maxY = Math.max(maxY, p.pos_y || 0);
    });

    canvasW = Math.max(INITIAL_CANVAS_W, maxX + NODE_W + CANVAS_GROW_PADDING);
    canvasH = Math.max(INITIAL_CANVAS_H, maxY + NODE_H + CANVAS_GROW_PADDING);
    syncCanvasSize();
}

function formatDate(iso) {
    if (!iso) return '';
    const parts = iso.split('-'); // yyyy-mm-dd from <input type="date">
    if (parts.length !== 3) return iso;
    const [y, m, d] = parts;
    if (dateFormat === 'mdy') return `${m}/${d}/${y}`;
    if (dateFormat === 'ymd') return `${y}-${m}-${d}`;
    return `${d}/${m}/${y}`; // dmy default
}

// --- Image cropper ---
function handlePhotoFileChosen(input, target) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        input.value = '';
        return showToast('Please choose an image file', true);
    }
    openImageCropper(file, target);
}

function openImageCropper(file, target) {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.getElementById('cropCanvas');
        const size = canvas.width;
        const fitScale = Math.max(size / image.width, size / image.height);

        cropperState = {
            target,
            file,
            image,
            viewSize: size,
            fitScale,
            scale: fitScale,
            offsetX: (size - image.width * fitScale) / 2,
            offsetY: (size - image.height * fitScale) / 2,
            dragging: false,
            lastX: 0,
            lastY: 0
        };

        const zoomInput = document.getElementById('cropZoom');
        zoomInput.min = String(Math.round(fitScale * 100));
        zoomInput.max = String(Math.round(fitScale * 300));
        zoomInput.value = String(Math.round(fitScale * 100));

        document.getElementById('imageCropDialog').showModal();
        constrainCropper();
        renderCropper();
    };
    image.onerror = () => {
        URL.revokeObjectURL(url);
        showToast('Could not load that image', true);
    };
    image.src = url;
}

function constrainCropper() {
    if (!cropperState) return;
    const s = cropperState;
    const drawW = s.image.width * s.scale;
    const drawH = s.image.height * s.scale;

    if (drawW <= s.viewSize) {
        s.offsetX = (s.viewSize - drawW) / 2;
    } else {
        s.offsetX = Math.min(0, Math.max(s.viewSize - drawW, s.offsetX));
    }

    if (drawH <= s.viewSize) {
        s.offsetY = (s.viewSize - drawH) / 2;
    } else {
        s.offsetY = Math.min(0, Math.max(s.viewSize - drawH, s.offsetY));
    }
}

function renderCropper() {
    if (!cropperState) return;
    const canvas = document.getElementById('cropCanvas');
    const ctx = canvas.getContext('2d');
    const s = cropperState;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f0f2f2';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(s.image, s.offsetX, s.offsetY, s.image.width * s.scale, s.image.height * s.scale);

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2 - 10, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.restore();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2 - 10, 0, Math.PI * 2);
    ctx.stroke();
}

function cropPointerPosition(e) {
    const canvas = document.getElementById('cropCanvas');
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    return {
        x: (e.clientX - rect.left) * scale,
        y: (e.clientY - rect.top) * scale
    };
}

function onCropPointerDown(e) {
    if (!cropperState) return;
    const pos = cropPointerPosition(e);
    cropperState.dragging = true;
    cropperState.lastX = pos.x;
    cropperState.lastY = pos.y;
    e.currentTarget.setPointerCapture(e.pointerId);
}

function onCropPointerMove(e) {
    if (!cropperState || !cropperState.dragging) return;
    const pos = cropPointerPosition(e);
    cropperState.offsetX += pos.x - cropperState.lastX;
    cropperState.offsetY += pos.y - cropperState.lastY;
    cropperState.lastX = pos.x;
    cropperState.lastY = pos.y;
    constrainCropper();
    renderCropper();
}

function onCropPointerUp() {
    if (!cropperState) return;
    cropperState.dragging = false;
}

function onCropZoomChange() {
    if (!cropperState) return;
    const s = cropperState;
    const oldScale = s.scale;
    const newScale = Number(document.getElementById('cropZoom').value) / 100;
    const center = s.viewSize / 2;

    s.offsetX = center - ((center - s.offsetX) / oldScale) * newScale;
    s.offsetY = center - ((center - s.offsetY) / oldScale) * newScale;
    s.scale = newScale;
    constrainCropper();
    renderCropper();
}

function resetPhotoInput(target) {
    const inputIds = {
        sidebar: 'sidebarPhotoInput',
        quickAdd: 'quickAddPic',
        photoDialog: 'photoDialogInput'
    };
    const input = document.getElementById(inputIds[target]);
    if (input) input.value = '';
}

function closeImageCropper() {
    const target = cropperState ? cropperState.target : null;
    document.getElementById('imageCropDialog').close();
    cropperState = null;
    if (target) resetPhotoInput(target);
}

function canvasToBlob(canvas, type, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

async function applyImageCrop() {
    if (!cropperState) return;
    const s = cropperState;
    const outSize = 512;
    const out = document.createElement('canvas');
    out.width = outSize;
    out.height = outSize;
    const ctx = out.getContext('2d');
    const factor = outSize / s.viewSize;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outSize, outSize);
    ctx.drawImage(
        s.image,
        s.offsetX * factor,
        s.offsetY * factor,
        s.image.width * s.scale * factor,
        s.image.height * s.scale * factor
    );

    const mime = s.file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await canvasToBlob(out, mime, 0.92);
    if (!blob) return showToast('Could not crop image', true);

    const ext = mime === 'image/png' ? 'png' : 'jpg';
    const baseName = s.file.name.replace(/\.[^.]+$/, '') || 'photo';
    const croppedFile = new File([blob], `${baseName}-cropped.${ext}`, { type: mime });
    const previewURL = URL.createObjectURL(blob);
    const target = s.target;

    document.getElementById('imageCropDialog').close();
    cropperState = null;

    resetPhotoInput(target);

    if (target === 'sidebar') {
        document.getElementById('sidebarPhotoPreview').src = previewURL;
        await uploadSelectedPersonPhoto(croppedFile);
    } else if (target === 'quickAdd') {
        quickAddCroppedPhoto = croppedFile;
        document.getElementById('quickAddPreview').src = previewURL;
    } else if (target === 'photoDialog') {
        photoDialogCroppedPhoto = croppedFile;
        document.getElementById('photoDialogPreview').src = previewURL;
    }
}

// --- Data loading ---
async function loadTree() {
    const [personsRes, relsRes] = await Promise.all([
        fetch('/api/persons'),
        fetch('/api/relationships')
    ]);
    currentPersons = (await personsRes.json()) || [];
    currentRelationships = (await relsRes.json()) || [];

    expandCanvasToFitTree(true);
    renderTree();

    if (selectedNodeId !== null) {
        const p = findPerson(selectedNodeId);
        if (p) {
            populateSidebar(p);
        } else {
            selectedNodeId = null;
            showSidebarEmpty();
        }
    }

    updateChecklist();
}

// --- Life events (timeline) ---
let currentEvents = [];

async function loadEvents() {
    try {
        const res = await fetch('/api/events');
        currentEvents = (await res.json()) || [];
    } catch (err) {
        currentEvents = [];
    }
    return currentEvents;
}

// Generation depth for every person: 0 is the earliest ancestor and each step
// down the tree adds one. Used by the timeline and the printable layouts.
function computeGenerations() {
    const idSet = new Set(currentPersons.map(p => p.id));
    const parents = new Map(currentPersons.map(p => [p.id, []]));

    currentRelationships.forEach(rel => {
        const edge = parentChildEdge(rel, idSet);
        if (!edge || !parents.has(edge.child)) return;
        const list = parents.get(edge.child);
        if (!list.includes(edge.parent)) list.push(edge.parent);
    });

    const depth = new Map(currentPersons.map(p => [p.id, 0]));
    // Longest path from a root. The pass limit keeps a cyclic graph from
    // looping forever.
    for (let pass = 0; pass < currentPersons.length; pass++) {
        let changed = false;
        currentPersons.forEach(p => {
            const ps = parents.get(p.id) || [];
            if (!ps.length) return;
            const d = Math.max.apply(null, ps.map(id => (depth.get(id) || 0) + 1));
            if (d > (depth.get(p.id) || 0)) {
                depth.set(p.id, d);
                changed = true;
            }
        });
        if (!changed) break;
    }
    return depth;
}

// --- Relation styling helpers ---
function relationRoleClass(relation) {
    switch (relation) {
        case 'spouse': return 'role-spouse';
        case 'spouse-divorced': return 'role-spouse-divorced';
        case 'child': return 'role-child';
        case 'child-adoptive': return 'role-child-adoptive';
        case 'child-foster': return 'role-child-foster';
        case 'child-guardian': return 'role-child-guardian';
        case 'child-unknown': return 'role-child-unknown';
        case 'sibling-full': return 'role-sibling-full';
        case 'sibling-half': return 'role-sibling-half';
        case 'sibling-step': return 'role-sibling-step';
        default: return 'role-root';
    }
}

function relationStroke(relation) {
    switch (relation) {
        case 'spouse': return { color: cssVar('--spouse', '#d6537e'), dash: '' };
        case 'spouse-divorced': return { color: cssVar('--spouse', '#d6537e'), dash: '8,5' };
        case 'child': return { color: cssVar('--parent', '#d9a441'), dash: '' };
        case 'child-adoptive': return { color: cssVar('--adoptive', '#845ef7'), dash: '' };
        case 'child-foster': return { color: cssVar('--foster', '#0f969f'), dash: '6,4' };
        case 'child-guardian': return { color: cssVar('--guardian', '#2f9e44'), dash: '6,4' };
        case 'child-unknown': return { color: cssVar('--unknown', '#8a9199'), dash: '2,5' };
        case 'sibling-full': return { color: cssVar('--sibling', '#4c6ef5'), dash: '' };
        case 'sibling-half': return { color: cssVar('--sibling', '#4c6ef5'), dash: '6,4' };
        case 'sibling-step': return { color: cssVar('--sibling', '#4c6ef5'), dash: '2,4' };
        default: return { color: cssVar('--root', '#6b8b89'), dash: '' };
    }
}

// Human readable name for a relationship, from the point of view of `selfId`.
function relationLabelFor(rel, selfId) {
    const raw = String(rel.relation || '');
    const selfIsFirst = rel.person1_id === selfId;

    if (raw === 'child' || raw.startsWith('child-')) {
        const subType = raw === 'child' ? '' : raw.slice('child-'.length);
        const qualifiers = { adoptive: 'Adoptive', foster: 'Foster', guardian: 'Guardian', unknown: 'Unknown' };
        const qualifier = qualifiers[subType] || '';
        if (selfIsFirst) return qualifier ? `${qualifier} child` : 'Child';
        return qualifier ? `${qualifier} parent` : 'Parent';
    }
    if (raw === 'spouse') return 'Partner';
    if (raw === 'spouse-divorced') return 'Ex-partner';
    if (raw === 'sibling-full') return 'Full sibling';
    if (raw === 'sibling-half') return 'Half sibling';
    if (raw === 'sibling-step') return 'Step sibling';
    return raw || 'Related';
}

// Short badge for the sidebar header describing how this person was added.
function roleBadgeLabel(relation) {
    switch (relation) {
        case 'child': return 'Child';
        case 'child-adoptive': return 'Adopted child';
        case 'child-foster': return 'Foster child';
        case 'child-guardian': return 'Ward';
        case 'child-unknown': return 'Unknown parentage';
        case 'spouse': return 'Partner';
        case 'spouse-divorced': return 'Ex-partner';
        case 'sibling-full': return 'Full sibling';
        case 'sibling-half': return 'Half sibling';
        case 'sibling-step': return 'Step sibling';
        default: return '';
    }
}

// Determine the "role" of a node: the relation used when it was created
// (it will always appear as person2 in that relationship). This drives the
// node's border color/style so siblings, spouses, and children are visually
// distinct at a glance.
function roleForPerson(id) {
    const rels = currentRelationships.filter(r => r.person2_id === id);
    if (rels.length === 0) return null;
    return rels[rels.length - 1].relation;
}

// --- Rendering ---
function renderTree() {
    const nodesLayer = document.getElementById('treeNodes');
    const empty = document.getElementById('canvasEmpty');
    nodesLayer.innerHTML = '';

    // Extension point: a module may narrow the view (generation limits). It
    // returns the whole list when no limit is set.
    const shown = (typeof window.filterVisiblePersons === 'function')
        ? (window.filterVisiblePersons(currentPersons, currentRelationships) || currentPersons)
        : currentPersons;
    empty.style.display = shown.length ? 'none' : 'block';

    shown.forEach(p => {
        const imgSrc = p.image_url ? p.image_url : placeholderAvatar;
        const role = roleForPerson(p.id);
        const roleClass = relationRoleClass(role);

        const node = document.createElement('div');
        node.className = 'tree-node ' + roleClass;
        if (p.id === selectedNodeId) node.classList.add('selected');
        if (pendingLink && pendingLink.idA === p.id) node.classList.add('link-pending');
        node.dataset.id = p.id;
        node.style.left = (p.pos_x || 0) + 'px';
        node.style.top = (p.pos_y || 0) + 'px';

        let metaLine = '';
        if (p.dob || p.dod) {
            metaLine = `${formatDate(p.dob)}${p.dod ? ' – ' + formatDate(p.dod) : ''}`;
        } else if (p.birth_country) {
            metaLine = p.birth_country;
        } else if (p.profession) {
            metaLine = p.profession;
        }

        node.innerHTML = `
            <div class="tree-avatar">
                <img src="${escapeAttr(imgSrc)}" alt="${escapeAttr(p.name)}">
            </div>
            <div class="tree-name-display">${escapeHtml(p.name)}</div>
            ${metaLine ? `<div class="tree-node-meta">${escapeHtml(metaLine)}</div>` : ''}
            ${p.facts ? `<div class="tree-node-facts">${escapeHtml(p.facts)}</div>` : ''}
        `;

        node.tabIndex = 0;
        node.setAttribute('role', 'button');
        node.setAttribute('aria-label', `${p.name}${metaLine ? ', ' + metaLine : ''}`);
        node.title = [p.name, metaLine, p.profession, p.birth_country].filter(Boolean).join('\n');

        node.addEventListener('mousedown', e => onNodeMouseDown(e, p.id));
        node.addEventListener('keydown', e => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            if (connectMode) handleConnectClick(p.id);
            else selectPerson(p.id);
        });
        nodesLayer.appendChild(node);
    });

    if (!currentPersons.length) {
        const canvas = document.getElementById('treeCanvas');
        if (canvas) { canvas.scrollLeft = 0; canvas.scrollTop = 0; }
    }

    drawLines();
}

function drawLines() {
    const svg = document.getElementById('treeLines');
    svg.innerHTML = '';
    svg.classList.toggle('lines-editable', connectMode);

    const rightward = treeStyle.direction === 'right';

    currentRelationships.forEach(rel => {
        const p1 = findPerson(rel.person1_id);
        const p2 = findPerson(rel.person2_id);
        if (!p1 || !p2) return;
        // A hidden node (generation limit) takes its connectors with it.
        if (typeof window.isPersonVisible === 'function' &&
            (!window.isPersonVisible(p1.id) || !window.isPersonVisible(p2.id))) return;

        const x1 = (p1.pos_x || 0) + NODE_CENTER_X;
        const y1 = (p1.pos_y || 0) + NODE_CENTER_Y;
        const x2 = (p2.pos_x || 0) + NODE_CENTER_X;
        const y2 = (p2.pos_y || 0) + NODE_CENTER_Y;

        const style = relationStroke(rel.relation);

        // A wider, invisible line sits behind the visible one purely to make
        // clicking a thin connector easier when in Edit Connections mode.
        if (connectMode) {
            const hitLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            hitLine.setAttribute('x1', x1);
            hitLine.setAttribute('y1', y1);
            hitLine.setAttribute('x2', x2);
            hitLine.setAttribute('y2', y2);
            hitLine.setAttribute('stroke', 'transparent');
            hitLine.setAttribute('stroke-width', '14');
            hitLine.style.cursor = 'pointer';
            hitLine.addEventListener('click', () => removeConnection(rel.id, p1.name, p2.name));
            svg.appendChild(hitLine);
        }

        const shape = connectorShape(p1, p2, rightward);
        const element = document.createElementNS('http://www.w3.org/2000/svg', shape.tag);
        Object.keys(shape.attributes).forEach(key => {
            element.setAttribute(key, shape.attributes[key]);
        });
        element.setAttribute('stroke', typeof window.connectorColour === 'function'
            ? window.connectorColour(style.color)
            : style.color);
        element.setAttribute('stroke-width', String(typeof window.connectorWidth === 'function'
            ? window.connectorWidth()
            : 2.5));
        if (style.dash) element.setAttribute('stroke-dasharray', style.dash);
        if (shape.tag === 'path') element.setAttribute('fill', 'none');
        svg.appendChild(element);
    });
}

// connectorShape builds the visible line between two cards. Straight keeps
// the original centre to centre line; elbow and curve leave from the edge
// of each card so they read as a chart rather than a scribble.
function connectorShape(p1, p2, rightward) {
    if (treeStyle.connector === 'straight') {
        return {
            tag: 'line',
            attributes: {
                x1: (p1.pos_x || 0) + NODE_CENTER_X,
                y1: (p1.pos_y || 0) + NODE_CENTER_Y,
                x2: (p2.pos_x || 0) + NODE_CENTER_X,
                y2: (p2.pos_y || 0) + NODE_CENTER_Y
            }
        };
    }

    const ax = (p1.pos_x || 0) + NODE_W / 2;
    const ay = (p1.pos_y || 0) + NODE_H;
    const bx = (p2.pos_x || 0) + NODE_W / 2;
    const by = (p2.pos_y || 0);

    if (rightward) {
        const startX = (p1.pos_x || 0) + NODE_W;
        const startY = (p1.pos_y || 0) + NODE_CENTER_Y;
        const endX = (p2.pos_x || 0);
        const endY = (p2.pos_y || 0) + NODE_CENTER_Y;
        if (treeStyle.connector === 'curve') {
            const mid = (startX + endX) / 2;
            return {
                tag: 'path',
                attributes: { d: `M ${startX} ${startY} C ${mid} ${startY}, ${mid} ${endY}, ${endX} ${endY}` }
            };
        }
        const mid = (startX + endX) / 2;
        return {
            tag: 'path',
            attributes: { d: `M ${startX} ${startY} L ${mid} ${startY} L ${mid} ${endY} L ${endX} ${endY}` }
        };
    }

    if (treeStyle.connector === 'curve') {
        const mid = (ay + by) / 2;
        return {
            tag: 'path',
            attributes: { d: `M ${ax} ${ay} C ${ax} ${mid}, ${bx} ${mid}, ${bx} ${by}` }
        };
    }
    const mid = (ay + by) / 2;
    return {
        tag: 'path',
        attributes: { d: `M ${ax} ${ay} L ${ax} ${mid} L ${bx} ${mid} L ${bx} ${by}` }
    };
}

async function removeConnection(relId, name1, name2) {
    askRemoveConnection(relId, `${name1} and ${name2}`);
}

async function askRemoveConnection(relId, label) {
    const rel = currentRelationships.find(r => r.id === relId);
    if (!rel) return;

    const a = findPerson(rel.person1_id);
    const b = findPerson(rel.person2_id);
    const description = label || [a && a.name, b && b.name].filter(Boolean).join(' and ');

    const ok = await showConfirm({
        title: 'Remove this connection?',
        message: `Remove the link between ${description}? You can undo it with Ctrl+Z.`,
        confirmLabel: 'Remove',
        danger: true
    });
    if (!ok) return;

    try {
        const res = await fetch(`/api/relationships/${relId}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 204) throw new Error(await res.text());

        pushUndo({
            label: `removing the link between ${description}`,
            run: async () => {
                await undoRestore([], [Object.assign({}, rel)]);
                await loadTree();
            }
        });

        showToast('Connection removed');
        loadTree();
    } catch (err) {
        showToast('Failed to remove connection: ' + err.message, true);
    }
}

// --- Zoom ---
function applyZoom() {
    document.getElementById('treeViewport').style.transform = `scale(${zoom})`;
    const label = document.getElementById('zoomLabel');
    if (label) label.textContent = Math.round(zoom * 100) + '%';
    syncCanvasSize();
}

function adjustZoom(delta) {
    zoom = Math.max(0.3, Math.min(2.5, Math.round((zoom + delta) * 10) / 10));
    applyZoom();
}

// Fit and center all nodes within the visible canvas viewport, similar to a
// "fit to screen" control in genealogy tools.
function centerTree() {
    const canvas = document.getElementById('treeCanvas');
    if (!currentPersons.length) {
        zoom = 1;
        applyZoom();
        canvas.scrollLeft = 0;
        canvas.scrollTop = 0;
        return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    currentPersons.forEach(p => {
        minX = Math.min(minX, p.pos_x || 0);
        minY = Math.min(minY, p.pos_y || 0);
        maxX = Math.max(maxX, (p.pos_x || 0) + NODE_W);
        maxY = Math.max(maxY, (p.pos_y || 0) + NODE_H);
    });

    const pad = 80;
    const contentW = (maxX - minX) + pad * 2;
    const contentH = (maxY - minY) + pad * 2;

    const viewW = canvas.clientWidth;
    const viewH = canvas.clientHeight;

    zoom = Math.max(0.3, Math.min(2, Math.min(viewW / contentW, viewH / contentH)));
    zoom = Math.round(zoom * 100) / 100;
    applyZoom();

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    canvas.scrollLeft = Math.max(0, centerX * zoom - viewW / 2);
    canvas.scrollTop = Math.max(0, centerY * zoom - viewH / 2);
}

// Scroll the canvas so a person sits in the middle of the view. Used by the
// search results, the breadcrumb trail and the "Centre" toolbar button.
function centerOnPerson(id) {
    const p = findPerson(id);
    if (!p) return;
    const canvas = document.getElementById('treeCanvas');
    if (zoom < 0.55) { zoom = 0.8; applyZoom(); }
    const cx = (p.pos_x || 0) + NODE_W / 2;
    const cy = (p.pos_y || 0) + NODE_H / 2;
    const left = Math.max(0, cx * zoom - canvas.clientWidth / 2);
    const top = Math.max(0, cy * zoom - canvas.clientHeight / 2);
    if (typeof canvas.scrollTo === 'function') {
        canvas.scrollTo({ left, top, behavior: 'smooth' });
    } else {
        canvas.scrollLeft = left;
        canvas.scrollTop = top;
    }
}

function focusSelected() {
    if (selectedNodeId === null) return showToast('Select a person first', true);
    centerOnPerson(selectedNodeId);
}

// Select someone, centre the view on them and flash the card briefly.
function jumpToPerson(id) {
    selectPerson(id);
    centerOnPerson(id);
    if (sidebarCollapsed) toggleSidebar();
    const node = document.querySelector(`.tree-node[data-id="${id}"]`);
    if (node) {
        node.classList.remove('flash');
        void node.offsetWidth; // restart the animation
        node.classList.add('flash');
        setTimeout(() => node.classList.remove('flash'), 3600);
    }
}

function comparePeopleByNameOrPosition(aId, bId) {
    const a = findPerson(aId);
    const b = findPerson(bId);
    const ax = a ? (a.pos_x || 0) : 0;
    const bx = b ? (b.pos_x || 0) : 0;
    if (ax !== bx) return ax - bx;

    const nameCompare = String(a ? a.name : '').localeCompare(String(b ? b.name : ''));
    if (nameCompare !== 0) return nameCompare;
    return Number(aId) - Number(bId);
}

function addUnique(map, key, value) {
    if (!map.has(key)) map.set(key, []);
    const values = map.get(key);
    if (!values.includes(value)) values.push(value);
}

function parentCenterX(parentIds, positions) {
    const parentCenters = parentIds
        .map(id => positions.get(id))
        .filter(Boolean)
        .map(pos => pos.x + NODE_CENTER_X);

    if (!parentCenters.length) return null;
    return parentCenters.reduce((sum, x) => sum + x, 0) / parentCenters.length - NODE_CENTER_X;
}

function parentChildEdge(rel, personIdSet) {
    if (!personIdSet.has(rel.person1_id) || !personIdSet.has(rel.person2_id)) return null;
    const relation = String(rel.relation || '').toLowerCase();

    // Accept child-of style imports as child -> parent first: they would
    // otherwise be caught by the "child..." prefix rule below.
    if (relation === 'child-of' || relation === 'child_of' || relation === 'son' || relation === 'daughter') {
        return { parent: rel.person2_id, child: rel.person1_id };
    }

    // The app stores parent -> child as relation "child", plus the subtypes
    // child-adoptive, child-foster, child-guardian and child-unknown. Older
    // data and manual imports may use father/mother/parent with the same
    // direction.
    if (
        relation === 'child' || relation.startsWith('child-') ||
        relation === 'father' || relation === 'mother' || relation === 'parent' ||
        relation === 'parent-of' || relation === 'parent_of' || relation === 'father-of' || relation === 'mother-of'
    ) {
        return { parent: rel.person1_id, child: rel.person2_id };
    }

    return null;
}

function hasDirectParentChild(edgeSet, idA, idB) {
    return edgeSet.has(`${idA}:${idB}`) || edgeSet.has(`${idB}:${idA}`);
}

function calculateTreeLayout() {
    const horizontalGap = 220;
    const verticalGap = 220;
    const startX = 260;
    const startY = 180;

    const personIds = currentPersons.map(p => p.id);
    const personIdSet = new Set(personIds);
    const parentsByChild = new Map(personIds.map(id => [id, []]));
    const childrenByParent = new Map(personIds.map(id => [id, []]));
    const childEdges = currentRelationships
        .map(rel => parentChildEdge(rel, personIdSet))
        .filter(Boolean);
    const childEdgeSet = new Set(childEdges.map(edge => `${edge.parent}:${edge.child}`));

    childEdges.forEach(edge => {
        addUnique(parentsByChild, edge.child, edge.parent);
        addUnique(childrenByParent, edge.parent, edge.child);
    });

    personIds.forEach(id => {
        parentsByChild.get(id).sort(comparePeopleByNameOrPosition);
        childrenByParent.get(id).sort(comparePeopleByNameOrPosition);
    });

    const depthById = new Map(personIds.map(id => [id, 0]));
    const indegreeById = new Map(personIds.map(id => [id, parentsByChild.get(id).length]));
    const queue = personIds.filter(id => indegreeById.get(id) === 0).sort(comparePeopleByNameOrPosition);

    for (let i = 0; i < queue.length; i++) {
        const parentId = queue[i];
        const parentDepth = depthById.get(parentId) || 0;
        childrenByParent.get(parentId).forEach(childId => {
            depthById.set(childId, Math.max(depthById.get(childId) || 0, parentDepth + 1));
            indegreeById.set(childId, indegreeById.get(childId) - 1);
            if (indegreeById.get(childId) === 0) queue.push(childId);
        });
    }

    // If the relationship graph has cycles or disconnected fragments, still push
    // children below known parents as much as possible without relying on a full
    // topological order.
    for (let i = 0; i < personIds.length; i++) {
        let changed = false;
        childEdges.forEach(edge => {
            const nextDepth = (depthById.get(edge.parent) || 0) + 1;
            if (nextDepth > (depthById.get(edge.child) || 0)) {
                depthById.set(edge.child, nextDepth);
                changed = true;
            }
        });
        if (!changed) break;
    }

    // Keep partners and siblings on the same generation, but never let those
    // same-generation links override an explicit parent-child relationship.
    for (let i = 0; i < personIds.length; i++) {
        let changed = false;
        currentRelationships.forEach(rel => {
            const relation = String(rel.relation || '').toLowerCase();
            const sameGeneration = relation === 'spouse' || relation.startsWith('spouse-') || relation.startsWith('sibling-');
            if (!sameGeneration || !personIdSet.has(rel.person1_id) || !personIdSet.has(rel.person2_id)) return;
            if (hasDirectParentChild(childEdgeSet, rel.person1_id, rel.person2_id)) return;

            const sharedDepth = Math.max(depthById.get(rel.person1_id) || 0, depthById.get(rel.person2_id) || 0);
            if ((depthById.get(rel.person1_id) || 0) !== sharedDepth) {
                depthById.set(rel.person1_id, sharedDepth);
                changed = true;
            }
            if ((depthById.get(rel.person2_id) || 0) !== sharedDepth) {
                depthById.set(rel.person2_id, sharedDepth);
                changed = true;
            }
        });
        if (!changed) break;
    }

    const positions = new Map();
    const maxDepth = Math.max(0, ...Array.from(depthById.values()));

    for (let depth = 0; depth <= maxDepth; depth++) {
        const rowIds = personIds
            .filter(id => (depthById.get(id) || 0) === depth)
            .sort(comparePeopleByNameOrPosition);
        const groupsByParent = new Map();

        rowIds.forEach(id => {
            const parents = parentsByChild.get(id).filter(parentId => (depthById.get(parentId) || 0) < depth);
            const key = parents.length ? 'parents:' + parents.join(',') : 'solo:' + id;
            if (!groupsByParent.has(key)) groupsByParent.set(key, { parents, ids: [] });
            groupsByParent.get(key).ids.push(id);
        });

        const groups = Array.from(groupsByParent.values()).sort((a, b) => {
            const aCenter = parentCenterX(a.parents, positions);
            const bCenter = parentCenterX(b.parents, positions);
            if (aCenter !== null && bCenter !== null) {
                if (aCenter !== bCenter) return aCenter - bCenter;
                return comparePeopleByNameOrPosition(a.ids[0], b.ids[0]);
            }
            if (aCenter !== null) return -1;
            if (bCenter !== null) return 1;
            return comparePeopleByNameOrPosition(a.ids[0], b.ids[0]);
        });

        let nextX = startX;
        groups.forEach(group => {
            group.ids.sort(comparePeopleByNameOrPosition);
            const preferredX = parentCenterX(group.parents, positions);
            const groupWidth = (group.ids.length - 1) * horizontalGap;
            let groupStartX = preferredX === null ? nextX : preferredX - groupWidth / 2;
            groupStartX = Math.max(groupStartX, nextX);

            group.ids.forEach((id, index) => {
                positions.set(id, {
                    x: Math.round(groupStartX + index * horizontalGap),
                    y: startY + depth * verticalGap
                });
            });

            nextX = groupStartX + group.ids.length * horizontalGap + horizontalGap * 0.75;
        });
    }

    return positions;
}

async function resetTreeLayout() {
    if (!currentPersons.length) return showToast('Nothing to arrange yet', true);

    const ok = await showConfirm({
        title: 'Re-arrange the tree?',
        message: 'Everyone moves into parent-to-child generations. Manual positions are replaced — you can undo it with Ctrl+Z.',
        confirmLabel: 'Arrange',
        danger: false
    });
    if (!ok) return;
    await applyTreeLayout();
}

// applyTreeLayout puts everyone into generations and saves the new positions.
// It can be undone, and it is the same work whether it was asked for from
// the layout panel or from a reload.
async function applyTreeLayout() {
    if (!currentPersons.length) return showToast('Nothing to arrange yet', true);

    const snapshot = currentPersons.map(p => ({ id: p.id, pos_x: p.pos_x || 0, pos_y: p.pos_y || 0 }));

    const positions = calculateTreeLayout();
    currentPersons.forEach(p => {
        const pos = positions.get(p.id);
        if (!pos) return;
        p.pos_x = pos.x;
        p.pos_y = pos.y;
    });

    // When the tree runs left to right, the generations are transposed.
    if (treeStyle.direction === 'right') {
        currentPersons.forEach(p => {
            const x = p.pos_x || 0;
            p.pos_x = p.pos_y || 0;
            p.pos_y = x;
        });
    }

    expandCanvasToFitTree(false);
    renderTree();
    centerTree();

    pushUndo({
        label: 'the auto-layout',
        run: async () => {
            await Promise.all(snapshot.map(point => fetch(`/api/persons/${point.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pos_x: point.pos_x, pos_y: point.pos_y })
            }).then(res => { if (!res.ok) throw new Error('could not restore a position'); })));
            await loadTree();
            centerTree();
        }
    });

    try {
        const responses = await Promise.all(currentPersons.map(savePersonPosition));
        const failed = responses.find(res => !res.ok);
        if (failed) throw new Error(await failed.text());
        showToast('Tree layout reset');
    } catch (err) {
        showToast('Layout changed, but failed to save positions: ' + err.message, true);
    }
}

function onCanvasWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return; // require modifier so normal scrolling still works
    e.preventDefault();
    adjustZoom(e.deltaY < 0 ? 0.1 : -0.1);
}

// --- Pan (drag on empty canvas background) ---
function onCanvasMouseDown(e) {
    if (e.target.closest('.tree-node')) return; // node dragging takes over
    if (connectMode) return;
    e.preventDefault();
    const canvas = document.getElementById('treeCanvas');
    panState = {
        startX: e.clientX,
        startY: e.clientY,
        scrollLeft: canvas.scrollLeft,
        scrollTop: canvas.scrollTop
    };
    document.addEventListener('mousemove', onCanvasMouseMove);
    document.addEventListener('mouseup', onCanvasMouseUp);
}

function onCanvasMouseMove(e) {
    if (!panState) return;
    const canvas = document.getElementById('treeCanvas');
    canvas.scrollLeft = panState.scrollLeft - (e.clientX - panState.startX);
    canvas.scrollTop = panState.scrollTop - (e.clientY - panState.startY);
}

function autoScrollCanvasForPointer(e) {
    const canvas = document.getElementById('treeCanvas');
    const rect = canvas.getBoundingClientRect();
    const edge = 80;
    const step = 28;

    if (e.clientX > rect.right - edge) canvas.scrollLeft += step;
    else if (e.clientX < rect.left + edge) canvas.scrollLeft -= step;

    if (e.clientY > rect.bottom - edge) canvas.scrollTop += step;
    else if (e.clientY < rect.top + edge) canvas.scrollTop -= step;
}

function onCanvasMouseUp() {
    panState = null;
    document.removeEventListener('mousemove', onCanvasMouseMove);
    document.removeEventListener('mouseup', onCanvasMouseUp);
}

// --- Dragging / selecting nodes ---
function onNodeMouseDown(e, id) {
    if (e.target.closest('button')) return;
    e.preventDefault();
    e.stopPropagation();

    const node = document.querySelector(`.tree-node[data-id="${id}"]`);
    const viewportRect = document.getElementById('treeViewport').getBoundingClientRect();
    const mouseX = (e.clientX - viewportRect.left) / zoom;
    const mouseY = (e.clientY - viewportRect.top) / zoom;
    const startX = mouseX - node.offsetLeft;
    const startY = mouseY - node.offsetTop;

    dragState = {
        id, startX, startY, node,
        moved: false,
        downClientX: e.clientX, downClientY: e.clientY
    };
    document.addEventListener('mousemove', onNodeMouseMove);
    document.addEventListener('mouseup', onNodeMouseUp);
}

function onNodeMouseMove(e) {
    if (!dragState) return;

    if (!dragState.moved) {
        const dx = e.clientX - dragState.downClientX;
        const dy = e.clientY - dragState.downClientY;
        if (Math.sqrt(dx * dx + dy * dy) < CLICK_DRAG_THRESHOLD) return;
        dragState.moved = true;
        dragState.node.classList.add('dragging');
    }

    autoScrollCanvasForPointer(e);

    const viewportRect = document.getElementById('treeViewport').getBoundingClientRect();
    const mouseX = (e.clientX - viewportRect.left) / zoom;
    const mouseY = (e.clientY - viewportRect.top) / zoom;
    let x = mouseX - dragState.startX;
    let y = mouseY - dragState.startY;
    const expandedPosition = expandCanvasForPosition(x, y, true);
    x = expandedPosition.x;
    y = expandedPosition.y;

    dragState.node.style.left = x + 'px';
    dragState.node.style.top = y + 'px';

    const p = findPerson(dragState.id);
    if (p) { p.pos_x = x; p.pos_y = y; }
    drawLines();
}

async function onNodeMouseUp() {
    if (!dragState) return;
    const { id, moved, node } = dragState;
    node.classList.remove('dragging');
    document.removeEventListener('mousemove', onNodeMouseMove);
    document.removeEventListener('mouseup', onNodeMouseUp);
    dragState = null;

    if (moved) {
        const p = findPerson(id);
        if (p && !isReadOnlyView()) {
            try {
                await fetch(`/api/persons/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pos_x: p.pos_x, pos_y: p.pos_y })
                });
            } catch (err) {
                showToast('Failed to save position: ' + err.message, true);
            }
        }
        return;
    }

    // Treated as a click, not a drag.
    if (connectMode) {
        handleConnectClick(id);
    } else {
        selectPerson(id);
    }
}

// --- Sidebar: selection & editing ---
function selectPerson(id) {
    selectedNodeId = id;
    renderTree();
    const p = findPerson(id);
    if (p) populateSidebar(p);
}

function showSidebarEmpty() {
    document.getElementById('sidebarEmpty').style.display = 'block';
    document.getElementById('sidebarContent').style.display = 'none';
    document.getElementById('sidebarFooter').style.display = 'none';
}

function clearSelection() {
    if (selectedNodeId === null) return;
    selectedNodeId = null;
    renderTree();
    showSidebarEmpty();
}

function lifespanLabel(p) {
    if (p.dob && p.dod) return `${formatDate(p.dob)} – ${formatDate(p.dod)}`;
    if (p.dob) return `b. ${formatDate(p.dob)}`;
    if (p.dod) return `d. ${formatDate(p.dod)}`;
    if (p.birth_country) return p.birth_country;
    if (p.profession) return p.profession;
    return '';
}

function populateSidebar(p) {
    document.getElementById('sidebarEmpty').style.display = 'none';
    document.getElementById('sidebarContent').style.display = 'block';
    document.getElementById('sidebarFooter').style.display = 'flex';

    // Header card
    document.getElementById('sidebarAvatar').src = p.image_url || placeholderAvatar;
    document.getElementById('sidebarAvatar').alt = p.name || 'Photo';
    document.getElementById('sidebarPersonName').textContent = p.name || '';
    document.getElementById('sidebarPersonDates').textContent = lifespanLabel(p);
    const roleBadge = document.getElementById('sidebarPersonRole');
    const badge = roleBadgeLabel(roleForPerson(p.id));
    roleBadge.textContent = badge;
    roleBadge.hidden = !badge;

    // Fields
    document.getElementById('fieldName').value = p.name || '';
    document.getElementById('fieldDob').value = p.dob || '';
    document.getElementById('fieldDod').value = p.dod || '';
    document.getElementById('fieldBirthCountry').value = p.birth_country || '';
    document.getElementById('fieldProfession').value = p.profession || '';
    document.getElementById('fieldFacts').value = p.facts || '';
    document.getElementById('sidebarPhotoPreview').src = p.image_url || placeholderAvatar;
    document.getElementById('sidebarPhotoInput').value = '';

    renderConnections(p);
    renderLineage(p);
    if (typeof window.renderEventsPanel === 'function') window.renderEventsPanel();
    // Extension point: feature modules add their own sections to this person's
    // panel (sources, media, merge) without editing this file.
    if (typeof window.onPersonPanelRendered === 'function') window.onPersonPanelRendered(p);
    clearDirty();
}

function markDirty() {
    if (sidebarDirty) return;
    sidebarDirty = true;
    document.getElementById('dirtyIndicator').hidden = false;
    document.getElementById('savePersonBtn').disabled = false;
}

function clearDirty() {
    sidebarDirty = false;
    document.getElementById('dirtyIndicator').hidden = true;
    document.getElementById('savePersonBtn').disabled = true;
}

// --- Connections list for the selected person ---
function renderConnections(p) {
    const list = document.getElementById('connectionsList');
    const rels = currentRelationships.filter(r => r.person1_id === p.id || r.person2_id === p.id);

    if (!rels.length) {
        list.innerHTML = '<div class="connections-empty">No connections yet.<br>Add a relative above, or use Link mode to join two existing people.</div>';
        return;
    }

    list.innerHTML = rels.map(rel => {
        const otherId = rel.person1_id === p.id ? rel.person2_id : rel.person1_id;
        const other = findPerson(otherId);
        if (!other) return '';
        const label = relationLabelFor(rel, p.id);
        return `
            <div class="connection-row">
                <button class="connection-open" onclick="jumpToPerson(${other.id})" title="Jump to ${escapeAttr(other.name)}">
                    <span class="connection-type">${escapeHtml(label)}</span>
                    <span class="connection-name">${escapeHtml(other.name)}</span>
                </button>
                <button class="connection-remove" onclick="askRemoveConnection(${rel.id})" title="Remove this connection">×</button>
            </div>`;
    }).join('');
}

// --- Ancestry breadcrumb: earliest ancestor › … › selected person ---
function parentIdsOf(id) {
    const idSet = new Set(currentPersons.map(p => p.id));
    return currentRelationships
        .map(rel => parentChildEdge(rel, idSet))
        .filter(Boolean)
        .filter(edge => edge.child === id)
        .map(edge => edge.parent);
}

function renderLineage(p) {
    const nav = document.getElementById('lineageCrumbs');
    const chain = [p.id];
    const seen = new Set(chain);

    let cursor = p.id;
    for (let guard = 0; guard < 40; guard++) {
        const parents = parentIdsOf(cursor)
            .filter(id => !seen.has(id))
            .sort(comparePeopleByNameOrPosition);
        if (!parents.length) break;
        cursor = parents[0];
        chain.unshift(cursor);
        seen.add(cursor);
    }

    if (chain.length < 2) { nav.innerHTML = ''; return; }

    nav.innerHTML = chain.map((id, index) => {
        const person = findPerson(id);
        if (!person) return '';
        const current = id === p.id ? ' current' : '';
        const sep = index ? '<span class="crumb-sep" aria-hidden="true"><svg class="icon"><use href="#i-chevron-right"/></svg></span>' : '';
        return `${sep}<button class="crumb${current}" onclick="jumpToPerson(${id})" title="${escapeAttr(person.name)}">${escapeHtml(person.name)}</button>`;
    }).join('');
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.style.display = panel.dataset.panel === tab ? 'block' : 'none';
    });
    if (tab === 'events' && typeof window.renderEventsPanel === 'function') window.renderEventsPanel();
}

async function saveSelectedPerson() {
    if (selectedNodeId === null) return;
    if (isReadOnlyView()) return showToast('This tree is shared read-only', true);
    const body = {
        name: document.getElementById('fieldName').value.trim(),
        dob: document.getElementById('fieldDob').value,
        dod: document.getElementById('fieldDod').value,
        birth_country: document.getElementById('fieldBirthCountry').value.trim(),
        profession: document.getElementById('fieldProfession').value.trim(),
        facts: document.getElementById('fieldFacts').value.trim()
    };
    if (!body.name) return showToast('Name cannot be empty', true);

    try {
        const res = await fetch(`/api/persons/${selectedNodeId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(await res.text());
        showToast('Person saved');
        clearDirty();
        loadTree();
    } catch (err) {
        showToast('Failed to save: ' + err.message, true);
    }
}

async function uploadSelectedPersonPhoto(file) {
    if (selectedNodeId === null || !file) return;
    if (isReadOnlyView()) return showToast('This tree is shared read-only', true);

    const formData = new FormData();
    formData.append('pic', file);

    try {
        const res = await fetch(`/api/persons/${selectedNodeId}/photo`, { method: 'POST', body: formData });
        if (!res.ok) throw new Error(await res.text());
        showToast('Photo updated');
        loadTree();
    } catch (err) {
        showToast('Failed to upload photo: ' + err.message, true);
    }
}

async function deleteSelectedPerson() {
    if (selectedNodeId === null) return;
    if (isReadOnlyView()) return showToast('This tree is shared read-only', true);
    const p = findPerson(selectedNodeId);
    if (!p) return;
    const name = p.name || 'this person';
    const links = currentRelationships.filter(r => r.person1_id === p.id || r.person2_id === p.id);

    const ok = await showConfirm({
        title: `Delete ${name}?`,
        message: links.length
            ? `This removes ${name} from the tree along with ${links.length} ${links.length === 1 ? 'connection' : 'connections'}. You can undo it with Ctrl+Z.`
            : `This removes ${name} from the tree. You can undo it with Ctrl+Z.`,
        confirmLabel: 'Delete',
        danger: true
    });
    if (!ok) return;

    const personSnapshot = Object.assign({}, p);
    const linkSnapshot = links.map(rel => Object.assign({}, rel));
    const eventSnapshot = currentEvents
        .filter(ev => ev.person_id === p.id)
        .map(ev => Object.assign({}, ev));

    try {
        const res = await fetch(`/api/persons/${selectedNodeId}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 204) throw new Error(await res.text());

        pushUndo({
            label: `deleting ${name}`,
            run: async () => {
                await undoRestore([personSnapshot], linkSnapshot, eventSnapshot);
                selectedNodeId = personSnapshot.id;
                await loadEvents();
                await loadTree();
            }
        });

        showToast(`${name} removed`);
        selectedNodeId = null;
        showSidebarEmpty();
        loadTree();
    } catch (err) {
        showToast('Failed to delete person: ' + err.message, true);
    }
}

// A shared read-only view is a copy of the tree on somebody else's screen:
// nothing here may be written back.
function isReadOnlyView() {
    return document.body.classList.contains('ft-readonly');
}

// --- Sidebar collapse/expand ---
// The panel is a fixed column on wide screens and a drawer over the canvas on
// narrow ones, so the collapsed state is re-synced whenever the layout
// crosses that breakpoint.
let narrowViewport = false;

function applySidebarState() {
    document.getElementById('sidebar').classList.toggle('collapsed', sidebarCollapsed);
    document.getElementById('sidebarExpandBtn').style.display = sidebarCollapsed ? 'block' : 'none';
}

function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    applySidebarState();
}

function syncSidebarToViewport() {
    const narrow = window.innerWidth <= 820;
    if (narrow === narrowViewport) return;
    narrowViewport = narrow;
    sidebarCollapsed = narrow;
    applySidebarState();
}

// --- Edit Connections mode ---
function setConnectMode(on) {
    connectMode = on;
    const button = document.getElementById('connectBtn');
    button.classList.toggle('active', connectMode);
    button.setAttribute('aria-pressed', String(connectMode));
    document.getElementById('connectHint').style.display = connectMode ? 'flex' : 'none';
    document.getElementById('treeCanvas').classList.toggle('connect-mode', connectMode);
    if (!connectMode) pendingLink = null;  // leaving the mode drops the pick
    updateConnectHint();
    renderTree();
}

// The Link button: it starts the mode, cancels it, and — when one person is
// already picked — opens the link dialog so the second person can be chosen
// there instead of on the canvas.
function onLinkButtonClick() {
    if (!connectMode) {
        setConnectMode(true);
        return;
    }
    if (pendingLink) {
        const first = pendingLink.idA;
        pendingLink = null;
        setConnectMode(false);
        openLinkDialog(first, null);
        return;
    }
    setConnectMode(false);
}

function updateConnectHint() {
    const hint = document.getElementById('connectHint');
    if (!hint) return;
    const text = hint.querySelector('span');
    if (!text) return;
    if (pendingLink) {
        const person = findPerson(pendingLink.idA);
        text.innerHTML = `<strong>${escapeHtml(person ? person.name : 'This person')}</strong> is picked — now click the person to link them with, or press Link to choose from a list.`;
    } else {
        text.innerHTML = 'Click a person, then a second person to link them. Click an existing line to remove it. <kbd>Esc</kbd> exits.';
    }
}

function toggleConnectMode() {
    setConnectMode(!connectMode);
}

function handleConnectClick(id) {
    if (!pendingLink) {
        pendingLink = { idA: id };
        updateConnectHint();
        renderTree();
        showToast('Now click a second person to connect');
        return;
    }
    if (pendingLink.idA === id) {
        pendingLink = null;
        updateConnectHint();
        renderTree();
        return;
    }
    const first = pendingLink.idA;
    pendingLink = null;
    updateConnectHint();
    openLinkDialog(first, id);
}

// Directional map for the manual "Connect People" dialog: the option value in
// the select → the stored relation plus which click is person1/person2.
const LINK_CHOICES = {
    'a-parent-of-b': { relation: 'child', first: 'p1' },
    'a-adoptive-parent-of-b': { relation: 'child-adoptive', first: 'p1' },
    'a-foster-parent-of-b': { relation: 'child-foster', first: 'p1' },
    'a-guardian-of-b': { relation: 'child-guardian', first: 'p1' },
    'a-unknown-parent-of-b': { relation: 'child-unknown', first: 'p1' },
    'b-parent-of-a': { relation: 'child', first: 'p2' },
    'b-adoptive-parent-of-a': { relation: 'child-adoptive', first: 'p2' },
    'spouse': { relation: 'spouse', first: 'symmetric' },
    'spouse-divorced': { relation: 'spouse-divorced', first: 'symmetric' },
    'sibling-full': { relation: 'sibling-full', first: 'symmetric' },
    'sibling-half': { relation: 'sibling-half', first: 'symmetric' },
    'sibling-step': { relation: 'sibling-step', first: 'symmetric' }
};

function isParentChildRelation(relation) {
    const value = String(relation || '').toLowerCase();
    return value === 'child' || value.startsWith('child-') ||
        value === 'father' || value === 'mother' || value === 'parent' ||
        value === 'parent-of' || value === 'parent_of';
}

// Returns an error message, or null when the link is safe to create. Used
// before creating a person-and-link in one go and before a manual link.
function linkError(person1, person2, relation) {
    if (person1 === person2) return 'Pick two different people';

    const sameDirection = currentRelationships.some(r =>
        r.relation === relation && r.person1_id === person1 && r.person2_id === person2);
    const mirrored = currentRelationships.some(r =>
        r.relation === relation && r.person1_id === person2 && r.person2_id === person1);
    const symmetric = !isParentChildRelation(relation);

    if (sameDirection || (symmetric && mirrored)) {
        return 'Those two are already linked that way';
    }

    if (isParentChildRelation(relation)) {
        const idSet = new Set(currentPersons.map(p => p.id));
        const cycle = currentRelationships.some(rel => {
            const edge = parentChildEdge(rel, idSet);
            return edge && edge.parent === person2 && edge.child === person1;
        });
        if (cycle) return 'That would make them their own ancestor';
    }

    return null;
}

// openLinkDialog opens the link form. The two people can be picked in the
// dialog, which is how the flow is completed when clicking two cards on the
// canvas is awkward.
function openLinkDialog(idA, idB) {
    pendingLink = { idA, idB: idB || null };

    const options = currentPersons
        .map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
        .join('');
    const selectA = document.getElementById('linkPersonA');
    const selectB = document.getElementById('linkPersonB');
    selectA.innerHTML = '<option value="">Choose a person…</option>' + options;
    selectB.innerHTML = '<option value="">Choose a person…</option>' + options;
    if (idA) selectA.value = String(idA);
    if (idB) selectB.value = String(idB);

    document.getElementById('linkRelationType').value = 'spouse';
    updateLinkDialogNames();
    document.getElementById('linkDialog').showModal();
}

// The line under the pickers spells out which way the relationship points,
// because the direction decides what "parent of" means.
function updateLinkDialogNames() {
    const a = findPerson(Number(document.getElementById('linkPersonA').value));
    const b = findPerson(Number(document.getElementById('linkPersonB').value));
    const names = document.getElementById('linkDialogNames');
    if (a && b) {
        names.textContent = `${a.name} (first) ↔ ${b.name} (second)`;
    } else {
        names.textContent = 'Choose two people.';
    }
}

function closeLinkDialog() {
    document.getElementById('linkDialog').close();
    pendingLink = null;
}

async function submitLinkDialog() {
    if (!pendingLink) return;
    const idA = Number(document.getElementById('linkPersonA').value);
    const idB = Number(document.getElementById('linkPersonB').value);
    if (!idA || !idB) return showToast('Choose two people', true);
    if (idA === idB) return showToast('Pick two different people', true);
    pendingLink = { idA, idB };
    const choice = document.getElementById('linkRelationType').value;
    const mapping = LINK_CHOICES[choice] || { relation: choice, first: 'symmetric' };

    let person1 = idA, person2 = idB;
    if (mapping.first === 'p2') { person1 = idB; person2 = idA; }

    const problem = linkError(person1, person2, mapping.relation);
    if (problem) return showToast(problem, true);

    try {
        const res = await fetch('/api/relationships', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ person1_id: person1, person2_id: person2, relation: mapping.relation })
        });
        if (!res.ok) throw new Error(await res.text());
        showToast('Linked');
        document.getElementById('linkDialog').close();
        pendingLink = null;
        loadTree();
    } catch (err) {
        showToast('Failed to link: ' + err.message, true);
    }
}

// --- Quick add (root / parent / spouse / sibling / child) ---
// Sidebar buttons always act relative to the currently selected node; only
// the "root" (first-ever person) case has no anchor.
function openQuickAdd(anchorIdArg, type) {
    closeMenus();
    const anchorId = type === 'root' ? null : selectedNodeId;
    if (type !== 'root' && anchorId === null) {
        return showToast('Select a person first', true);
    }
    pendingQuickAdd = { anchorId, type };

    const titles = {
        root: 'Add Person',
        parent: 'Add Parent',
        spouse: 'Add Partner',
        sibling: 'Add Sibling',
        child: 'Add Child'
    };
    document.getElementById('quickAddTitle').textContent = titles[type] || 'Add Person';
    document.getElementById('quickAddName').value = '';
    document.getElementById('quickAddDob').value = '';
    document.getElementById('quickAddPic').value = '';
    quickAddCroppedPhoto = null;
    document.getElementById('quickAddPreview').src = placeholderAvatar;
    document.getElementById('quickAddSiblingRow').style.display = type === 'sibling' ? 'block' : 'none';
    document.getElementById('quickAddParentRow').style.display = type === 'parent' ? 'block' : 'none';
    document.getElementById('quickAddPartnerRow').style.display = type === 'spouse' ? 'block' : 'none';

    document.getElementById('quickAddDialog').showModal();
    setTimeout(() => document.getElementById('quickAddName').focus(), 50);
}

function closeQuickAdd() {
    document.getElementById('quickAddDialog').close();
    pendingQuickAdd = null;
    quickAddCroppedPhoto = null;
}

function previewQuickAddPhoto() {
    handlePhotoFileChosen(document.getElementById('quickAddPic'), 'quickAdd');
}

// Compute a sensible default position for a newly added node relative to its
// anchor, spreading out multiple children/siblings/parents so they don't stack.
function computePosition(anchorId, type) {
    let x;
    let y;

    if (!anchorId) {
        const rootCount = currentPersons.filter(p => roleForPerson(p.id) === null).length;
        // Start with headroom above (y=260) so a parent can later be added above this node.
        x = 260 + rootCount * 60;
        y = 260 + rootCount * 60;
        return expandCanvasForPosition(x, y, true);
    }

    const anchor = findPerson(anchorId);
    const ax = anchor.pos_x || 0;
    const ay = anchor.pos_y || 0;

    if (type === 'spouse') {
        const spouseCount = currentRelationships.filter(r =>
            (r.person1_id === anchorId || r.person2_id === anchorId) &&
            String(r.relation || '').startsWith('spouse')).length;
        x = ax + 180;
        y = ay + spouseCount * 170;
    } else if (type === 'sibling') {
        const siblingCount = currentRelationships.filter(r =>
            (r.person1_id === anchorId || r.person2_id === anchorId) &&
            String(r.relation || '').startsWith('sibling-')).length;
        x = ax - 180 - siblingCount * 180;
        y = ay;
    } else if (type === 'child') {
        const childCount = currentRelationships.filter(r =>
            r.person1_id === anchorId && isParentChildRelation(r.relation)).length;
        x = ax + childCount * 170 - (childCount > 0 ? 85 : 0);
        y = ay + 200;
    } else if (type === 'parent') {
        const parentCount = currentRelationships.filter(r =>
            r.person2_id === anchorId && isParentChildRelation(r.relation)).length;
        x = ax + parentCount * 170 - (parentCount > 0 ? 85 : 0);
        y = ay - 200;
    } else {
        x = ax + 180;
        y = ay;
    }

    return expandCanvasForPosition(x, y, true);
}

async function submitQuickAdd() {
    if (!pendingQuickAdd) return;
    const { anchorId, type } = pendingQuickAdd;

    const name = document.getElementById('quickAddName').value.trim();
    if (!name) return showToast('Please enter a name', true);

    const pos = computePosition(anchorId, type);
    const pic = quickAddCroppedPhoto;
    const dob = document.getElementById('quickAddDob').value;

    const formData = new FormData();
    formData.append('name', name);
    formData.append('pos_x', pos.x);
    formData.append('pos_y', pos.y);
    if (dob) formData.append('dob', dob);
    if (pic) formData.append('pic', pic);

    try {
        const res = await fetch('/api/persons', { method: 'POST', body: formData });
        if (!res.ok) throw new Error(await res.text());
        const newPerson = await res.json();

        if (anchorId) {
            let person1 = anchorId, person2 = newPerson.id;

            if (type === 'sibling') {
                const subType = document.getElementById('quickAddSiblingType').value;
                await postJson('/api/relationships', { person1_id: person1, person2_id: person2, relation: 'sibling-' + subType });
            } else if (type === 'parent') {
                // Stored as a parent→child link with the new person first: the
                // new node is the parent, the anchor is the child.
                const subType = document.getElementById('quickAddParentType').value;
                const relation = 'child' + (subType ? '-' + subType : '');
                await postJson('/api/relationships', { person1_id: newPerson.id, person2_id: anchorId, relation });
            } else if (type === 'spouse') {
                const subType = document.getElementById('quickAddPartnerType').value;
                const relation = subType === 'divorced' ? 'spouse-divorced' : 'spouse';
                await postJson('/api/relationships', { person1_id: person1, person2_id: person2, relation });
            } else {
                await postJson('/api/relationships', { person1_id: person1, person2_id: person2, relation: 'child' });
            }
        }

        showToast(`${name} added`);
        closeQuickAdd();
        selectedNodeId = newPerson.id;
        await loadTree();
    } catch (err) {
        showToast('Failed to add person: ' + err.message, true);
    }
}

// --- Legacy photo dialog (kept for potential external triggers) ---
let photoDialogPersonId = null;

function closePhotoDialog() {
    document.getElementById('photoDialog').close();
    photoDialogPersonId = null;
    photoDialogCroppedPhoto = null;
}

function previewPhoto() {
    handlePhotoFileChosen(document.getElementById('photoDialogInput'), 'photoDialog');
}

async function submitPhoto() {
    const file = photoDialogCroppedPhoto;
    if (!file || photoDialogPersonId == null) return closePhotoDialog();

    const formData = new FormData();
    formData.append('pic', file);

    try {
        const res = await fetch(`/api/persons/${photoDialogPersonId}/photo`, { method: 'POST', body: formData });
        if (!res.ok) throw new Error(await res.text());
        showToast('Photo updated');
        closePhotoDialog();
        loadTree();
    } catch (err) {
        showToast('Failed to upload photo: ' + err.message, true);
    }
}

// --- Export ---
function buildTreeSVG() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    currentPersons.forEach(p => {
        minX = Math.min(minX, p.pos_x || 0);
        minY = Math.min(minY, p.pos_y || 0);
        maxX = Math.max(maxX, (p.pos_x || 0) + NODE_W);
        maxY = Math.max(maxY, (p.pos_y || 0) + NODE_H);
    });
    const pad = 60;
    const width = maxX - minX + pad * 2;
    const height = maxY - minY + pad * 2;
    const ox = pad - minX, oy = pad - minY;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
    svg += `<rect width="100%" height="100%" fill="${cssVar('--surface', '#ffffff')}"/>`;

    currentRelationships.forEach(rel => {
        const p1 = findPerson(rel.person1_id);
        const p2 = findPerson(rel.person2_id);
        if (!p1 || !p2) return;
        const style = relationStroke(rel.relation);
        const x1 = (p1.pos_x || 0) + NODE_CENTER_X + ox;
        const y1 = (p1.pos_y || 0) + NODE_CENTER_Y + oy;
        const x2 = (p2.pos_x || 0) + NODE_CENTER_X + ox;
        const y2 = (p2.pos_y || 0) + NODE_CENTER_Y + oy;
        const dashAttr = style.dash ? ` stroke-dasharray="${style.dash}"` : '';
        svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${style.color}" stroke-width="2.5"${dashAttr}/>`;
    });

    currentPersons.forEach(p => {
        const cx = (p.pos_x || 0) + NODE_CENTER_X + ox;
        const cy = (p.pos_y || 0) + 34 + oy;
        const role = roleForPerson(p.id);
        const roleColor = relationStroke(role).color;
        svg += `<rect x="${cx - 74}" y="${cy - 10}" width="148" height="90" rx="10" fill="${cssVar('--node-bg', '#2f7d78')}" stroke="${roleColor}" stroke-width="3"/>`;
        svg += `<circle cx="${cx}" cy="${cy}" r="30" fill="${cssVar('--avatar-bg', '#dfe6e5')}" stroke="${cssVar('--surface', '#ffffff')}" stroke-width="3"/>`;
        if (p.image_url) {
            const href = p.image_url.startsWith('http') ? p.image_url : (location.origin + p.image_url);
            svg += `<clipPath id="clip${p.id}"><circle cx="${cx}" cy="${cy}" r="28"/></clipPath>`;
            svg += `<image href="${href}" x="${cx - 28}" y="${cy - 28}" width="56" height="56" clip-path="url(#clip${p.id})" preserveAspectRatio="xMidYMid slice"/>`;
        }
        svg += `<text x="${cx}" y="${cy + 48}" text-anchor="middle" font-family="Inter, sans-serif" font-size="13" font-weight="700" fill="${cssVar('--node-text', '#ffffff')}">${escapeHtml(p.name)}</text>`;
    });

    svg += `</svg>`;
    return { svg, width, height };
}

function toggleExportMenu() {
    const menu = document.getElementById('exportMenu');
    const willOpen = !menu.classList.contains('open');
    closeMenus();
    if (willOpen) {
        menu.classList.add('open');
        menu.previousElementSibling.setAttribute('aria-expanded', 'true');
    }
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

async function exportImage(format) {
    closeMenus();
    if (!currentPersons.length) return showToast('Nothing to export yet', true);

    const { svg, width, height } = buildTreeSVG();

    if (format === 'svg') {
        downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'family-tree.svg');
        noteExported();
        showToast('Tree exported as SVG');
        return;
    }

    try {
        const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
        const svgUrl = URL.createObjectURL(svgBlob);
        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = svgUrl;
        });

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (format === 'jpeg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
        }
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(svgUrl);

        const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        canvas.toBlob(blob => {
            downloadBlob(blob, `family-tree.${format === 'jpeg' ? 'jpg' : 'png'}`);
            noteExported();
            showToast(`Tree exported as ${format.toUpperCase()}`);
        }, mime, 0.95);
    } catch (err) {
        showToast('Export failed: ' + err.message, true);
    }
}

function noteExported() {
    localStorage.setItem(EXPORTED_KEY, '1');
    updateChecklist();
}

function exportJSON() {
    if (!currentPersons.length) return showToast('Nothing to export yet', true);
    const data = { persons: currentPersons, relationships: currentRelationships, events: currentEvents };
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'family-tree.json');
    noteExported();
    showToast('Tree data exported as JSON');
}

// --- Search & quick navigation ---
function highlightMatch(text, query) {
    const safe = escapeHtml(text);
    if (!query) return safe;
    const index = safe.toLowerCase().indexOf(query.toLowerCase());
    if (index < 0) return safe;
    return safe.slice(0, index) + '<mark>' + safe.slice(index, index + query.length) + '</mark>' + safe.slice(index + query.length);
}

function searchFor(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    return currentPersons
        .map(person => {
            const name = (person.name || '').toLowerCase();
            const haystack = [person.name, person.profession, person.birth_country, person.facts, person.dob, person.dod]
                .filter(Boolean).join(' ').toLowerCase();
            let score = -1;
            if (name.startsWith(q)) score = 0;
            else if (name.includes(q)) score = 1;
            else if (haystack.includes(q)) score = 2;
            return { person, score };
        })
        .filter(entry => entry.score >= 0)
        .sort((a, b) => a.score - b.score || String(a.person.name).localeCompare(String(b.person.name)))
        .map(entry => entry.person)
        .filter(person => {
            // Extension point: the search-filters module narrows the hits.
            return typeof window.searchHitAllowed !== 'function' || window.searchHitAllowed(person);
        })
        .slice(0, 8);
}

function renderSearchResults() {
    const box = document.getElementById('searchResults');
    const input = document.getElementById('searchInput');
    const query = input.value.trim();

    if (!query) return closeSearchResults();

    searchMatches = searchFor(query);
    searchActiveIndex = searchMatches.length ? 0 : -1;
    input.setAttribute('aria-expanded', String(searchMatches.length > 0));

    if (!searchMatches.length) {
        box.innerHTML = `<div class="search-empty">No one matches “${escapeHtml(query)}”</div>`;
        box.hidden = false;
        return;
    }

    box.innerHTML = searchMatches.map((person, index) => {
        const meta = [person.dob ? formatDate(person.dob) : '', person.profession, person.birth_country]
            .filter(Boolean).join(' · ');
        const img = person.image_url || placeholderAvatar;
        return `
            <button type="button" class="search-result${index === searchActiveIndex ? ' active' : ''}" role="option"
                    data-id="${person.id}" onmousedown="event.preventDefault()" onclick="pickSearchResult(${person.id})">
                <img src="${escapeAttr(img)}" alt="">
                <span class="sr-body">
                    <span class="sr-name">${highlightMatch(person.name, query)}</span>
                    ${meta ? `<span class="sr-meta">${escapeHtml(meta)}</span>` : ''}
                </span>
            </button>`;
    }).join('');
    box.hidden = false;
}

function closeSearchResults() {
    const box = document.getElementById('searchResults');
    const input = document.getElementById('searchInput');
    if (box) box.hidden = true;
    if (input) input.setAttribute('aria-expanded', 'false');
    searchMatches = [];
    searchActiveIndex = -1;
}

function moveSearchSelection(delta) {
    if (!searchMatches.length) return;
    searchActiveIndex = (searchActiveIndex + delta + searchMatches.length) % searchMatches.length;
    document.querySelectorAll('.search-result').forEach((el, index) => {
        el.classList.toggle('active', index === searchActiveIndex);
        if (index === searchActiveIndex && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'nearest' });
        }
    });
}

function pickSearchResult(id) {
    const input = document.getElementById('searchInput');
    input.value = '';
    closeSearchResults();
    input.blur();
    jumpToPerson(id);
}

function onSearchKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSearchSelection(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSearchSelection(-1); }
    else if (e.key === 'Enter') {
        e.preventDefault();
        const person = searchMatches[searchActiveIndex] || searchMatches[0];
        if (person) pickSearchResult(person.id);
    } else if (e.key === 'Escape') {
        e.preventDefault();
        document.getElementById('searchInput').value = '';
        closeSearchResults();
        document.getElementById('searchInput').blur();
    }
}

// --- Getting-started checklist ---
function rootPersonId() {
    if (!currentPersons.length) return null;
    return currentPersons.reduce((lowest, p) => (p.id < lowest ? p.id : lowest), currentPersons[0].id);
}

function checklistState() {
    const root = rootPersonId();
    const edges = (() => {
        const idSet = new Set(currentPersons.map(p => p.id));
        return currentRelationships.map(rel => parentChildEdge(rel, idSet)).filter(Boolean);
    })();

    const hasParent = root !== null && edges.some(edge => edge.child === root);
    const hasChild = root !== null && edges.some(edge => edge.parent === root);
    const hasPartner = root !== null && currentRelationships.some(r =>
        String(r.relation || '').startsWith('spouse') && (r.person1_id === root || r.person2_id === root));
    const hasPhoto = currentPersons.some(p => p.image_url);

    return {
        root: currentPersons.length > 0,
        parents: hasParent,
        partner: hasPartner,
        children: hasChild,
        photo: hasPhoto,
        export: localStorage.getItem(EXPORTED_KEY) === '1'
    };
}

function renderChecklist() {
    const panel = document.getElementById('checklistPanel');
    if (localStorage.getItem(CHECKLIST_KEY) === '1') { panel.style.display = 'none'; return; }

    const state = checklistState();
    const items = CHECKLIST_STEPS.map(step => {
        const done = !!state[step.id];
        const action = done ? '' : `<button class="checklist-action" onclick="runChecklistStep('${step.id}')">${step.action}</button>`;
        return `
            <li class="checklist-item${done ? ' done' : ''}">
                <span class="checklist-mark" aria-hidden="true"><svg class="icon"><use href="#i-check"/></svg></span>
                <span class="checklist-label">${step.label}</span>
                ${action}
            </li>`;
    }).join('');

    const doneCount = CHECKLIST_STEPS.filter(step => state[step.id]).length;
    const finished = doneCount === CHECKLIST_STEPS.length;

    document.getElementById('checklistItems').innerHTML = items +
        (finished ? '<li class="checklist-all-done"><svg class="icon" aria-hidden="true"><use href="#i-sparkle"/></svg> All done — your tree is ready to share.</li>' : '');
    document.getElementById('checklistProgress').textContent = `${doneCount} / ${CHECKLIST_STEPS.length}`;
    panel.style.display = 'block';
}

function updateChecklist() {
    if (localStorage.getItem(CHECKLIST_KEY) === '1') return;
    renderChecklist();
}

function runChecklistStep(stepId) {
    const step = CHECKLIST_STEPS.find(s => s.id === stepId);
    if (step) step.run();
}

function dismissChecklist() {
    localStorage.setItem(CHECKLIST_KEY, '1');
    document.getElementById('checklistPanel').style.display = 'none';
    showToast('Checklist hidden — reopen it from Settings');
}

function showChecklist() {
    localStorage.removeItem(CHECKLIST_KEY);
    renderChecklist();
    if (document.getElementById('settingsDialog').open) closeSettingsDialog();
}

function focusPhotoTab() {
    if (selectedNodeId === null) {
        return showToast('Select a person first', true);
    }
    if (sidebarCollapsed) toggleSidebar();
    switchTab('image');
    setTimeout(() => {
        const input = document.getElementById('sidebarPhotoInput');
        if (input) input.click();
    }, 60);
}

function startConnectFromSidebar() {
    if (!connectMode) toggleConnectMode();
    showToast('Click two people to link them');
}

// --- App updates ---
async function checkForUpdates() {
    const dialog = document.getElementById('updateDialog');
    const status = document.getElementById('updateStatus');
    const details = document.getElementById('updateDetails');
    const releaseBtn = document.getElementById('openReleaseBtn');

    latestReleaseUrl = '';
    status.textContent = 'Checking for the latest release…';
    details.style.display = 'none';
    details.innerHTML = '';
    releaseBtn.style.display = 'none';
    dialog.showModal();

    try {
        const res = await fetch('/api/update-check');
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        latestReleaseUrl = data.release_url || '';
        releaseBtn.style.display = latestReleaseUrl ? 'block' : 'none';

        if (data.update_available) {
            status.textContent = `Update available: ${data.latest_version}`;
        } else {
            status.textContent = `You're up to date on ${data.current_version}.`;
        }

        details.innerHTML = `
            <div><strong>Current:</strong> ${escapeHtml(data.current_version || 'unknown')}</div>
            <div><strong>Latest:</strong> ${escapeHtml(data.latest_version || 'unknown')}</div>
            <div><strong>Repository:</strong> ${escapeHtml(data.repository || 'not configured')}</div>
            ${data.published_at ? `<div><strong>Published:</strong> ${escapeHtml(new Date(data.published_at).toLocaleString())}</div>` : ''}
        `;
        details.style.display = 'block';
    } catch (err) {
        status.textContent = 'Could not check for updates.';
        details.innerHTML = escapeHtml(err.message.trim());
        details.style.display = 'block';
        showToast('Update check failed', true);
    }
}

function closeUpdateDialog() {
    document.getElementById('updateDialog').close();
}

function openLatestRelease() {
    if (latestReleaseUrl) window.open(latestReleaseUrl, '_blank', 'noopener');
}

// --- Tree look ---
// The shape of the tree: which way the generations run, how the cards are
// joined, and whether the cards are rounded or square. The look is kept in
// localStorage; the direction also decides how the tree is laid out.
const TREE_STYLE_KEY = 'familytree.treeStyle';

let treeStyle = { direction: 'down', connector: 'straight', card: 'rounded' };

function loadTreeStyle() {
    try {
        const saved = JSON.parse(localStorage.getItem(TREE_STYLE_KEY) || 'null');
        if (saved && typeof saved === 'object') {
            treeStyle = {
                direction: saved.direction === 'right' ? 'right' : 'down',
                connector: ['straight', 'elbow', 'curve'].includes(saved.connector) ? saved.connector : 'straight',
                card: saved.card === 'square' ? 'square' : 'rounded'
            };
        }
    } catch (err) {
        // A broken value just means the defaults.
    }
    applyTreeStyleClasses();
}

// getTreeStyle lets the styles panel read the current look.
function getTreeStyle() {
    return { direction: treeStyle.direction, connector: treeStyle.connector, card: treeStyle.card };
}

function applyTreeStyleClasses() {    const canvas = document.getElementById('treeCanvas');
    if (!canvas) return;
    canvas.classList.toggle('style-direction-right', treeStyle.direction === 'right');
    canvas.classList.toggle('style-cards-square', treeStyle.card === 'square');
    canvas.classList.toggle('style-connector-elbow', treeStyle.connector === 'elbow');
    canvas.classList.toggle('style-connector-curve', treeStyle.connector === 'curve');
}

// The look can change without moving anybody. The direction does move
// people, so it is applied by transposing the tree: generations that ran
// downwards now run to the right.
function setTreeStyle(style) {
    const next = {
        direction: style.direction === 'right' ? 'right' : 'down',
        connector: ['straight', 'elbow', 'curve'].includes(style.connector) ? style.connector : 'straight',
        card: style.card === 'square' ? 'square' : 'rounded'
    };
    const directionChanged = next.direction !== treeStyle.direction;
    treeStyle = next;
    localStorage.setItem(TREE_STYLE_KEY, JSON.stringify(treeStyle));
    applyTreeStyleClasses();
    if (directionChanged) transposeTree();
    else renderTree();
}

function transposeTree() {
    const snapshot = currentPersons.map(p => ({ id: p.id, pos_x: p.pos_x || 0, pos_y: p.pos_y || 0 }));
    currentPersons.forEach(p => {
        const x = p.pos_x || 0;
        p.pos_x = p.pos_y || 0;
        p.pos_y = x;
    });

    pushUndo({
        label: 'the tree direction',
        run: async () => {
            await Promise.all(snapshot.map(point => fetch(`/api/persons/${point.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pos_x: point.pos_x, pos_y: point.pos_y })
            }).then(res => { if (!res.ok) throw new Error('could not restore a position'); })));
            await loadTree();
            centerTree();
        }
    });

    currentPersons.forEach(persistPersonPosition);
    renderTree();
    centerTree();
    showToast(treeStyle.direction === 'right' ? 'Tree now runs left to right' : 'Tree now runs top to bottom');
}

// --- Tree settings ---
// Reloading puts the tree back into a proper shape: the data comes from disk
// and everyone is arranged into generations again, so a tree that was dragged
// into a mess snaps back. It can be undone.
async function reloadTree() {
    closeSettingsDialog();
    if (!currentPersons.length) {
        await loadTree();
        return showToast('Reloaded from disk');
    }
    const ok = await showConfirm({
        title: 'Re-arrange the tree?',
        message: 'Everyone is put back into parent-to-child generations. Manual positions are replaced — you can undo it with Ctrl+Z.',
        confirmLabel: 'Re-arrange',
        danger: false
    });
    if (!ok) return;
    await loadTree();
    await applyTreeLayout();
}

function openSettingsDialog() {
    document.getElementById('settingsDialog').showModal();
}
function closeSettingsDialog() {
    document.getElementById('settingsDialog').close();
}
function applyFontSize() {
    const size = document.getElementById('fontSizeSelect').value;
    const canvas = document.getElementById('treeCanvas');
    canvas.classList.remove('font-small', 'font-medium', 'font-large');
    canvas.classList.add('font-' + size);
}
function applyDateFormat() {
    dateFormat = document.getElementById('dateFormatSelect').value;
    renderTree();
}

// --- Storage integration ---
function setActivePill(mode) {
    document.getElementById('pillLocal').classList.toggle('active', mode === 'local');
    document.getElementById('pillS3').classList.toggle('active', mode === 's3');
    document.getElementById('pillDrive').classList.toggle('active', mode === 'drive');

    const chip = document.getElementById('storageChip');
    const label = document.getElementById('storageChipLabel');
    const normalized = mode === 's3' ? 's3' : mode === 'drive' ? 'drive' : 'local';
    const names = { local: 'Local disk', s3: 'AWS S3', drive: 'Google Drive' };
    if (chip) chip.dataset.mode = normalized;
    if (label) label.textContent = names[normalized];
}

async function selectStorage(mode) {
    if (mode === 'local') {
        storageMode = 'local';
        setActivePill('local');
        await postStorageMode('local');
        showToast('Using local disk storage');
        return;
    }
    if (mode === 's3') {
        document.getElementById('s3Error').style.display = 'none';
        document.getElementById('s3BucketList').innerHTML = '';
        document.getElementById('s3Dialog').showModal();
        return;
    }
    if (mode === 'drive') {
        document.getElementById('driveError').style.display = 'none';
        const statusRes = await fetch('/api/oauth/status');
        const status = await statusRes.json();
        document.getElementById('driveStatus').style.display = status.connected ? 'block' : 'none';
        document.getElementById('driveDialog').showModal();
        return;
    }
}

async function postStorageMode(mode) {
    const formData = new URLSearchParams();
    formData.append('mode', mode);
    await fetch('/api/settings', { method: 'POST', body: formData });
}

function closeS3Dialog() {
    document.getElementById('s3Dialog').close();
}

async function browseS3Buckets() {
    const errorBox = document.getElementById('s3Error');
    const list = document.getElementById('s3BucketList');
    errorBox.style.display = 'none';
    list.innerHTML = '<li>Loading buckets…</li>';

    try {
        const res = await fetch('/api/s3/buckets');
        if (!res.ok) {
            const text = await res.text();
            throw new Error(text || 'Could not reach AWS');
        }
        const data = await res.json();
        list.innerHTML = '';
        if (!data.buckets || data.buckets.length === 0) {
            list.innerHTML = '<li>No buckets found in this account.</li>';
            return;
        }
        data.buckets.forEach(bucket => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${escapeHtml(bucket)}</span>`;
            const btn = document.createElement('button');
            btn.textContent = 'Use this bucket';
            btn.onclick = () => selectS3Bucket(bucket);
            li.appendChild(btn);
            list.appendChild(li);
        });
    } catch (err) {
        list.innerHTML = '';
        errorBox.textContent = err.message;
        errorBox.style.display = 'block';
    }
}

async function selectS3Bucket(bucket) {
    try {
        const res = await fetch('/api/s3/select-bucket', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bucket })
        });
        if (!res.ok) throw new Error(await res.text());
        storageMode = 's3';
        setActivePill('s3');
        closeS3Dialog();
        showToast(`Connected to S3 bucket "${bucket}"`);
    } catch (err) {
        showToast('Failed to select bucket: ' + err.message, true);
    }
}

function closeDriveDialog() {
    document.getElementById('driveDialog').close();
}

function connectGoogleDrive() {
    const popup = window.open('/auth/login', 'gdriveAuth', 'width=520,height=650');
    if (!popup) {
        showToast('Please allow popups for this site to connect Google Drive', true);
    }
}

window.addEventListener('message', async (event) => {
    if (!event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'gdrive-auth-success') {
        await postStorageMode('drive');
        storageMode = 'drive';
        setActivePill('drive');
        document.getElementById('driveStatus').style.display = 'block';
        closeDriveDialog();
        showToast('Connected to Google Drive');
    } else if (event.data.type === 'gdrive-auth-error') {
        const errorBox = document.getElementById('driveError');
        errorBox.textContent = 'Google authentication failed: ' + (event.data.error || 'unknown error');
        errorBox.style.display = 'block';
    }
});

window.onload = async () => {
    loadTreeStyle();
    applyTheme(localStorage.getItem('familytree.theme') || 'white');
    applyZoom();
    updateUndoUI();

    // On a narrow screen the detail panel is a drawer over the canvas, so it
    // starts closed and the tree gets the whole viewport.
    syncSidebarToViewport();
    window.addEventListener('resize', syncSidebarToViewport);

    const canvas = document.getElementById('treeCanvas');
    canvas.addEventListener('wheel', onCanvasWheel, { passive: false });
    canvas.addEventListener('mousedown', onCanvasMouseDown);
    canvas.classList.add('font-medium');

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown')) closeMenus();
        if (!e.target.closest('.search-box')) closeSearchResults();
    });

    wireConfirmDialog();
    wireSearch();
    wireShortcuts();
    wireDirtyTracking();
    wireRestorePicker();
    wireLinkDialog();
    renderChecklist();

    loadTree();

    const modeRes = await fetch('/api/settings');
    storageMode = await modeRes.text();
    setActivePill(storageMode);

    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
        showToast('Connected to Google Drive');
    }
};

function wireConfirmDialog() {
    const dialog = document.getElementById('confirmDialog');
    document.getElementById('confirmOkBtn').addEventListener('click', () => settleConfirm(true));
    document.getElementById('confirmCancelBtn').addEventListener('click', () => settleConfirm(false));
    dialog.addEventListener('cancel', e => { e.preventDefault(); settleConfirm(false); });
    dialog.addEventListener('close', () => {
        if (confirmResolve) { const pending = confirmResolve; confirmResolve = null; pending(false); }
    });
    dialog.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); settleConfirm(true); }
    });
}

function wireSearch() {
    const input = document.getElementById('searchInput');
    input.addEventListener('input', renderSearchResults);
    input.addEventListener('focus', renderSearchResults);
    input.addEventListener('keydown', onSearchKeyDown);
    input.addEventListener('blur', () => setTimeout(closeSearchResults, 120));
}

function wireRestorePicker() {
    const input = document.getElementById('restoreFileInput');
    input.addEventListener('change', () => handleRestoreFileChosen(input));
}

function wireLinkDialog() {
    ['linkPersonA', 'linkPersonB'].forEach(id => {
        const select = document.getElementById(id);
        if (select) select.addEventListener('change', updateLinkDialogNames);
    });
}

function wireDirtyTracking() {    ['fieldName', 'fieldDob', 'fieldDod', 'fieldBirthCountry', 'fieldProfession', 'fieldFacts']
        .forEach(id => document.getElementById(id).addEventListener('input', markDirty));
}

function wireShortcuts() {
    document.addEventListener('keydown', e => {
        const active = document.activeElement;
        const typing = !!active && (
            active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' ||
            active.tagName === 'SELECT' || active.isContentEditable);

        // Never fight a dialog, a form field, or the browser's own undo.
        if (document.querySelector('dialog[open]')) return;

        if (e.key === '/' && !typing) {
            e.preventDefault();
            const input = document.getElementById('searchInput');
            input.focus();
            input.select();
            return;
        }

        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z') && !typing) {
            e.preventDefault();
            performUndo();
            return;
        }

        if (e.key === 'Escape') {
            if (document.activeElement === document.getElementById('searchInput')) return;
            if (document.getElementById('searchResults').hidden === false) return;
            if (document.querySelector('.dropdown-menu.open')) { closeMenus(); return; }
            if (connectMode) { toggleConnectMode(); return; }
            if (selectedNodeId !== null) clearSelection();
        }
    });
}
