/* ============================================================
   Relationship finder - answers "how are these two people
   related?" using only the data already in the tree.
   Pure client-side: no server, no API calls.
   ============================================================ */
(function () {
    'use strict';

    var DIALOG_ID = 'ftRelationsDialog';
    var MAX_HITS = 8;
    var ORDINALS = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth' };

    // Same wording the sidebar uses for a connection.
    var PARENT_WORD = {
        '': 'parent',
        'adoptive': 'adoptive parent',
        'foster': 'foster parent',
        'guardian': 'guardian',
        'unknown': 'unknown parent'
    };
    var CHILD_WORD = {
        '': 'child',
        'adoptive': 'adoptive child',
        'foster': 'foster child',
        'guardian': 'guardian child',
        'unknown': 'unknown child'
    };

    var state = { a: null, b: null, hits: [[], []], cursor: [-1, -1] };

    /* ---------------- data helpers ---------------- */

    function allPersons() {
        return (typeof currentPersons !== 'undefined' && Array.isArray(currentPersons)) ? currentPersons : [];
    }

    function allRelationships() {
        return (typeof currentRelationships !== 'undefined' && Array.isArray(currentRelationships)) ? currentRelationships : [];
    }

    function personById(id) {
        if (typeof findPerson === 'function') return findPerson(id);
        var list = allPersons();
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === Number(id)) return list[i];
        }
        return null;
    }

    function nameOf(id) {
        var p = personById(id);
        return p && p.name ? p.name : 'Unnamed person';
    }

    function initialsOf(name) {
        var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    /* ---------------- graph ---------------- */

    // Undirected links between people. Parent-child links keep their
    // direction (a = parent, b = child); spouse and sibling links are
    // symmetric.
    function buildGraph() {
        var list = allPersons();
        var rels = allRelationships();
        var idSet = new Set(list.map(function (p) { return p.id; }));
        var links = [];
        var parentMap = new Map();

        list.forEach(function (p) { parentMap.set(p.id, []); });

        rels.forEach(function (rel) {
            if (!rel) return;
            var edge = parentChildEdge(rel, idSet);
            if (edge) {
                var raw = String(rel.relation || '').toLowerCase();
                var subtype = raw.indexOf('child-') === 0 ? raw.slice(6) : '';
                links.push({ type: 'parent-child', subtype: subtype, a: edge.parent, b: edge.child });
                var parents = parentMap.get(edge.child) || [];
                if (parents.indexOf(edge.parent) === -1) parents.push(edge.parent);
                parentMap.set(edge.child, parents);
                return;
            }
            if (!idSet.has(rel.person1_id) || !idSet.has(rel.person2_id)) return;
            var relation = String(rel.relation || '').toLowerCase();
            var link = { type: null, subtype: '', a: rel.person1_id, b: rel.person2_id };
            if (relation === 'spouse') link.type = 'spouse';
            else if (relation === 'spouse-divorced') link.type = 'ex-partner';
            else if (relation === 'sibling-full') { link.type = 'sibling'; link.subtype = 'full'; }
            else if (relation === 'sibling-half') { link.type = 'sibling'; link.subtype = 'half'; }
            else if (relation === 'sibling-step') { link.type = 'sibling'; link.subtype = 'step'; }
            if (link.type) links.push(link);
        });

        var adjacency = new Map();
        list.forEach(function (p) { adjacency.set(p.id, []); });
        links.forEach(function (link) {
            if (!adjacency.has(link.a) || !adjacency.has(link.b)) return;
            adjacency.get(link.a).push({ to: link.b, link: link });
            adjacency.get(link.b).push({ to: link.a, link: link });
        });

        var parentAdjacency = new Map();
        adjacency.forEach(function (steps, id) {
            parentAdjacency.set(id, steps.filter(function (step) { return step.link.type === 'parent-child'; }));
        });

        return { links: links, adjacency: adjacency, parentAdjacency: parentAdjacency, parentMap: parentMap };
    }

    // How this person relates to the other end of the link.
    function roleWord(link, fromId) {
        if (link.type === 'parent-child') {
            if (link.a === fromId) return PARENT_WORD[link.subtype] || PARENT_WORD[''];
            return CHILD_WORD[link.subtype] || CHILD_WORD[''];
        }
        if (link.type === 'spouse') return 'partner';
        if (link.type === 'ex-partner') return 'ex-partner';
        if (link.subtype === 'half') return 'half sibling';
        if (link.subtype === 'step') return 'step sibling';
        return 'full sibling';
    }

    // Symmetric wording for a direct link between the two people.
    function pairWord(link) {
        if (link.type === 'parent-child') {
            return (PARENT_WORD[link.subtype] || PARENT_WORD['']) + ' and ' + (CHILD_WORD[link.subtype] || CHILD_WORD['']);
        }
        if (link.type === 'spouse') return 'partners';
        if (link.type === 'ex-partner') return 'ex-partners';
        if (link.subtype === 'half') return 'half siblings';
        if (link.subtype === 'step') return 'step siblings';
        return 'full siblings';
    }

    // Breadth-first search. Returns the chain of people from `from` to `to`,
    // each entry carrying the link that joins it to the next one.
    function shortestPath(adjacency, from, to, accept) {
        if (from === to) return [{ id: from, link: null }];
        var prev = new Map();
        prev.set(from, null);
        var queue = [from];

        while (queue.length) {
            var current = queue.shift();
            var steps = adjacency.get(current) || [];
            for (var i = 0; i < steps.length; i++) {
                var step = steps[i];
                if (prev.has(step.to)) continue;
                if (accept && !accept(step.link)) continue;
                prev.set(step.to, { from: current, link: step.link });
                if (step.to === to) return rebuildPath(to, prev);
                queue.push(step.to);
            }
        }
        return null;
    }

    function rebuildPath(target, prev) {
        var out = [];
        var cursor = target;
        while (cursor !== null && cursor !== undefined) {
            var info = prev.get(cursor);
            out.unshift({ id: cursor, link: info ? info.link : null });
            cursor = info ? info.from : null;
        }
        return out;
    }

    // Every recorded ancestor of a person, with the number of parent links
    // between them.
    function ancestorsOf(parentMap, id) {
        var dist = new Map();
        var seen = new Set([id]);
        var frontier = [id];
        var depth = 0;

        while (frontier.length) {
            depth++;
            var next = [];
            frontier.forEach(function (personId) {
                (parentMap.get(personId) || []).forEach(function (parentId) {
                    if (seen.has(parentId)) return;
                    seen.add(parentId);
                    dist.set(parentId, depth);
                    next.push(parentId);
                });
            });
            frontier = next;
        }
        return dist;
    }

    /* ---------------- the actual question ---------------- */

    function analyse(aId, bId) {
        var graph = buildGraph();
        var direct = null;
        graph.links.forEach(function (link) {
            if (!direct && ((link.a === aId && link.b === bId) || (link.a === bId && link.b === aId))) direct = link;
        });

        var ancA = ancestorsOf(graph.parentMap, aId);
        var ancB = ancestorsOf(graph.parentMap, bId);

        var commons = [];
        ancA.forEach(function (dA, id) {
            var dB = ancB.get(id);
            if (dB !== undefined) commons.push({ id: id, dA: dA, dB: dB });
        });
        commons.sort(function (x, y) {
            return (x.dA + x.dB) - (y.dA + y.dB) || Math.max(x.dA, x.dB) - Math.max(y.dA, y.dB);
        });
        var best = commons.length ? commons[0] : null;

        var ancestor = null;
        if (ancB.has(aId)) ancestor = { id: aId, dA: 0, dB: ancB.get(aId) };
        else if (ancA.has(bId)) ancestor = { id: bId, dA: ancA.get(bId), dB: 0 };

        var chain = buildChain(graph, aId, bId, direct, best, ancestor);
        var result = {
            a: aId,
            b: bId,
            direct: direct,
            commons: commons,
            chain: chain,
            headline: '',
            detail: '',
            generations: null,
            connected: !!chain
        };

        describe(result, best, ancestor);
        return result;
    }

    function buildChain(graph, aId, bId, direct, best, ancestor) {
        if (direct) return [{ id: aId, link: direct }, { id: bId, link: null }];

        var parentAdjacency = graph.parentAdjacency;

        if (best) {
            var up = shortestPath(parentAdjacency, best.id, aId);
            var down = shortestPath(parentAdjacency, best.id, bId);
            if (up && down) {
                var merged = up.slice().reverse().concat(down.slice(1));
                // The shared ancestor now joins two branches, so it needs the
                // link that leads down to the next person.
                merged[up.length - 1].link = down.length > 1 ? down[1].link : null;
                return merged;
            }
        }

        if (ancestor) {
            var lower = ancestor.dA === 0 ? bId : aId;
            var path = shortestPath(parentAdjacency, ancestor.id, lower);
            if (path) return ancestor.dA === 0 ? path : path.slice().reverse();
        }

        return shortestPath(graph.adjacency, aId, bId);
    }

    function describe(result, best, ancestor) {
        var aName = nameOf(result.a);
        var bName = nameOf(result.b);

        if (result.direct) {
            result.headline = aName + ' and ' + bName + ' are ' + pairWord(result.direct) + '.';
            result.detail = 'This link is recorded directly in the tree.';
            if (result.direct.type === 'parent-child') result.generations = 1;
            else if (result.direct.type === 'sibling') result.generations = 0;
            return;
        }

        if (ancestor) {
            var upperId = ancestor.dA === 0 ? result.a : result.b;
            var lowerId = ancestor.dA === 0 ? result.b : result.a;
            var upper = nameOf(upperId);
            var lower = nameOf(lowerId);
            var gap = ancestor.dA === 0 ? ancestor.dB : ancestor.dA;
            if (gap <= 1) {
                result.headline = upper + ' is ' + lower + "'s parent.";
                result.generations = 1;
            } else if (gap === 2) {
                result.headline = upper + " is " + lower + "'s grandparent.";
                result.generations = 2;
            } else {
                result.headline = upper + " is " + lower + "'s ancestor, " + gap + ' generations apart.';
                result.generations = gap;
            }
            result.detail = 'Recorded through ' + nameOf(ancestor.id) + '.';
            return;
        }

        if (best) {
            var min = Math.min(best.dA, best.dB);
            var removed = Math.abs(best.dA - best.dB);

            if (min === 1 && removed === 0) {
                var kind = result.commons.length > 1 ? 'full siblings' : 'half siblings';
                result.headline = aName + ' and ' + bName + ' are ' + kind + '.';
                result.generations = 0;
                result.detail = 'They share ' + (result.commons.length > 1 ? result.commons.length + ' recorded ancestors' : 'one recorded parent') + '.';
                return;
            }

            if (min === 1) {
                var nearId = best.dA === 1 ? result.a : result.b;
                var farId = best.dA === 1 ? result.b : result.a;
                var near = nameOf(nearId);
                var far = nameOf(farId);
                result.headline = near + " is " + far + "'s aunt or uncle.";
                result.generations = removed;
                if (removed > 1) result.headline = near + " is " + far + "'s aunt or uncle, " + removed + ' generations apart.';
                result.detail = 'Through ' + nameOf(best.id) + '.';
                return;
            }

            var degree = min - 1;
            var phrase = ordinal(degree) + ' cousins';
            if (removed === 1) phrase += ' once removed';
            else if (removed === 2) phrase += ' twice removed';
            else if (removed > 2) phrase += ' ' + removed + ' times removed';
            result.headline = aName + ' and ' + bName + ' are ' + phrase + '.';
            result.generations = removed;
            result.detail = 'Closest shared ancestor: ' + nameOf(best.id) + '.';
            return;
        }

        if (result.connected) {
            result.headline = aName + ' and ' + bName + ' are connected through the links below.';
            result.detail = 'No shared ancestor is recorded for them.';
            return;
        }

        result.headline = 'No connection found in this tree.';
        result.detail = 'There is no chain of links between them yet.';
    }

    function ordinal(n) {
        return ORDINALS[n] || (n + 'th');
    }

    /* ---------------- rendering ---------------- */

    function injectStyles() {
        if (document.getElementById('ft-relations-style')) return;
        var link = document.createElement('link');
        link.id = 'ft-relations-style';
        link.rel = 'stylesheet';
        link.href = '/static/feat-relations.css';
        document.head.appendChild(link);
    }

    function injectMarkup() {
        if (document.getElementById(DIALOG_ID)) return;

        var markup =
            '<dialog id="' + DIALOG_ID + '" class="ft-relations-dialog" aria-labelledby="ftRelTitle">' +
            '  <div class="ft-relations-shell">' +
            '    <div class="ft-relations-head">' +
            '      <h3 id="ftRelTitle" class="ft-relations-title">Find a relation</h3>' +
            '      <button type="button" class="icon-quiet-btn" onclick="ftRelationsClose()" title="Close" aria-label="Close">' +
            '        <svg class="icon" aria-hidden="true"><use href="#i-close"/></svg>' +
            '      </button>' +
            '    </div>' +
            '    <p class="dialog-copy">Pick two people to see how they are connected in this tree.</p>' +
            '    <div class="ft-relations-pickers">' +
            '      <div class="ft-relations-picker">' +
            '        <label class="field-label" for="ftRelSearchA">Person A</label>' +
            '        <div class="ft-relations-search">' +
            '          <svg class="icon ft-relations-search-icon" aria-hidden="true"><use href="#i-search"/></svg>' +
            '          <input id="ftRelSearchA" type="text" autocomplete="off" spellcheck="false" role="combobox"' +
            '                 aria-expanded="false" aria-controls="ftRelListA" aria-autocomplete="list"' +
            '                 placeholder="Search people"' +
            '                 oninput="ftRelationsType(0, this.value)"' +
            '                 onfocus="ftRelationsSearch(0, this.value)"' +
            '                 onblur="ftRelationsBlur(0)"' +
            '                 onkeydown="ftRelationsSearchKey(0, this, event)">' +
            '          <ul id="ftRelListA" class="ft-relations-list" role="listbox" aria-label="People" hidden></ul>' +
            '        </div>' +
            '        <p class="ft-relations-current" id="ftRelCurrentA"></p>' +
            '      </div>' +
            '      <button type="button" class="ft-relations-swap" onclick="ftRelationsSwap()"' +
            '              title="Swap person A and person B" aria-label="Swap person A and person B">' +
            '        <svg class="icon" aria-hidden="true"><use href="#i-refresh"/></svg>' +
            '      </button>' +
            '      <div class="ft-relations-picker">' +
            '        <label class="field-label" for="ftRelSearchB">Person B</label>' +
            '        <div class="ft-relations-search">' +
            '          <svg class="icon ft-relations-search-icon" aria-hidden="true"><use href="#i-search"/></svg>' +
            '          <input id="ftRelSearchB" type="text" autocomplete="off" spellcheck="false" role="combobox"' +
            '                 aria-expanded="false" aria-controls="ftRelListB" aria-autocomplete="list"' +
            '                 placeholder="Search people"' +
            '                 oninput="ftRelationsType(1, this.value)"' +
            '                 onfocus="ftRelationsSearch(1, this.value)"' +
            '                 onblur="ftRelationsBlur(1)"' +
            '                 onkeydown="ftRelationsSearchKey(1, this, event)">' +
            '          <ul id="ftRelListB" class="ft-relations-list" role="listbox" aria-label="People" hidden></ul>' +
            '        </div>' +
            '        <p class="ft-relations-current" id="ftRelCurrentB"></p>' +
            '      </div>' +
            '    </div>' +
            '    <p class="ft-relations-hint" id="ftRelHint" role="status" aria-live="polite"></p>' +
            '    <button type="button" class="btn-primary ft-relations-find" id="ftRelFindBtn" onclick="ftRelationsFind()">' +
            '      <svg class="icon" aria-hidden="true"><use href="#i-relations"/></svg> Find relation' +
            '    </button>' +
            '    <div class="ft-relations-result" id="ftRelResult" aria-live="polite"></div>' +
            '  </div>' +
            '</dialog>';

        var holder = document.createElement('div');
        holder.innerHTML = markup;
        var dialog = holder.firstElementChild;
        if (dialog) document.body.appendChild(dialog);
    }

    function avatarHtml(id) {
        var p = personById(id);
        if (p && p.image_url) {
            return '<img class="ft-relations-avatar" src="' + escapeAttr(p.image_url) + '" alt="">';
        }
        return '<span class="ft-relations-avatar ft-relations-avatar-text" aria-hidden="true">' +
            escapeHtml(initialsOf(p ? p.name : '')) + '</span>';
    }

    function chainHtml(result) {
        var chain = result.chain || [];
        if (!chain.length) return '';

        var parts = chain.map(function (node, index) {
            var isEnd = index === 0 || index === chain.length - 1;
            var tag = index === 0 ? 'A' : (index === chain.length - 1 ? 'B' : '');
            var role = '';
            if (index < chain.length - 1 && node.link) {
                role = roleWord(node.link, node.id) + ' of';
            } else if (index === chain.length - 1 && chain.length > 1 && chain[index - 1].link) {
                role = roleWord(chain[index - 1].link, node.id) + ' of';
            }
            var tagHtml = tag ? '<span class="ft-relations-tag">' + tag + '</span>' : '';
            return '<li class="ft-relations-node' + (isEnd ? ' is-endpoint' : '') + '">' +
                tagHtml +
                avatarHtml(node.id) +
                '<span class="ft-relations-node-name">' + escapeHtml(nameOf(node.id)) + '</span>' +
                (role ? '<span class="ft-relations-node-role">' + escapeHtml(role) + '</span>' : '') +
                '</li>';
        });

        // A chevron between every pair of people.
        var withArrows = [];
        parts.forEach(function (part, index) {
            if (index) {
                withArrows.push('<li class="ft-relations-arrow" aria-hidden="true">' +
                    '<svg class="icon"><use href="#i-chevron-right"/></svg></li>');
            }
            withArrows.push(part);
        });

        return '<div class="panel-section-title">Path</div>' +
            '<ol class="ft-relations-chain">' + withArrows.join('') + '</ol>';
    }

    function ancestorsHtml(result) {
        var names = (result.commons || []).map(function (entry) { return nameOf(entry.id); });
        var value = names.length ? escapeHtml(names.join(', ')) : 'None recorded';
        return '<div class="ft-relations-fact">' +
            '<dt class="ft-relations-fact-label">Shared ancestors</dt>' +
            '<dd class="ft-relations-fact-value">' + value + '</dd>' +
            '</div>';
    }

    function renderResult(result) {
        var box = document.getElementById('ftRelResult');
        if (!box) return;

        if (!result) {
            box.innerHTML = '<div class="ft-relations-empty">Choose two people, then select Find relation.</div>';
            return;
        }

        if (!result.connected) {
            box.innerHTML = '<div class="ft-relations-empty is-error">' +
                '<strong>No connection found in this tree.</strong><br>' +
                escapeHtml(result.detail || '') +
                '</div>';
            return;
        }

        var generations = result.generations;
        var generationsText = '';
        if (generations !== null && generations !== undefined) {
            generationsText = generations === 0
                ? 'Same generation'
                : generations + (generations === 1 ? ' generation apart' : ' generations apart');
        }

        box.innerHTML =
            '<p class="ft-relations-headline">' + escapeHtml(result.headline) + '</p>' +
            (result.detail ? '<p class="ft-relations-detail">' + escapeHtml(result.detail) + '</p>' : '') +
            chainHtml(result) +
            '<dl class="ft-relations-facts">' +
            (generationsText
                ? '<div class="ft-relations-fact"><dt class="ft-relations-fact-label">Generations apart</dt>' +
                  '<dd class="ft-relations-fact-value">' + escapeHtml(generationsText) + '</dd></div>'
                : '') +
            ancestorsHtml(result) +
            '</dl>';
    }

    function renderMessage(text) {
        var box = document.getElementById('ftRelResult');
        if (!box) return;
        box.innerHTML = '<div class="ft-relations-empty is-error">' + escapeHtml(text) + '</div>';
    }

    /* ---------------- picker ---------------- */

    function inputFor(slot) {
        return document.getElementById(slot === 0 ? 'ftRelSearchA' : 'ftRelSearchB');
    }

    function listFor(slot) {
        return document.getElementById(slot === 0 ? 'ftRelListA' : 'ftRelListB');
    }

    function currentLabel(slot) {
        return document.getElementById(slot === 0 ? 'ftRelCurrentA' : 'ftRelCurrentB');
    }

    function setPicked(slot, id) {
        state[slot === 0 ? 'a' : 'b'] = (id === null || id === undefined) ? null : Number(id);
        var input = inputFor(slot);
        if (input) input.value = id === null || id === undefined ? '' : nameOf(id);
        var label = currentLabel(slot);
        if (label) {
            label.textContent = (id === null || id === undefined)
                ? 'Nobody picked yet'
                : 'Picked: ' + nameOf(id);
        }
    }

    function closeList(slot) {
        var list = listFor(slot);
        if (list) list.hidden = true;
        var input = inputFor(slot);
        if (input) {
            input.setAttribute('aria-expanded', 'false');
            input.removeAttribute('aria-activedescendant');
        }
    }

    function closeAllLists() {
        closeList(0);
        closeList(1);
    }

    function searchPeople(slot, value) {
        var query = String(value || '').trim().toLowerCase();
        var other = slot === 0 ? state.b : state.a;
        var list = allPersons().filter(function (p) {
            if (p.id === other) return false;
            if (!query) return true;
            return String(p.name || '').toLowerCase().indexOf(query) !== -1;
        });
        list.sort(function (x, y) { return String(x.name || '').localeCompare(String(y.name || '')); });

        state.hits[slot] = list.slice(0, MAX_HITS);
        state.cursor[slot] = state.hits[slot].length ? 0 : -1;

        var box = listFor(slot);
        var input = inputFor(slot);
        if (!box) return;

        if (!state.hits[slot].length) {
            box.innerHTML = '<li class="ft-relations-empty-option" role="presentation">No one matches that name</li>';
        } else {
            box.innerHTML = state.hits[slot].map(function (p, index) {
                var active = index === state.cursor[slot];
                return '<li role="presentation"><button type="button" id="ftRelOpt' + slot + '-' + index + '"' +
                    ' class="ft-relations-option' + (active ? ' is-active' : '') + '"' +
                    ' role="option" aria-selected="' + (active ? 'true' : 'false') +
                    '" onmousedown="event.preventDefault()" onclick="ftRelationsChoose(' + slot + ', ' + p.id + ')">' +
                    '<span class="ft-relations-option-name">' + escapeHtml(p.name || 'Unnamed person') + '</span>' +
                    '</button></li>';
            }).join('');
        }
        box.hidden = false;
        if (input) {
            input.setAttribute('aria-expanded', 'true');
            if (state.cursor[slot] >= 0) {
                input.setAttribute('aria-activedescendant', 'ftRelOpt' + slot + '-' + state.cursor[slot]);
            } else {
                input.removeAttribute('aria-activedescendant');
            }
        }
    }

    function choosePerson(slot, id) {
        setPicked(slot, id);
        closeList(slot);
        var input = inputFor(slot);
        if (input) input.blur();
        refresh();
        runFind();
    }

    // Typing invalidates the previous pick: the name on screen and the person
    // used for the search must never disagree.
    function typeInSlot(slot, value) {
        state[slot === 0 ? 'a' : 'b'] = null;
        var label = currentLabel(slot);
        if (label) label.textContent = 'Nobody picked yet';
        searchPeople(slot, value);
        refresh();
    }

    function blurSlot(slot) {
        closeList(slot);
        if (state[slot === 0 ? 'a' : 'b'] !== null) return;
        var input = inputFor(slot);
        if (input && input.value) input.value = '';
    }

    function searchKey(slot, input, event) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            var hits = state.hits[slot];
            if (!hits.length) return;
            var delta = event.key === 'ArrowDown' ? 1 : -1;
            state.cursor[slot] = (state.cursor[slot] + delta + hits.length) % hits.length;
            searchPeople(slot, input.value);
            return;
        }
        if (event.key === 'Enter') {
            var hits = state.hits[slot];
            if (hits.length) {
                event.preventDefault();
                choosePerson(slot, hits[Math.max(0, state.cursor[slot])].id);
            }
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeList(slot);
        }
    }

    function swapPeople() {
        var a = state.a;
        setPicked(0, state.b);
        setPicked(1, a);
        closeAllLists();
        refresh();
        runFind();
    }

    /* ---------------- state ---------------- */

    function problemText() {
        var list = allPersons();
        if (list.length < 2) return 'Add at least two people to find a relation.';
        if (state.a !== null && state.b !== null && state.a === state.b) return 'Pick two different people.';
        if (state.a === null || state.b === null) return 'Choose two people to compare.';
        return '';
    }

    function refresh() {
        var hint = document.getElementById('ftRelHint');
        var button = document.getElementById('ftRelFindBtn');
        var problem = problemText();
        if (hint) {
            hint.textContent = problem;
            hint.classList.toggle('is-error', !!problem);
        }
        if (button) button.disabled = !!problem;
    }

    function runFind() {
        var problem = problemText();
        refresh();
        if (problem) {
            renderMessage(problem);
            return;
        }
        try {
            renderResult(analyse(state.a, state.b));
        } catch (err) {
            renderMessage('Could not work out that relation.');
        }
    }

    /* ---------------- entry points ---------------- */

    function openRelationsDialog() {
        try {
            injectStyles();
            injectMarkup();

            var list = allPersons();
            var selected = (typeof selectedNodeId !== 'undefined' && selectedNodeId !== null) ? Number(selectedNodeId) : null;
            var first = list.length ? list[0].id : null;
            var a = (selected !== null && list.some(function (p) { return p.id === selected; })) ? selected : first;
            var other = null;
            list.forEach(function (p) { if (other === null && p.id !== a) other = p.id; });

            setPicked(0, a);
            setPicked(1, other);
            closeAllLists();

            var dialog = document.getElementById(DIALOG_ID);
            if (!dialog) return;
            if (!dialog.open) dialog.showModal();
            refresh();
            runFind();
        } catch (err) {
            showToast('Could not open the relation finder', true);
        }
    }

    function closeDialog() {
        var dialog = document.getElementById(DIALOG_ID);
        if (dialog && dialog.open) dialog.close();
    }

    document.addEventListener('click', function (event) {
        if (!event.target.closest('.ft-relations-search')) closeAllLists();
    });

    window.openRelationsDialog = openRelationsDialog;
    window.ftRelationsFind = runFind;
    window.ftRelationsSwap = swapPeople;
    window.ftRelationsChoose = choosePerson;
    window.ftRelationsSearch = searchPeople;
    window.ftRelationsType = typeInSlot;
    window.ftRelationsBlur = blurSlot;
    window.ftRelationsSearchKey = searchKey;
    window.ftRelationsClose = closeDialog;

    function init() {
        injectStyles();
        injectMarkup();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
