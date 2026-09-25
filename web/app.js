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

const placeholderAvatar = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23ccc"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';

function showToast(message, isError) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast show' + (isError ? ' error' : '');
    setTimeout(() => { toast.className = 'toast'; }, 2500);
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
    if (button) button.classList.toggle('active', !isOpen);
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
}

// --- Relation styling helpers ---
function relationRoleClass(relation) {
    if (relation === 'spouse') return 'role-spouse';
    if (relation === 'child') return 'role-child';
    if (relation === 'sibling-full') return 'role-sibling-full';
    if (relation === 'sibling-half') return 'role-sibling-half';
    if (relation === 'sibling-step') return 'role-sibling-step';
    return 'role-root';
}

function relationStroke(relation) {
    switch (relation) {
        case 'spouse': return { color: cssVar('--spouse', '#d6537e'), dash: '' };
        case 'child': return { color: cssVar('--parent', '#d9a441'), dash: '' };
        case 'sibling-full': return { color: cssVar('--sibling', '#4c6ef5'), dash: '' };
        case 'sibling-half': return { color: cssVar('--sibling', '#4c6ef5'), dash: '6,4' };
        case 'sibling-step': return { color: cssVar('--sibling', '#4c6ef5'), dash: '2,4' };
        default: return { color: cssVar('--root', '#6b8b89'), dash: '' };
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
    empty.style.display = currentPersons.length ? 'none' : 'block';

    currentPersons.forEach(p => {
        const imgSrc = p.image_url ? p.image_url : placeholderAvatar;
        const role = roleForPerson(p.id);
        const roleClass = relationRoleClass(role);

        const node = document.createElement('div');
        node.className = 'tree-node ' + roleClass;
        if (p.id === selectedNodeId) node.classList.add('selected');
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
                <img src="${imgSrc}" alt="${escapeAttr(p.name)}">
            </div>
            <div class="tree-name-display">${escapeHtml(p.name)}</div>
            ${metaLine ? `<div class="tree-node-meta">${escapeHtml(metaLine)}</div>` : ''}
            ${p.facts ? `<div class="tree-node-facts">${escapeHtml(p.facts)}</div>` : ''}
        `;

        node.addEventListener('mousedown', e => onNodeMouseDown(e, p.id));
        nodesLayer.appendChild(node);
    });

    drawLines();
}

function drawLines() {
    const svg = document.getElementById('treeLines');
    svg.innerHTML = '';
    svg.classList.toggle('lines-editable', connectMode);

    currentRelationships.forEach(rel => {
        const p1 = findPerson(rel.person1_id);
        const p2 = findPerson(rel.person2_id);
        if (!p1 || !p2) return;

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

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', style.color);
        line.setAttribute('stroke-width', '2.5');
        if (style.dash) line.setAttribute('stroke-dasharray', style.dash);
        svg.appendChild(line);
    });
}

async function removeConnection(relId, name1, name2) {
    if (!confirm(`Remove the connection between ${name1} and ${name2}?`)) return;
    try {
        const res = await fetch(`/api/relationships/${relId}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 204) throw new Error(await res.text());
        showToast('Connection removed');
        loadTree();
    } catch (err) {
        showToast('Failed to remove connection: ' + err.message, true);
    }
}

// --- Zoom ---
function applyZoom() {
    document.getElementById('treeViewport').style.transform = `scale(${zoom})`;
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

    // The app stores parent -> child as relation "child". Older data and manual
    // imports may use father/mother/parent with the same direction.
    if (
        relation === 'child' || relation === 'father' || relation === 'mother' || relation === 'parent' ||
        relation === 'parent-of' || relation === 'parent_of' || relation === 'father-of' || relation === 'mother-of'
    ) {
        return { parent: rel.person1_id, child: rel.person2_id };
    }

    // Accept child-of style imports as child -> parent.
    if (relation === 'child-of' || relation === 'child_of' || relation === 'son' || relation === 'daughter') {
        return { parent: rel.person2_id, child: rel.person1_id };
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
            const sameGeneration = relation === 'spouse' || relation.startsWith('sibling-');
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
    if (!confirm('Reset the tree layout? This will move all people into parent-to-child generations.')) return;

    const positions = calculateTreeLayout();
    currentPersons.forEach(p => {
        const pos = positions.get(p.id);
        if (!pos) return;
        p.pos_x = pos.x;
        p.pos_y = pos.y;
    });

    expandCanvasToFitTree(false);
    renderTree();
    centerTree();

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
        if (p) {
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
}

function populateSidebar(p) {
    document.getElementById('sidebarEmpty').style.display = 'none';
    document.getElementById('sidebarContent').style.display = 'block';

    document.getElementById('fieldName').value = p.name || '';
    document.getElementById('fieldDob').value = p.dob || '';
    document.getElementById('fieldDod').value = p.dod || '';
    document.getElementById('fieldBirthCountry').value = p.birth_country || '';
    document.getElementById('fieldProfession').value = p.profession || '';
    document.getElementById('fieldFacts').value = p.facts || '';
    document.getElementById('sidebarPhotoPreview').src = p.image_url || placeholderAvatar;
    document.getElementById('sidebarPhotoInput').value = '';
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.style.display = panel.dataset.panel === tab ? 'block' : 'none';
    });
}

async function saveSelectedPerson() {
    if (selectedNodeId === null) return;
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
        loadTree();
    } catch (err) {
        showToast('Failed to save: ' + err.message, true);
    }
}

async function uploadSelectedPersonPhoto(file) {
    if (selectedNodeId === null || !file) return;

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
    const p = findPerson(selectedNodeId);
    const name = p ? p.name : 'this person';
    if (!confirm(`Remove ${name} from the family tree? This also removes their relationships.`)) return;

    try {
        const res = await fetch(`/api/persons/${selectedNodeId}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 204) throw new Error(await res.text());
        showToast(`${name} removed`);
        selectedNodeId = null;
        showSidebarEmpty();
        loadTree();
    } catch (err) {
        showToast('Failed to delete person: ' + err.message, true);
    }
}

// --- Sidebar collapse/expand ---
function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    document.getElementById('sidebar').classList.toggle('collapsed', sidebarCollapsed);
    document.getElementById('sidebarExpandBtn').style.display = sidebarCollapsed ? 'block' : 'none';
}

// --- Edit Connections mode ---
function toggleConnectMode() {
    connectMode = !connectMode;
    document.getElementById('connectBtn').classList.toggle('active', connectMode);
    document.getElementById('connectHint').style.display = connectMode ? 'flex' : 'none';
    document.getElementById('treeCanvas').classList.toggle('connect-mode', connectMode);
    renderTree();
}

function handleConnectClick(id) {
    if (!pendingLink) {
        pendingLink = { idA: id };
        showToast('Now click a second person to connect');
        return;
    }
    if (pendingLink.idA === id) {
        pendingLink = null;
        return;
    }
    openLinkDialog(pendingLink.idA, id);
    pendingLink = null;
}

function openLinkDialog(idA, idB) {
    pendingLink = { idA, idB };
    const a = findPerson(idA), b = findPerson(idB);
    document.getElementById('linkDialogNames').innerHTML =
        `<strong>${escapeHtml(a.name)}</strong> (first) &nbsp;&harr;&nbsp; <strong>${escapeHtml(b.name)}</strong> (second)`;
    document.getElementById('linkRelationType').value = 'spouse';
    document.getElementById('linkDialog').showModal();
}

function closeLinkDialog() {
    document.getElementById('linkDialog').close();
    pendingLink = null;
}

async function submitLinkDialog() {
    if (!pendingLink || !pendingLink.idB) return;
    const { idA, idB } = pendingLink;
    const choice = document.getElementById('linkRelationType').value;

    let person1 = idA, person2 = idB, relation = choice;
    if (choice === 'a-parent-of-b') { relation = 'child'; person1 = idA; person2 = idB; }
    else if (choice === 'b-parent-of-a') { relation = 'child'; person1 = idB; person2 = idA; }

    try {
        const res = await fetch('/api/relationships', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ person1_id: person1, person2_id: person2, relation })
        });
        if (!res.ok) throw new Error(await res.text());
        showToast('Connected');
        document.getElementById('linkDialog').close();
        pendingLink = null;
        loadTree();
    } catch (err) {
        showToast('Failed to connect: ' + err.message, true);
    }
}

// --- Quick add (root / parent / spouse / sibling / child) ---
// Sidebar buttons always act relative to the currently selected node; only
// the "root" (first-ever person) case has no anchor.
function openQuickAdd(anchorIdArg, type) {
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
    document.getElementById('quickAddPic').value = '';
    quickAddCroppedPhoto = null;
    document.getElementById('quickAddPreview').src = placeholderAvatar;
    document.getElementById('quickAddSiblingRow').style.display = type === 'sibling' ? 'block' : 'none';

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
        const spouseCount = currentRelationships.filter(r => r.person1_id === anchorId && r.relation === 'spouse').length;
        x = ax + 180;
        y = ay + spouseCount * 170;
    } else if (type === 'sibling') {
        const siblingCount = currentRelationships.filter(r => r.person1_id === anchorId && r.relation.startsWith('sibling-')).length;
        x = ax - 180 - siblingCount * 180;
        y = ay;
    } else if (type === 'child') {
        const childCount = currentRelationships.filter(r => r.person1_id === anchorId && r.relation === 'child').length;
        x = ax + childCount * 170 - (childCount > 0 ? 85 : 0);
        y = ay + 200;
    } else if (type === 'parent') {
        const parentCount = currentRelationships.filter(r => r.person2_id === anchorId && r.relation === 'child').length;
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

    const formData = new FormData();
    formData.append('name', name);
    formData.append('pos_x', pos.x);
    formData.append('pos_y', pos.y);
    if (pic) formData.append('pic', pic);

    try {
        const res = await fetch('/api/persons', { method: 'POST', body: formData });
        if (!res.ok) throw new Error(await res.text());
        const newPerson = await res.json();

        if (anchorId) {
            let relation = type; // 'spouse' | 'child' | 'parent'
            let person1 = anchorId, person2 = newPerson.id;

            if (type === 'sibling') {
                const subType = document.getElementById('quickAddSiblingType').value;
                relation = 'sibling-' + subType;
            } else if (type === 'parent') {
                // Stored as a normal 'child' relation, but reversed: the new
                // node is the parent (person1), the anchor is the child (person2).
                relation = 'child';
                person1 = newPerson.id;
                person2 = anchorId;
            }

            const relRes = await fetch('/api/relationships', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ person1_id: person1, person2_id: person2, relation })
            });
            if (!relRes.ok) throw new Error(await relRes.text());
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
    document.getElementById('exportMenu').classList.toggle('open');
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
    document.getElementById('exportMenu').classList.remove('open');
    if (!currentPersons.length) return showToast('Nothing to export yet', true);

    const { svg, width, height } = buildTreeSVG();

    if (format === 'svg') {
        downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'family-tree.svg');
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
            showToast(`Tree exported as ${format.toUpperCase()}`);
        }, mime, 0.95);
    } catch (err) {
        showToast('Export failed: ' + err.message, true);
    }
}

function exportJSON() {
    if (!currentPersons.length) return showToast('Nothing to export yet', true);
    const data = { persons: currentPersons, relationships: currentRelationships };
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'family-tree.json');
    showToast('Tree data exported as JSON');
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

// --- Tree settings ---
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
    applyTheme(localStorage.getItem('familytree.theme') || 'white');
    loadTree();
    applyZoom();

    const canvas = document.getElementById('treeCanvas');
    canvas.addEventListener('wheel', onCanvasWheel, { passive: false });
    canvas.addEventListener('mousedown', onCanvasMouseDown);
    canvas.classList.add('font-medium');

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown')) {
            document.getElementById('exportMenu').classList.remove('open');
        }
    });

    const modeRes = await fetch('/api/settings');
    storageMode = await modeRes.text();
    setActivePill(storageMode);

    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
        showToast('Connected to Google Drive');
    }
};
