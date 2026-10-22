/* ============================================================
 * Family Tree Builder - layout modes
 *
 * A small picker that re-arranges everyone on the canvas:
 *   ancestors above | compact | fan | centred on a person
 * Every apply is undoable (Ctrl+Z) exactly like the auto-layout.
 * ============================================================ */

(function () {
    'use strict';

    /* A card is 148 wide and 160 tall, so a step of 170/190 already leaves
     * a small gutter between neighbours. */
    const CARD_W = 148;
    const CARD_H = 160;
    const GAP_H = 220;          // default horizontal step
    const GAP_V = 220;          // default vertical step between generations
    const GAP_H_COMPACT = 175;  // compact step - tight but never overlapping
    const GAP_V_COMPACT = 195;
    const PAD = 80;             // keep this much room to the canvas origin
    const BRANCH_GAP = 140;     // space between the centre row and a fan branch
    const MIN_GAP = 60;         // smallest gap left between a fan wing and the centre
    const MODE_NAME = 'ft-layout-mode';

    const MODES = [
        { value: 'ancestors', name: 'Ancestors above', desc: 'Generations run top to bottom, parents above children.', done: 'Re-arranged the tree with ancestors above.' },
        { value: 'compact', name: 'Compact', desc: 'The same shape with tighter gaps, so a big family fits one screen.', done: 'Re-arranged the tree in compact mode.' },
        { value: 'fan', name: 'Fan', desc: 'One ancestral couple in the middle, descendants out to both sides.', done: 'Re-arranged the tree in fan mode.' },
        { value: 'centred', name: 'Centred on a person', desc: 'Ancestors above, descendants below, the selected person in the middle.', done: 'Centred the layout on the selected person.' }
    ];

    /* ---------- small readers for the app.js globals ---------- */

    function people() {
        return (typeof currentPersons !== 'undefined' && currentPersons) ? currentPersons : [];
    }

    function relations() {
        return (typeof currentRelationships !== 'undefined' && currentRelationships) ? currentRelationships : [];
    }

    function selectedPersonId() {
        if (typeof selectedNodeId === 'undefined' || selectedNodeId === null) return null;
        return findPerson(selectedNodeId) ? selectedNodeId : null;
    }

    /* ---------- tiny inline diagrams ---------- */

    function diagramSvg(mode) {
        const head = '<svg class="ft-mode-svg" viewBox="0 0 64 36" aria-hidden="true" focusable="false">';
        const lines = '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">';
        const dots = '<g fill="currentColor">';

        if (mode === 'compact') {
            return head + lines +
                '<path d="M28 8v3M36 8v3M28 11h8M24 11v5M32 11v6M40 11v5"/>' +
                '</g>' + dots +
                '<circle cx="28" cy="5.5" r="2.6"/><circle cx="36" cy="5.5" r="2.6"/>' +
                '<circle cx="24" cy="18.5" r="2.6"/><circle cx="32" cy="20" r="2.6"/><circle cx="40" cy="18.5" r="2.6"/>' +
                '</g></svg>';
        }

        if (mode === 'fan') {
            return head + lines +
                '<path d="M28 8 13 22M28 8 25 23M36 8 39 23M36 8 51 22"/>' +
                '</g>' + dots +
                '<circle cx="28" cy="5" r="2.8"/><circle cx="36" cy="5" r="2.8"/>' +
                '<circle cx="11" cy="24" r="2.8"/><circle cx="25" cy="25" r="2.8"/>' +
                '<circle cx="39" cy="25" r="2.8"/><circle cx="53" cy="24" r="2.8"/>' +
                '</g></svg>';
        }

        if (mode === 'centred') {
            return head + lines +
                '<path d="M32 8v5M20 13h24M20 13v1M32 13v1M44 13v1"/>' +
                '<path d="M20 20v3M32 20v3M44 20v3M14 23h36M14 23v3M26 23v3M38 23v3M50 23v3"/>' +
                '</g>' + dots +
                '<circle cx="32" cy="5" r="2.8"/>' +
                '<circle cx="20" cy="17" r="2.8"/><circle cx="44" cy="17" r="2.8"/>' +
                '<circle cx="14" cy="29" r="2.8"/><circle cx="26" cy="29" r="2.8"/>' +
                '<circle cx="38" cy="29" r="2.8"/><circle cx="50" cy="29" r="2.8"/>' +
                '</g>' +
                '<circle class="ft-mode-accent" cx="32" cy="17" r="3.4"/>' +
                '</svg>';
        }

        return head + lines +
            '<path d="M26 9v4M38 9v4M26 13h12M17 13v7M32 13v7M47 13v7"/>' +
            '</g>' + dots +
            '<circle cx="26" cy="6" r="2.8"/><circle cx="38" cy="6" r="2.8"/>' +
            '<circle cx="17" cy="23" r="2.8"/><circle cx="32" cy="23" r="2.8"/><circle cx="47" cy="23" r="2.8"/>' +
            '</g></svg>';
    }

    /* ---------- markup ---------- */

    function buildMarkup() {
        const options = MODES.map(mode => `
                <label class="ft-mode">
                    <input type="radio" class="ft-mode-input" name="${MODE_NAME}" value="${mode.value}"${mode.value === 'ancestors' ? ' checked' : ''}>
                    <span class="ft-mode-body">
                        <span class="ft-mode-figure">${diagramSvg(mode.value)}</span>
                        <span class="ft-mode-text">
                            <span class="ft-mode-name">${mode.name}</span>
                            <span class="ft-mode-desc">${mode.desc}</span>
                        </span>
                        <svg class="icon ft-mode-check" aria-hidden="true"><use href="#i-check"/></svg>
                    </span>
                </label>`).join('');

        return `
        <dialog id="ftLayoutDialog" class="ft-layout-dialog" aria-labelledby="ftLayoutTitle">
            <div class="ft-layout-body">
                <h3 id="ftLayoutTitle">Arrange the tree</h3>
                <p class="dialog-copy">Choose how everyone is placed on the canvas, then apply it.</p>
                <p class="ft-layout-empty" id="ftLayoutEmpty" hidden>Add people to the tree first.</p>
                <fieldset class="ft-mode-group" id="ftModeGroup">
                    <legend class="sr-only">Layout mode</legend>
                    ${options}
                </fieldset>
                <p class="ft-mode-note" id="ftModeNote"></p>
                <div class="dialog-actions">
                    <button type="button" class="btn-secondary" id="ftLayoutCancel">Cancel</button>
                    <button type="button" class="btn-primary" id="ftLayoutApply">Apply layout</button>
                </div>
            </div>
        </dialog>`;
    }

    function ensureStylesheet() {
        if (document.querySelector('link[href="/static/feat-layout.css"]')) return;
        const link = document.createElement('link');
        link.id = 'ft-layout-css';
        link.rel = 'stylesheet';
        link.href = '/static/feat-layout.css';
        document.head.appendChild(link);
    }

    function injectMarkup() {
        if (document.getElementById('ftLayoutDialog')) return;
        const holder = document.createElement('div');
        holder.innerHTML = buildMarkup();
        const dialog = holder.querySelector('dialog');
        document.body.appendChild(dialog);
    }

    /* ---------- layout maths ---------- */

    function buildContext() {
        const ids = people().map(p => p.id);
        const idSet = new Set(ids);
        const parentsByChild = new Map(ids.map(id => [id, []]));
        const childEdges = [];

        relations().forEach(rel => {
            const edge = parentChildEdge(rel, idSet);
            if (!edge) return;
            childEdges.push(edge);
            const list = parentsByChild.get(edge.child);
            if (list && list.indexOf(edge.parent) === -1) list.push(edge.parent);
        });

        const spouseEdges = [];
        relations().forEach(rel => {
            const kind = String(rel.relation || '').toLowerCase();
            if (kind !== 'spouse' && kind.indexOf('spouse-') !== 0) return;
            if (!idSet.has(rel.person1_id) || !idSet.has(rel.person2_id)) return;
            spouseEdges.push([rel.person1_id, rel.person2_id]);
        });

        const depth = computeLayoutDepths(childEdges, spouseEdges);
        const units = buildUnits(ids, spouseEdges, depth);
        const unitById = new Map();
        units.forEach(unit => unit.ids.forEach(id => unitById.set(id, unit)));

        units.forEach(unit => {
            unit.parentUnits = [];
            unit.ids.forEach(id => {
                (parentsByChild.get(id) || []).forEach(parentId => {
                    const parentUnit = unitById.get(parentId);
                    if (parentUnit && parentUnit !== unit && unit.parentUnits.indexOf(parentUnit) === -1) {
                        unit.parentUnits.push(parentUnit);
                    }
                });
            });
        });

        return { ids: ids, childEdges: childEdges, spouseEdges: spouseEdges, depth: depth, units: units, unitById: unitById };
    }

    /* Generation depth, then partners and siblings pulled onto one row. */
    function computeLayoutDepths(childEdges, spouseEdges) {
        let depth;
        try {
            depth = computeGenerations();
        } catch (err) {
            depth = new Map();
            people().forEach(p => depth.set(p.id, 0));
        }

        const parentChildSet = new Set(childEdges.map(edge => edge.parent + ':' + edge.child));
        const isParentChild = (a, b) => parentChildSet.has(a + ':' + b) || parentChildSet.has(b + ':' + a);

        const links = spouseEdges.slice();
        relations().forEach(rel => {
            const kind = String(rel.relation || '').toLowerCase();
            if (kind.indexOf('sibling-') !== 0) return;
            const a = rel.person1_id;
            const b = rel.person2_id;
            if (!depth.has(a) || !depth.has(b)) return;
            if (isParentChild(a, b)) return;
            links.push([a, b]);
        });

        const rounds = Math.max(1, depth.size);
        for (let round = 0; round < rounds; round++) {
            let changed = false;
            links.forEach(pair => {
                const shared = Math.max(depth.get(pair[0]) || 0, depth.get(pair[1]) || 0);
                if ((depth.get(pair[0]) || 0) !== shared) { depth.set(pair[0], shared); changed = true; }
                if ((depth.get(pair[1]) || 0) !== shared) { depth.set(pair[1], shared); changed = true; }
            });
            childEdges.forEach(edge => {
                const next = (depth.get(edge.parent) || 0) + 1;
                if (next > (depth.get(edge.child) || 0)) { depth.set(edge.child, next); changed = true; }
            });
            if (!changed) break;
        }
        return depth;
    }

    /* Partners become one unit so they always sit side by side. */
    function buildUnits(ids, spouseEdges, depth) {
        const parent = new Map(ids.map(id => [id, id]));
        const find = id => {
            let root = id;
            while (parent.get(root) !== root) root = parent.get(root);
            let cur = id;
            while (parent.get(cur) !== root) {
                const next = parent.get(cur);
                parent.set(cur, root);
                cur = next;
            }
            return root;
        };
        spouseEdges.forEach(pair => {
            const a = find(pair[0]);
            const b = find(pair[1]);
            if (a !== b) parent.set(a, b);
        });

        const groups = new Map();
        ids.forEach(id => {
            const root = find(id);
            if (!groups.has(root)) groups.set(root, []);
            groups.get(root).push(id);
        });

        const units = [];
        groups.forEach(memberIds => {
            memberIds.sort(comparePeopleByNameOrPosition);
            const unitDepth = memberIds.reduce((max, id) => Math.max(max, depth.get(id) || 0), 0);
            units.push({ ids: memberIds, depth: unitDepth, parentUnits: [] });
        });
        units.sort((a, b) => (a.depth - b.depth) || comparePeopleByNameOrPosition(a.ids[0], b.ids[0]));
        return units;
    }

    function rowsByDepth(units) {
        const rows = new Map();
        units.forEach(unit => {
            if (!rows.has(unit.depth)) rows.set(unit.depth, []);
            rows.get(unit.depth).push(unit);
        });
        return rows;
    }

    /* Place every unit left to right, one row per generation. Children sit
     * under their parents unless a neighbour already owns that space. */
    function placeUnits(rows, hGap, vGap, startX, baseDepth) {
        const positions = new Map();
        const boxes = new Map();
        const depths = Array.from(rows.keys()).sort((a, b) => a - b);

        const preferredCentre = unit => {
            const centres = unit.parentUnits
                .map(parentUnit => boxes.get(parentUnit))
                .filter(Boolean)
                .map(box => box.centre);
            if (!centres.length) return null;
            return centres.reduce((sum, x) => sum + x, 0) / centres.length;
        };

        depths.forEach(depth => {
            const row = rows.get(depth).slice();
            row.sort((a, b) => {
                const ca = preferredCentre(a);
                const cb = preferredCentre(b);
                if (ca !== null && cb !== null) {
                    if (ca !== cb) return ca - cb;
                    return comparePeopleByNameOrPosition(a.ids[0], b.ids[0]);
                }
                if (ca !== null) return -1;
                if (cb !== null) return 1;
                return comparePeopleByNameOrPosition(a.ids[0], b.ids[0]);
            });

            let cursor = startX;
            row.forEach(unit => {
                const width = (unit.ids.length - 1) * hGap + CARD_W;
                const want = preferredCentre(unit);
                let x = want === null ? cursor : want - width / 2;
                if (x < cursor) x = cursor;
                const y = Math.round(vGap * (depth - baseDepth));
                unit.ids.forEach((id, index) => {
                    positions.set(id, { x: Math.round(x + index * hGap), y: y });
                });
                boxes.set(unit, { x: x, width: width, centre: x + width / 2 });
                cursor = x + width + hGap;
            });
        });

        return { positions: positions, boxes: boxes };
    }

    function positionBounds(positions) {
        if (!positions || !positions.size) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        positions.forEach(pos => {
            minX = Math.min(minX, pos.x);
            minY = Math.min(minY, pos.y);
            maxX = Math.max(maxX, pos.x + CARD_W);
            maxY = Math.max(maxY, pos.y + CARD_H);
        });
        return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
    }

    function shiftTo(positions, dx, dy) {
        const moved = new Map();
        positions.forEach((pos, id) => {
            moved.set(id, { x: Math.round(pos.x + dx), y: Math.round(pos.y + dy) });
        });
        return moved;
    }

    /* Keep the whole tree clear of the canvas origin. */
    function normalise(positions) {
        const bounds = positionBounds(positions);
        if (!bounds) return positions;
        return shiftTo(positions, PAD - bounds.minX, PAD - bounds.minY);
    }

    function layoutGenerations(hGap, vGap) {
        const context = buildContext();
        if (!context.units.length) return new Map();
        const rows = rowsByDepth(context.units);
        const base = Math.min.apply(null, context.units.map(unit => unit.depth));
        return normalise(placeUnits(rows, hGap, vGap, PAD, base).positions);
    }

    /* Mode 1 reuses the app's own auto-layout so the default view never changes. */
    function layoutAncestors() {
        try {
            const positions = calculateTreeLayout();
            if (positions && positions.size) return positions;
        } catch (err) { /* fall back to the generic layout below */ }
        return layoutGenerations(GAP_H, GAP_V);
    }

    function layoutCompact() {
        return layoutGenerations(GAP_H_COMPACT, GAP_V_COMPACT);
    }

    /* Generational, but the arrangement is offset so the selected person
     * ends up in the middle of the canvas (the view is then scrolled to
     * them as well). */
    function layoutCentred() {
        const positions = layoutGenerations(GAP_H, GAP_V);
        const id = selectedPersonId();
        const pos = id === null ? null : positions.get(id);
        const bounds = positionBounds(positions);
        if (!pos || !bounds) return positions;

        const area = drawingArea();
        const dx = Math.max(area.w / 2 - (pos.x + CARD_W / 2), -bounds.minX);
        const dy = Math.max(area.h / 2 - (pos.y + CARD_H / 2), -bounds.minY);
        return shiftTo(positions, dx, dy);
    }

    /* Size of the drawable canvas area, in canvas pixels. */
    function drawingArea() {
        const viewport = document.getElementById('treeViewport');
        const width = parseFloat(viewport && viewport.style.width) || 0;
        const height = parseFloat(viewport && viewport.style.height) || 0;
        if (width > 0 && height > 0) return { w: width, h: height };
        const canvas = document.getElementById('treeCanvas');
        return {
            w: (canvas && canvas.clientWidth) || 2400,
            h: (canvas && canvas.clientHeight) || 1600
        };
    }

    /* The earliest generation sits in the middle; every family that hangs
     * off it is laid out as its own wing to the left or the right. */
    function layoutFan(hGap, vGap) {
        const context = buildContext();
        if (!context.units.length) return new Map();

        const base = Math.min.apply(null, context.units.map(unit => unit.depth));
        const centreUnits = context.units.filter(unit => unit.depth === base);

        const parentUnit = new Map();
        context.units.forEach(unit => {
            if (unit.parentUnits.length) parentUnit.set(unit, unit.parentUnits[0]);
        });

        const branchRoots = new Set();
        context.units.forEach(unit => {
            if (unit.depth === base) return;
            if (unit.parentUnits.some(parent => parent.depth === base)) branchRoots.add(unit);
        });

        const branchOf = unit => {
            let current = unit;
            let last = unit;
            let guard = 0;
            while (current && guard++ < 1000) {
                if (branchRoots.has(current)) return current;
                last = current;
                current = parentUnit.get(current);
            }
            return last;
        };

        const branches = new Map();
        context.units.forEach(unit => {
            if (unit.depth === base) return;
            const branch = branchOf(unit);
            if (!branches.has(branch)) branches.set(branch, []);
            branches.get(branch).push(unit);
        });

        const positions = new Map();
        let centreWidth = 0;
        centreUnits.forEach(unit => { centreWidth += (unit.ids.length - 1) * hGap + CARD_W; });
        centreWidth += Math.max(0, centreUnits.length - 1) * hGap;

        let centreX = 0;
        centreUnits.forEach(unit => {
            const width = (unit.ids.length - 1) * hGap + CARD_W;
            unit.ids.forEach((id, index) => {
                positions.set(id, { x: Math.round(centreX + index * hGap), y: 0 });
            });
            centreX += width + hGap;
        });

        /* Lay every wing out on its own first, so the gaps can be balanced. */
        const wings = [];
        const branchList = Array.from(branches.keys());
        branchList.sort((a, b) => branches.get(b).length - branches.get(a).length);

        branchList.forEach((branch, index) => {
            const rows = rowsByDepth(branches.get(branch));
            const local = placeUnits(rows, hGap, vGap, 0, branch.depth);
            const bounds = positionBounds(local.positions);
            if (!bounds) return;
            wings.push({
                branch: branch,
                positions: local.positions,
                min: bounds.minX,
                max: bounds.maxX,
                width: bounds.maxX - bounds.minX,
                side: index % 2 === 0 ? 1 : -1
            });
        });

        const rightWings = wings.filter(wing => wing.side > 0);
        const leftWings = wings.filter(wing => wing.side < 0);
        const wingSpan = list => list.reduce((sum, wing) => sum + wing.width, 0)
            + Math.max(0, list.length - 1) * BRANCH_GAP;

        /* Balance the two wings so the centre couple really sits in the middle. */
        let gapLeft = BRANCH_GAP + (wingSpan(rightWings) - wingSpan(leftWings)) / 2;
        let gapRight = BRANCH_GAP - (wingSpan(rightWings) - wingSpan(leftWings)) / 2;
        if (gapRight < MIN_GAP) { gapLeft += MIN_GAP - gapRight; gapRight = MIN_GAP; }
        if (gapLeft < MIN_GAP) { gapRight += MIN_GAP - gapLeft; gapLeft = MIN_GAP; }

        const dropWing = (wing, dx) => {
            const dy = Math.round(vGap * (wing.branch.depth - base));
            shiftTo(wing.positions, dx, dy).forEach((pos, id) => positions.set(id, pos));
        };

        if (wings.length === 1) {
            const wing = wings[0];
            dropWing(wing, centreWidth / 2 - (wing.min + wing.width / 2));
        } else {
            let rightCursor = centreWidth + gapRight;
            rightWings.forEach(wing => {
                dropWing(wing, rightCursor - wing.min);
                rightCursor += wing.width + BRANCH_GAP;
            });
            let leftCursor = -gapLeft;
            leftWings.forEach(wing => {
                dropWing(wing, leftCursor - wing.max);
                leftCursor -= wing.width + BRANCH_GAP;
            });
        }

        return normalise(positions);
    }

    function computeModePositions(mode) {
        switch (mode) {
            case 'compact': return layoutCompact();
            case 'fan': return layoutFan(GAP_H, GAP_V);
            case 'centred': return layoutCentred();
            default: return layoutAncestors();
        }
    }

    /* ---------- applying ---------- */

    async function applyMode(mode) {
        const snapshot = people().map(p => ({ id: p.id, pos_x: p.pos_x || 0, pos_y: p.pos_y || 0 }));
        const positions = computeModePositions(mode);

        const changed = [];
        people().forEach(p => {
            const pos = positions.get(p.id);
            if (!pos) return;
            if (p.pos_x === pos.x && p.pos_y === pos.y) return;
            p.pos_x = pos.x;
            p.pos_y = pos.y;
            changed.push({ id: p.id, pos_x: pos.x, pos_y: pos.y });
        });

        pushUndo({
            label: 'the layout',
            run: async () => {
                await Promise.all(snapshot.map(point => savePersonPosition(point)));
                await loadTree();
                centerTree();
            }
        });

        if (changed.length) {
            const responses = await Promise.all(changed.map(savePersonPosition));
            const failed = responses.find(res => !res.ok);
            if (failed) throw new Error((await failed.text()) || 'could not save a position');
        }

        await loadTree();
        centerTree();

        if (mode === 'centred') {
            const id = selectedPersonId();
            if (id !== null && typeof centerOnPerson === 'function') centerOnPerson(id);
        }
    }

    /* ---------- dialog ---------- */

    function toast(message, isError) {
        if (typeof showToast === 'function') showToast(message, isError);
    }

    function modeLabel(value) {
        const mode = MODES.find(m => m.value === value);
        return mode ? mode.done : 'Re-arranged the tree.';
    }

    function refreshDialogState() {
        const group = document.getElementById('ftModeGroup');
        const empty = document.getElementById('ftLayoutEmpty');
        const apply = document.getElementById('ftLayoutApply');
        const note = document.getElementById('ftModeNote');
        if (!group || !empty || !apply || !note) return;

        const hasPeople = people().length > 0;
        const selectedId = selectedPersonId();

        group.hidden = !hasPeople;
        note.hidden = !hasPeople;
        empty.hidden = hasPeople;
        apply.disabled = !hasPeople;

        const centred = group.querySelector('input[value="centred"]');
        if (centred) {
            centred.disabled = !selectedId;
            const card = centred.closest('.ft-mode');
            if (card) {
                card.classList.toggle('is-disabled', !selectedId);
                card.setAttribute('aria-disabled', selectedId ? 'false' : 'true');
            }
            if (!selectedId && centred.checked) {
                const fallback = group.querySelector('input[value="ancestors"]');
                if (fallback) fallback.checked = true;
            }
        }

        if (selectedId) {
            const person = findPerson(selectedId);
            const name = person ? person.name : 'the selected person';
            note.textContent = 'Centre on selected person. The layout is offset so ' + name + ' sits in the middle.';
        } else {
            note.textContent = 'Centre on selected person. Select a person on the tree to centre the layout on them.';
        }
    }

    function selectedMode() {
        const checked = document.querySelector('input[name="' + MODE_NAME + '"]:checked');
        return checked ? checked.value : 'ancestors';
    }

    function closeDialog() {
        const dialog = document.getElementById('ftLayoutDialog');
        if (dialog && dialog.open) dialog.close();
    }

    function openLayoutDialog() {
        const dialog = document.getElementById('ftLayoutDialog');
        if (!dialog) return;
        refreshDialogState();
        if (!dialog.open) dialog.showModal();
        const focusTarget = dialog.querySelector('input[name="' + MODE_NAME + '"]:checked:not(:disabled)')
            || dialog.querySelector('input[name="' + MODE_NAME + '"]:not(:disabled)');
        if (focusTarget) focusTarget.focus();
    }

    async function onApply() {
        const mode = selectedMode();
        if (!people().length) {
            toast('Add people to the tree first.', true);
            return;
        }
        if (mode === 'centred' && selectedPersonId() === null) {
            toast('Select a person on the tree to centre the layout on them.', true);
            return;
        }
        closeDialog();
        try {
            await applyMode(mode);
            let message = modeLabel(mode);
            if (mode === 'centred') {
                const person = findPerson(selectedPersonId());
                message = 'Centred the layout on ' + (person ? person.name : 'the selected person') + '.';
            }
            toast(message);
        } catch (err) {
            toast('Could not arrange the tree: ' + (err && err.message ? err.message : 'unknown error'), true);
        }
    }

    function wire() {
        const dialog = document.getElementById('ftLayoutDialog');
        const cancel = document.getElementById('ftLayoutCancel');
        const apply = document.getElementById('ftLayoutApply');
        if (!dialog || !cancel || !apply) return;

        cancel.addEventListener('click', closeDialog);
        apply.addEventListener('click', onApply);
    }

    function init() {
        try {
            ensureStylesheet();
            injectMarkup();
            wire();
        } catch (err) {
            toast('The layout picker could not be opened.', true);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.openLayoutDialog = openLayoutDialog;
})();
