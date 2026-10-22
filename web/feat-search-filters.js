// Feature module: search filters.
//
// The search matches one string. This narrows the hits down: who is living,
// who has a photo, who was born in a decade, and who belongs to the branch
// of the tree around the person you selected.

(function () {
    'use strict';

    var FT = window.FT;
    var STORAGE_KEY = 'familytree.searchFilters';
    var dialog = null;

    var state = { status: 'any', photo: 'any', decade: '', generation: 'any' };

    // --- the tree, as the search needs it ---

    function parentChild(rel) {
        var relation = String(rel.relation || '').toLowerCase();
        if (relation === 'child-of' || relation === 'child_of' || relation === 'son' || relation === 'daughter') {
            return { parent: rel.person2_id, child: rel.person1_id };
        }
        if (relation === 'child' || relation.indexOf('child-') === 0 ||
            relation === 'father' || relation === 'mother' || relation === 'parent' ||
            relation === 'parent-of' || relation === 'parent_of' ||
            relation === 'father-of' || relation === 'mother-of') {
            return { parent: rel.person1_id, child: rel.person2_id };
        }
        return null;
    }

    function relatives(direction) {
        var wanted = direction === 'ancestors' ? 'parent' : 'child';
        var start = FT.selectedId();
        var found = new Set();
        if (start === null || start === undefined) return found;

        var queue = [start];
        while (queue.length) {
            var id = queue.shift();
            FT.relations().forEach(function (rel) {
                var edge = parentChild(rel);
                if (!edge) return;
                var other = edge[wanted];
                var mine = edge[wanted === 'parent' ? 'child' : 'parent'];
                if (mine !== id) return;
                if (found.has(other)) return;
                found.add(other);
                queue.push(other);
            });
        }
        return found;
    }

    function birthYear(person) {
        var value = String(person.dob || '').trim();
        if (value.length < 4) return null;
        var year = Number(value.slice(0, 4));
        return isNaN(year) ? null : year;
    }

    function decades() {
        var seen = {};
        FT.people().forEach(function (person) {
            var year = birthYear(person);
            if (year === null) return;
            seen[Math.floor(year / 10) * 10] = true;
        });
        return Object.keys(seen).map(Number).sort(function (a, b) { return b - a; });
    }

    function active() {
        return state.status !== 'any' || state.photo !== 'any' || state.decade !== '' || state.generation !== 'any';
    }

    // The app calls this for every search hit.
    window.searchHitAllowed = function (person) {
        if (!active()) return true;
        if (state.status === 'living' && person.dod) return false;
        if (state.status === 'deceased' && !person.dod) return false;
        if (state.photo === 'with' && !person.image_url) return false;
        if (state.photo === 'without' && person.image_url) return false;
        if (state.decade !== '') {
            var year = birthYear(person);
            if (year === null || year < state.decade || year >= state.decade + 10) return false;
        }
        if (state.generation !== 'any') {
            if (!relatives(state.generation).has(person.id)) return false;
        }
        return true;
    };

    // --- the button and the popover ---

    function save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (err) { /* the browser may refuse to store it */ }
    }

    function load() {
        try {
            var stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            if (stored.status) state.status = stored.status;
            if (stored.photo) state.photo = stored.photo;
            if (typeof stored.decade === 'number' || stored.decade === '') state.decade = stored.decade;
            if (stored.generation) state.generation = stored.generation;
        } catch (err) { /* fall back to the defaults */ }
        if (['any', 'living', 'deceased'].indexOf(state.status) < 0) state.status = 'any';
        if (['any', 'with', 'without'].indexOf(state.photo) < 0) state.photo = 'any';
        if (['any', 'ancestors', 'descendants'].indexOf(state.generation) < 0) state.generation = 'any';
    }

    function refresh() {
        var button = document.getElementById('ftSearchFiltersBtn');
        if (!button) return;
        var count = ['status', 'photo', 'decade', 'generation'].filter(function (key) {
            return state[key] !== 'any' && state[key] !== '';
        }).length;
        button.classList.toggle('active', count > 0);
        button.setAttribute('aria-label', count ? 'Filters, ' + count + ' active' : 'Filters');
        var dot = button.querySelector('.ft-filter-dot');
        if (dot) dot.hidden = count === 0;
    }

    function rerun() {
        if (typeof renderSearchResults === 'function') renderSearchResults();
    }

    function render() {
        var body = FT.body(dialog);
        var decadeOptions = ['<option value="">Any decade</option>'].concat(decades().map(function (decade) {
            return '<option value="' + decade + '"' + (String(state.decade) === String(decade) ? ' selected' : '') + '>' +
                decade + 's</option>';
        })).join('');

        var hasSelection = FT.selectedId() !== null && FT.selectedId() !== undefined;

        body.innerHTML =
            '<label class="field-label" for="ftFilterStatus">Status</label>' +
            '<select id="ftFilterStatus">' +
            '  <option value="any"' + (state.status === 'any' ? ' selected' : '') + '>Anyone</option>' +
            '  <option value="living"' + (state.status === 'living' ? ' selected' : '') + '>Living</option>' +
            '  <option value="deceased"' + (state.status === 'deceased' ? ' selected' : '') + '>Deceased</option>' +
            '</select>' +
            '<label class="field-label" for="ftFilterPhoto">Photo</label>' +
            '<select id="ftFilterPhoto">' +
            '  <option value="any"' + (state.photo === 'any' ? ' selected' : '') + '>Anyone</option>' +
            '  <option value="with"' + (state.photo === 'with' ? ' selected' : '') + '>With a photo</option>' +
            '  <option value="without"' + (state.photo === 'without' ? ' selected' : '') + '>Without a photo</option>' +
            '</select>' +
            '<label class="field-label" for="ftFilterDecade">Born in</label>' +
            '<select id="ftFilterDecade">' + decadeOptions + '</select>' +
            '<label class="field-label" for="ftFilterGeneration">Related to the selected person</label>' +
            '<select id="ftFilterGeneration"' + (hasSelection ? '' : ' disabled') + '>' +
            '  <option value="any"' + (state.generation === 'any' ? ' selected' : '') + '>Anyone</option>' +
            '  <option value="ancestors"' + (state.generation === 'ancestors' ? ' selected' : '') + '>Ancestors</option>' +
            '  <option value="descendants"' + (state.generation === 'descendants' ? ' selected' : '') + '>Descendants</option>' +
            '</select>' +
            (hasSelection ? '' : '<p class="ft-panel-empty">Select a person on the tree to filter by their branch.</p>') +
            '<p class="ft-panel-empty" id="ftFilterCount"></p>';

        function countMatches() {
            var total = FT.people().length;
            var shown = FT.people().filter(function (person) { return window.searchHitAllowed(person); }).length;
            var element = document.getElementById('ftFilterCount');
            if (element) element.textContent = 'Showing ' + shown + ' of ' + total + ' people.';
        }
        countMatches();

        ['ftFilterStatus', 'ftFilterPhoto', 'ftFilterDecade', 'ftFilterGeneration'].forEach(function (id) {
            var select = document.getElementById(id);
            if (!select) return;
            select.addEventListener('change', function () {
                state.status = document.getElementById('ftFilterStatus').value;
                state.photo = document.getElementById('ftFilterPhoto').value;
                state.decade = document.getElementById('ftFilterDecade').value;
                state.decade = state.decade === '' ? '' : Number(state.decade);
                state.generation = document.getElementById('ftFilterGeneration').value;
                save();
                refresh();
                countMatches();
                rerun();
            });
        });
    }

    function openDialog() {
        dialog = FT.dialog({
            id: 'ftFiltersDialog',
            className: 'ft-filters-dialog',
            title: 'Search filters',
            copy: 'Narrow the search down while you type.'
        });
        if (!dialog) return;
        if (!document.getElementById('ftFiltersActions')) {
            FT.action(dialog, 'Clear all', 'btn-secondary', function () {
                state = { status: 'any', photo: 'any', decade: '', generation: 'any' };
                save();
                refresh();
                render();
                rerun();
            });
            FT.action(dialog, 'Done', 'btn-primary', function () { FT.close(dialog); });
        }
        FT.open(dialog);
        render();
    }

    function mount() {
        FT.ensureStylesheet('/static/feat-search-filters.css');
        load();

        var box = document.querySelector('.search-box');
        if (box && !document.getElementById('ftSearchFiltersBtn')) {
            var button = document.createElement('button');
            button.id = 'ftSearchFiltersBtn';
            button.type = 'button';
            button.className = 'ft-filter-btn';
            button.title = 'Filters';
            button.setAttribute('aria-label', 'Filters');
            button.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-legend"/></svg>' +
                '<span class="ft-filter-dot" hidden aria-hidden="true"></span>';
            button.addEventListener('click', openDialog);
            box.appendChild(button);
        }
        refresh();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
})();
