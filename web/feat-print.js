// ============================================================
// Family Tree Builder - printable family charts
//
// Renders a chart (whole family, ancestors of X, descendants of X)
// as a self-contained SVG and puts it on a single printed sheet.
// The browser's own print dialog is used, so "Save as PDF" gives
// a clean one-page chart.
// ============================================================
(function () {
    'use strict';

    const SVG_NS = 'http://www.w3.org/2000/svg';

    // Chart geometry, in SVG user units.
    const BOX_W = 152;
    const BOX_H = 86;
    const ROW_H = 148;
    const COL_GAP = 174;
    const TITLE_BAND = 64;   // room above the chart for the heading
    const PAD = 26;          // breathing room around the chart
    const PAGE_MARGIN_MM = 12;
    const PAPERS = {
        a4: { w: 210, h: 297, label: 'A4' },
        letter: { w: 215.9, h: 279.4, label: 'Letter' }
    };

    let renderSeq = 0;
    let optionToPerson = new Map();  // datalist value -> person
    let personToOption = new Map();  // person id -> datalist value

    // ---------------------------------------------------------
    // Small helpers
    // ---------------------------------------------------------

    function ftColor(name, fallback) {
        const value = getComputedStyle(document.body).getPropertyValue(name).trim();
        return value || fallback;
    }

    function ftPeople() {
        return Array.isArray(currentPersons) ? currentPersons : [];
    }

    function ftNameOf(person) {
        return person && person.name ? person.name : 'Unnamed';
    }

    function ftShortName(name) {
        const text = String(name || '').trim() || 'Unnamed';
        return text.length > 24 ? text.slice(0, 23).trim() + '…' : text;
    }

    function ftFormatDate(iso) {
        if (!iso) return '';
        const parts = String(iso).split('-');
        if (parts.length !== 3) return String(iso);
        const y = parts[0], m = parts[1], d = parts[2];
        const fmt = (typeof dateFormat !== 'undefined' && dateFormat) ? dateFormat : 'dmy';
        if (fmt === 'mdy') return `${m}/${d}/${y}`;
        if (fmt === 'ymd') return `${y}-${m}-${d}`;
        return `${d}/${m}/${y}`;
    }

    function ftLifespan(person) {
        const born = ftFormatDate(person.dob);
        const died = ftFormatDate(person.dod);
        if (born && died) return born + ' – ' + died;
        if (born) return 'b. ' + born;
        if (died) return 'd. ' + died;
        if (person.birth_country) return person.birth_country;
        if (person.profession) return person.profession;
        return '';
    }

    function ftPeopleSummary(count) {
        return count + (count === 1 ? ' person' : ' people');
    }

    // The canvas draws each card around this point; reusing it keeps the
    // printed chart aligned with what the user sees on screen.
    function ftNodeMetrics() {
        return {
            cx: (typeof NODE_CENTER_X !== 'undefined' ? NODE_CENTER_X : 74),
            cy: (typeof NODE_CENTER_Y !== 'undefined' ? NODE_CENTER_Y : 40)
        };
    }

    function ftRelationColor(relation) {
        const value = String(relation || '');
        if (value === 'spouse' || value === 'spouse-divorced') return ftColor('--spouse', '#d6537e');
        if (value.startsWith('child')) return ftColor('--parent', '#b57d17');
        if (value.startsWith('sibling')) return ftColor('--sibling', '#3b5bdb');
        return ftColor('--root', '#6b8b89');
    }

    function ftRelationDash(relation) {
        const value = String(relation || '');
        if (value === 'spouse-divorced') return '6 4';
        if (value === 'sibling-half') return '6 4';
        if (value === 'sibling-step') return '2 4';
        if (value === 'child-foster' || value === 'child-guardian') return '6 4';
        if (value === 'child-unknown') return '2 4';
        return '';
    }

    // Where a line leaving a box meets its edge.
    function ftEdgePoint(from, to, halfW, halfH) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        if (!dx && !dy) return { x: from.x, y: from.y };
        const tx = dx ? Math.abs(halfW / dx) : Infinity;
        const ty = dy ? Math.abs(halfH / dy) : Infinity;
        const t = Math.min(tx, ty);
        return { x: from.x + dx * t, y: from.y + dy * t };
    }

    // ---------------------------------------------------------
    // SVG pieces
    // ---------------------------------------------------------

    function ftBoxSvg(person, cx, cy, prefix) {
        const fill = ftColor('--surface', '#ffffff');
        const stroke = ftColor('--border', '#deded8');
        const textColor = ftColor('--text', '#202321');
        const muted = ftColor('--muted', '#666d69');
        const avatarBg = ftColor('--avatar-bg', '#dfe6e5');

        const x = cx - BOX_W / 2;
        const y = cy - BOX_H / 2;
        const radius = 19;
        const circleY = y + 26;

        let s = `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${BOX_W}" height="${BOX_H}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
        s += `<circle cx="${cx.toFixed(1)}" cy="${circleY}" r="${radius}" fill="${avatarBg}" stroke="${stroke}" stroke-width="1.5"/>`;

        if (person.image_url) {
            const href = /^https?:/i.test(person.image_url) ? person.image_url : location.origin + person.image_url;
            const clipId = `${prefix}clip${person.id}`;
            s += `<clipPath id="${clipId}"><circle cx="${cx.toFixed(1)}" cy="${circleY}" r="${radius - 1}"/></clipPath>`;
            s += `<image href="${escapeAttr(href)}" x="${(cx - radius + 1).toFixed(1)}" y="${(circleY - radius + 1).toFixed(1)}" width="${(radius - 1) * 2}" height="${(radius - 1) * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`;
        } else {
            const initial = ftNameOf(person).trim().charAt(0).toUpperCase();
            s += `<text x="${cx.toFixed(1)}" y="${(circleY + 6).toFixed(1)}" text-anchor="middle" font-family="Inter, sans-serif" font-size="19" font-weight="600" fill="${muted}">${escapeHtml(initial)}</text>`;
        }

        s += `<text x="${cx.toFixed(1)}" y="${(y + 62).toFixed(1)}" text-anchor="middle" font-family="Inter, sans-serif" font-size="13" font-weight="700" fill="${textColor}">${escapeHtml(ftShortName(person.name))}</text>`;

        const life = ftLifespan(person);
        if (life) {
            s += `<text x="${cx.toFixed(1)}" y="${(y + 78).toFixed(1)}" text-anchor="middle" font-family="Inter, sans-serif" font-size="10" fill="${muted}">${escapeHtml(life)}</text>`;
        }
        return s;
    }

    // Grow the content bounds until they match the page's aspect ratio, so the
    // chart fills the sheet instead of floating in the middle of it.
    function ftFitBounds(x0, y0, x1, y1, aspect) {
        let w = (x1 - x0) + PAD * 2;
        let h = (y1 - y0) + PAD * 2;
        if (!(w > 0)) w = PAD * 2;
        if (!(h > 0)) h = PAD * 2;
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        let vw = w;
        let vh = h;
        if (w / h < aspect) vw = h * aspect;
        else vh = w / aspect;
        return { x: cx - vw / 2, y: cy - vh / 2, w: vw, h: vh };
    }

    function ftAssembleSvg(chart, prefix, aspect) {
        const textColor = ftColor('--text', '#202321');
        const muted = ftColor('--muted', '#666d69');
        const display = ftColor('--font-display', "'Source Serif 4', Georgia, serif");

        const view = ftFitBounds(chart.x0, chart.y0 - TITLE_BAND, chart.x1, chart.y1, aspect);

        let s = `<svg xmlns="${SVG_NS}" viewBox="${view.x.toFixed(1)} ${view.y.toFixed(1)} ${view.w.toFixed(1)} ${view.h.toFixed(1)}" preserveAspectRatio="xMidYMid meet">`;
        s += `<rect x="${view.x.toFixed(1)}" y="${view.y.toFixed(1)}" width="${view.w.toFixed(1)}" height="${view.h.toFixed(1)}" fill="${ftColor('--surface', '#ffffff')}"/>`;
        s += `<text x="${chart.x0.toFixed(1)}" y="${(chart.y0 - 38).toFixed(1)}" font-family="${escapeAttr(display)}" font-size="26" font-weight="700" fill="${textColor}">${escapeHtml(chart.title)}</text>`;
        s += `<text x="${chart.x0.toFixed(1)}" y="${(chart.y0 - 14).toFixed(1)}" font-family="Inter, sans-serif" font-size="12" fill="${muted}">${escapeHtml(chart.subtitle)}</text>`;
        s += chart.content;
        s += `</svg>`;
        return s;
    }

    // ---------------------------------------------------------
    // Chart: the whole family, at its current canvas positions
    // ---------------------------------------------------------

    function ftBuildFamilyChart(prefix) {
        const people = ftPeople();
        const metrics = ftNodeMetrics();
        const centers = new Map();

        people.forEach(person => {
            centers.set(person.id, {
                x: (person.pos_x || 0) + metrics.cx,
                y: (person.pos_y || 0) + metrics.cy
            });
        });

        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        centers.forEach(center => {
            x0 = Math.min(x0, center.x - BOX_W / 2);
            x1 = Math.max(x1, center.x + BOX_W / 2);
            y0 = Math.min(y0, center.y - BOX_H / 2);
            y1 = Math.max(y1, center.y + BOX_H / 2);
        });
        if (!isFinite(x0)) {
            x0 = 0; y0 = 0; x1 = BOX_W; y1 = BOX_H;
        }

        let lines = '';
        (Array.isArray(currentRelationships) ? currentRelationships : []).forEach(rel => {
            const a = centers.get(rel.person1_id);
            const b = centers.get(rel.person2_id);
            if (!a || !b) return;
            const from = ftEdgePoint(a, b, BOX_W / 2, BOX_H / 2);
            const to = ftEdgePoint(b, a, BOX_W / 2, BOX_H / 2);
            const dash = ftRelationDash(rel.relation);
            lines += `<line x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${to.x.toFixed(1)}" y2="${to.y.toFixed(1)}" stroke="${ftRelationColor(rel.relation)}" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
        });

        let boxes = '';
        people.forEach(person => {
            const center = centers.get(person.id);
            boxes += ftBoxSvg(person, center.x, center.y, prefix);
        });

        return {
            content: lines + boxes,
            x0: x0, y0: y0, x1: x1, y1: y1,
            title: 'Family Tree',
            subtitle: ftPeopleSummary(people.length)
        };
    }

    // ---------------------------------------------------------
    // Chart: ancestors of / descendants of one person
    // ---------------------------------------------------------

    // Walks up (ancestors) or down (descendants) the parent/child links and
    // lays the result out in generations, parents above children.
    function ftGenerationalLayout(subjectId, mode) {
        const people = ftPeople();
        const idSet = new Set(people.map(person => person.id));
        const edges = (Array.isArray(currentRelationships) ? currentRelationships : [])
            .map(rel => parentChildEdge(rel, idSet))
            .filter(Boolean);

        const parentsOf = new Map();
        const childrenOf = new Map();
        edges.forEach(edge => {
            if (!parentsOf.has(edge.child)) parentsOf.set(edge.child, []);
            if (!childrenOf.has(edge.parent)) childrenOf.set(edge.parent, []);
            if (!parentsOf.get(edge.child).includes(edge.parent)) parentsOf.get(edge.child).push(edge.parent);
            if (!childrenOf.get(edge.parent).includes(edge.child)) childrenOf.get(edge.parent).push(edge.child);
        });

        const level = new Map();
        level.set(subjectId, 0);
        let frontier = [subjectId];
        let maxLevel = 0;
        let guard = people.length + 2;
        while (frontier.length && guard-- > 0) {
            const next = [];
            frontier.forEach(id => {
                const related = mode === 'ancestors'
                    ? (parentsOf.get(id) || [])
                    : (childrenOf.get(id) || []);
                related.forEach(other => {
                    if (level.has(other)) return;
                    const lv = level.get(id) + 1;
                    level.set(other, lv);
                    if (lv > maxLevel) maxLevel = lv;
                    next.push(other);
                });
            });
            frontier = next;
        }

        const groups = [];
        for (let l = 0; l <= maxLevel; l++) groups.push([]);
        level.forEach((lv, id) => groups[lv].push(id));

        const x = new Map();
        for (let l = 0; l <= maxLevel; l++) {
            const ids = groups[l];

            // The people this row hangs off: children for an ancestor chart,
            // parents for a descendant chart.
            const anchors = (id) => {
                const list = mode === 'ancestors'
                    ? (childrenOf.get(id) || [])
                    : (parentsOf.get(id) || []);
                return list.filter(other => level.get(other) === l - 1);
            };

            const desired = new Map();
            ids.forEach(id => {
                const list = anchors(id);
                desired.set(id, list.length
                    ? list.reduce((sum, other) => sum + x.get(other), 0) / list.length
                    : null);
            });

            const ordered = ids.slice().sort((a, b) => {
                const da = desired.get(a);
                const db = desired.get(b);
                if (da === null && db === null) {
                    const pa = findPerson(a);
                    const pb = findPerson(b);
                    return ftNameOf(pa).localeCompare(ftNameOf(pb));
                }
                if (da === null) return 1;
                if (db === null) return -1;
                return da - db;
            });

            let cursor = null;
            const wanted = new Map();
            ordered.forEach(id => {
                let want = desired.get(id);
                if (want === null) want = cursor === null ? 0 : cursor + COL_GAP;
                const value = cursor === null ? want : Math.max(want, cursor + COL_GAP);
                x.set(id, value);
                wanted.set(id, want);
                cursor = value;
            });

            // Line the row up with the row it hangs off.
            const xs = ordered.map(id => x.get(id));
            const ws = ordered.map(id => wanted.get(id));
            const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
            const meanW = ws.reduce((sum, value) => sum + value, 0) / ws.length;
            const shift = meanW - meanX;
            if (shift) ordered.forEach(id => x.set(id, x.get(id) + shift));
        }

        const nodes = new Map();
        level.forEach((lv, id) => {
            const y = mode === 'ancestors' ? (maxLevel - lv) * ROW_H : lv * ROW_H;
            nodes.set(id, { id: id, x: x.get(id), y: y, level: lv });
        });

        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        nodes.forEach(node => {
            x0 = Math.min(x0, node.x - BOX_W / 2);
            x1 = Math.max(x1, node.x + BOX_W / 2);
            y0 = Math.min(y0, node.y - BOX_H / 2);
            y1 = Math.max(y1, node.y + BOX_H / 2);
        });

        return { nodes: nodes, edges: edges, maxLevel: maxLevel, x0: x0, y0: y0, x1: x1, y1: y1 };
    }

    function ftBuildGenerationalChart(subject, mode, prefix) {
        const layout = ftGenerationalLayout(subject.id, mode);
        const parentColor = ftColor('--parent', '#b57d17');

        let lines = '';
        layout.edges.forEach(edge => {
            const parent = layout.nodes.get(edge.parent);
            const child = layout.nodes.get(edge.child);
            if (!parent || !child) return;
            if (parent.y >= child.y) return; // the parent must sit above the child
            const top = parent.y + BOX_H / 2;
            const bottom = child.y - BOX_H / 2;
            const middle = (top + bottom) / 2;
            lines += `<path d="M ${parent.x.toFixed(1)} ${top.toFixed(1)} V ${middle.toFixed(1)} H ${child.x.toFixed(1)} V ${bottom.toFixed(1)}" fill="none" stroke="${parentColor}" stroke-width="2"/>`;
        });

        let boxes = '';
        layout.nodes.forEach(node => {
            const person = findPerson(node.id);
            if (!person) return;
            boxes += ftBoxSvg(person, node.x, node.y, prefix);
        });

        const generations = layout.maxLevel + 1;
        const title = (mode === 'ancestors' ? 'Ancestors of ' : 'Descendants of ') + ftNameOf(subject);

        return {
            content: lines + boxes,
            x0: layout.x0, y0: layout.y0, x1: layout.x1, y1: layout.y1,
            title: title,
            subtitle: ftPeopleSummary(layout.nodes.size) + ' · ' + generations + (generations === 1 ? ' generation' : ' generations')
        };
    }

    // ---------------------------------------------------------
    // Dialog plumbing
    // ---------------------------------------------------------

    function ftType() {
        const select = document.getElementById('ftPrintType');
        const value = select ? select.value : 'family';
        return value === 'ancestors' || value === 'descendants' ? value : 'family';
    }

    function ftOrientation() {
        const select = document.getElementById('ftPrintOrientation');
        return select && select.value === 'landscape' ? 'landscape' : 'portrait';
    }

    function ftPaper() {
        const select = document.getElementById('ftPrintPaper');
        return select && select.value === 'letter' ? 'letter' : 'a4';
    }

    function ftSetStatus(message, isError) {
        const status = document.getElementById('ftPrintStatus');
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('error', !!isError);
    }

    // The @page rule and the sheet size have to follow the chosen paper.
    function ftUpdatePageStyle() {
        const paperName = ftPaper();
        const paper = PAPERS[paperName] || PAPERS.a4;
        const landscape = ftOrientation() === 'landscape';
        const pageW = landscape ? paper.h : paper.w;
        const pageH = landscape ? paper.w : paper.h;

        const style = document.getElementById('ftPrintPageStyle');
        if (style) {
            style.textContent = '@page { size: ' + paper.label + ' ' + (landscape ? 'landscape' : 'portrait') +
                '; margin: ' + PAGE_MARGIN_MM + 'mm; }';
        }

        // 1mm smaller than the printable area: rounding must never push the
        // sheet onto a second page.
        const sheetW = pageW - PAGE_MARGIN_MM * 2 - 1;
        const sheetH = pageH - PAGE_MARGIN_MM * 2 - 1;
        const sheet = document.getElementById('ftPrintSheet');
        if (sheet) {
            sheet.style.width = sheetW.toFixed(2) + 'mm';
            sheet.style.height = sheetH.toFixed(2) + 'mm';
        }

        return {
            w: sheetW,
            h: sheetH,
            label: paper.label + ' · ' + (landscape ? 'Landscape' : 'Portrait')
        };
    }

    function ftFillPeopleList() {
        const list = document.getElementById('ftPrintPeopleList');
        if (!list) return;

        const people = ftPeople().slice().sort((a, b) => ftNameOf(a).localeCompare(ftNameOf(b)));
        const counts = new Map();
        people.forEach(person => {
            const name = ftNameOf(person);
            counts.set(name, (counts.get(name) || 0) + 1);
        });

        optionToPerson = new Map();
        personToOption = new Map();

        list.innerHTML = people.map(person => {
            const name = ftNameOf(person);
            // Two people can share a name; keep the options unique so the
            // person the user picked is unambiguous.
            const value = counts.get(name) > 1 ? name + ' (' + person.id + ')' : name;
            optionToPerson.set(value, person);
            personToOption.set(person.id, value);
            return '<option value="' + escapeAttr(value) + '"></option>';
        }).join('');
    }

    function ftResolvePerson(text) {
        const query = String(text || '').trim();
        if (!query) return null;
        if (optionToPerson.has(query)) return optionToPerson.get(query);
        const lower = query.toLowerCase();
        let match = null;
        optionToPerson.forEach((person, value) => {
            if (match) return;
            if (value.toLowerCase() === lower) match = person;
        });
        if (match) return match;
        optionToPerson.forEach((person, value) => {
            if (match) return;
            if (value.toLowerCase().indexOf(lower) === 0) match = person;
        });
        return match;
    }

    function ftDefaultPersonId() {
        const people = ftPeople();
        if (!people.length) return null;
        const selected = (typeof selectedNodeId !== 'undefined' && selectedNodeId !== null) ? selectedNodeId : null;
        if (selected !== null && people.some(person => person.id === selected)) return selected;
        return people[0].id;
    }

    function ftSyncTypeFields() {
        const type = ftType();
        const ancestorField = document.getElementById('ftPrintAncestorField');
        const descendantField = document.getElementById('ftPrintDescendantField');
        if (ancestorField) ancestorField.hidden = type !== 'ancestors';
        if (descendantField) descendantField.hidden = type !== 'descendants';
    }

    function ftRefresh() {
        const preview = document.getElementById('ftPrintPreview');
        const sheet = document.getElementById('ftPrintSheet');
        const printBtn = document.getElementById('ftPrintBtn');
        if (!preview || !sheet) return;

        const page = ftUpdatePageStyle();
        const people = ftPeople();

        if (!people.length) {
            preview.innerHTML = '';
            sheet.innerHTML = '';
            if (printBtn) printBtn.disabled = true;
            ftSetStatus('Add people to the tree first.', true);
            return;
        }

        const type = ftType();
        const prefix = 'ftp' + (++renderSeq) + '-';
        let chart = null;

        if (type === 'ancestors' || type === 'descendants') {
            const input = document.getElementById(type === 'ancestors' ? 'ftPrintAncestor' : 'ftPrintDescendant');
            const person = ftResolvePerson(input ? input.value : '');
            if (!person) {
                preview.innerHTML = '';
                sheet.innerHTML = '';
                if (printBtn) printBtn.disabled = true;
                ftSetStatus('Choose a person for this chart.', true);
                return;
            }
            chart = ftBuildGenerationalChart(person, type, prefix);
        } else {
            chart = ftBuildFamilyChart(prefix);
        }

        const aspect = page.w / page.h;
        const previewSvg = ftAssembleSvg(chart, prefix, aspect);
        // The preview and the print sheet are both in the document, so each
        // needs its own set of ids.
        const sheetSvg = previewSvg.split(prefix).join(prefix + 's');

        preview.innerHTML = previewSvg;
        sheet.innerHTML = sheetSvg;
        if (printBtn) printBtn.disabled = false;
        ftSetStatus(chart.subtitle + ' · ' + page.label, false);
    }

    function ftPrint() {
        ftRefresh();
        window.print();
    }

    function ftClose() {
        const dialog = document.getElementById('ftPrintDialog');
        if (dialog && dialog.open) dialog.close();
    }

    function openPrintDialog() {
        const dialog = document.getElementById('ftPrintDialog');
        if (!dialog) return;

        ftFillPeopleList();

        const fallback = ftDefaultPersonId();
        const value = fallback === null ? '' : (personToOption.get(fallback) || '');
        const ancestor = document.getElementById('ftPrintAncestor');
        const descendant = document.getElementById('ftPrintDescendant');
        if (ancestor) ancestor.value = value;
        if (descendant) descendant.value = value;

        ftSyncTypeFields();
        ftRefresh();

        if (!dialog.open) dialog.showModal();
        const typeSelect = document.getElementById('ftPrintType');
        if (typeSelect) setTimeout(() => typeSelect.focus(), 30);
    }

    // ---------------------------------------------------------
    // Markup + wiring
    // ---------------------------------------------------------

    function ftMarkup() {
        return [
            '<dialog id="ftPrintDialog" class="ft-print-dialog" aria-labelledby="ftPrintHeading">',
            '  <div class="ft-print-body">',
            '    <div class="ft-print-head">',
            '      <h2 class="ft-print-heading" id="ftPrintHeading">Print a family chart</h2>',
            '      <button type="button" class="ft-print-close" data-ft-close aria-label="Close the print dialog">',
            '        <svg class="icon" aria-hidden="true"><use href="#i-close"/></svg>',
            '      </button>',
            '    </div>',
            '    <div class="ft-print-layout">',
            '      <div class="ft-print-controls">',
            '        <label class="field-label" for="ftPrintType">Chart type</label>',
            '        <select id="ftPrintType">',
            '          <option value="family">Family chart — everyone on the canvas</option>',
            '          <option value="ancestors">Ancestors of one person</option>',
            '          <option value="descendants">Descendants of one person</option>',
            '        </select>',
            '        <div class="ft-print-field" id="ftPrintAncestorField" hidden>',
            '          <label class="field-label" for="ftPrintAncestor">Ancestor of</label>',
            '          <input type="search" id="ftPrintAncestor" list="ftPrintPeopleList" placeholder="Start typing a name" autocomplete="off" spellcheck="false">',
            '        </div>',
            '        <div class="ft-print-field" id="ftPrintDescendantField" hidden>',
            '          <label class="field-label" for="ftPrintDescendant">Descendant of</label>',
            '          <input type="search" id="ftPrintDescendant" list="ftPrintPeopleList" placeholder="Start typing a name" autocomplete="off" spellcheck="false">',
            '        </div>',
            '        <datalist id="ftPrintPeopleList"></datalist>',
            '        <label class="field-label" for="ftPrintOrientation">Orientation</label>',
            '        <select id="ftPrintOrientation">',
            '          <option value="portrait">Portrait</option>',
            '          <option value="landscape">Landscape</option>',
            '        </select>',
            '        <label class="field-label" for="ftPrintPaper">Paper</label>',
            '        <select id="ftPrintPaper">',
            '          <option value="a4">A4</option>',
            '          <option value="letter">Letter</option>',
            '        </select>',
            '        <p class="ft-print-note">Print — choose "Save as PDF" in the print dialog to keep a copy on disk.</p>',
            '      </div>',
            '      <div class="ft-print-pane">',
            '        <div class="ft-print-pane-label">Preview</div>',
            '        <div class="ft-print-preview" id="ftPrintPreview"></div>',
            '        <p class="ft-print-status" id="ftPrintStatus" role="status" aria-live="polite"></p>',
            '        <section class="ft-print-csv">',
            '          <h3 class="ft-print-subheading">Export data as CSV</h3>',
            '          <div class="ft-print-links">',
            '            <a class="ft-print-link" href="/api/export.csv?type=people" download="people.csv">',
            '              <svg class="icon" aria-hidden="true"><use href="#i-download"/></svg> People <span class="ft-print-file">people.csv</span>',
            '            </a>',
            '            <a class="ft-print-link" href="/api/export.csv?type=relationships" download="relationships.csv">',
            '              <svg class="icon" aria-hidden="true"><use href="#i-download"/></svg> Relationships <span class="ft-print-file">relationships.csv</span>',
            '            </a>',
            '          </div>',
            '        </section>',
            '      </div>',
            '    </div>',
            '    <div class="ft-print-actions">',
            '      <button type="button" class="btn-secondary" data-ft-close>Close</button>',
            '      <button type="button" class="btn-primary" id="ftPrintBtn" data-ft-print disabled>',
            '        <svg class="icon" aria-hidden="true"><use href="#i-print"/></svg> Print',
            '      </button>',
            '    </div>',
            '  </div>',
            '</dialog>',
            '<div class="ft-print-sheet" id="ftPrintSheet" aria-hidden="true"></div>'
        ].join('\n');
    }

    function ftWire() {
        const dialog = document.getElementById('ftPrintDialog');
        if (!dialog) return;

        const typeSelect = document.getElementById('ftPrintType');
        const orientation = document.getElementById('ftPrintOrientation');
        const paper = document.getElementById('ftPrintPaper');
        const ancestor = document.getElementById('ftPrintAncestor');
        const descendant = document.getElementById('ftPrintDescendant');
        const printBtn = document.getElementById('ftPrintBtn');

        if (typeSelect) typeSelect.addEventListener('change', () => { ftSyncTypeFields(); ftRefresh(); });
        if (orientation) orientation.addEventListener('change', ftRefresh);
        if (paper) paper.addEventListener('change', ftRefresh);
        if (ancestor) ancestor.addEventListener('input', ftRefresh);
        if (descendant) descendant.addEventListener('input', ftRefresh);
        if (printBtn) printBtn.addEventListener('click', ftPrint);

        dialog.querySelectorAll('[data-ft-close]').forEach(btn => {
            btn.addEventListener('click', ftClose);
        });
        dialog.addEventListener('click', event => {
            if (event.target === dialog) ftClose();
        });
    }

    function ftInjectStylesheet() {
        if (document.querySelector('link[href$="feat-print.css"]')) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/static/feat-print.css';
        link.setAttribute('data-ft-print', '');
        document.head.appendChild(link);
    }

    function ftInit() {
        if (document.getElementById('ftPrintDialog')) return;

        ftInjectStylesheet();

        if (!document.getElementById('ftPrintPageStyle')) {
            const style = document.createElement('style');
            style.id = 'ftPrintPageStyle';
            document.head.appendChild(style);
        }

        const host = document.createElement('div');
        host.innerHTML = ftMarkup();
        while (host.firstChild) document.body.appendChild(host.firstChild);

        ftWire();
    }

    window.openPrintDialog = openPrintDialog;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ftInit);
    } else {
        ftInit();
    }
})();
