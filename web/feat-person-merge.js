// Feature module: merging two people.
//
// Duplicates happen. Merging is the repair, and it is destructive, so it is
// previewed field by field, confirmed by typing a name, and preceded by a
// snapshot on the server.

(function () {
    'use strict';

    var FT = window.FT;

    var FIELDS = [
        { key: 'name', label: 'Name' },
        { key: 'dob', label: 'Date of birth' },
        { key: 'dod', label: 'Date of death' },
        { key: 'birth_country', label: 'Place of birth' },
        { key: 'profession', label: 'Profession' },
        { key: 'facts', label: 'Interesting facts' },
        { key: 'image_url', label: 'Photo', photo: true }
    ];

    var state = { survivor: null, other: null, choices: {} };
    var dialog = null;

    function value(person, key) {
        if (key === 'image_url') return person.image_url ? 'Photo set' : 'No photo';
        return person[key] || '';
    }

    // The default is the rule the server applies: an explicit choice wins,
    // then the survivor's own value, then the other person's.
    function defaultChoice(key) {
        var mine = value(state.survivor, key);
        var theirs = value(state.other, key);
        if (mine) return 'survivor';
        if (theirs) return 'other';
        return 'survivor';
    }

    function peopleList(filter) {
        var query = (filter || '').trim().toLowerCase();
        return FT.people().filter(function (person) {
            if (state.survivor && person.id === state.survivor.id) return false;
            if (!query) return true;
            return String(person.name || '').toLowerCase().indexOf(query) >= 0;
        }).slice(0, 40);
    }

    function renderChooser() {
        var body = FT.body(dialog);
        body.innerHTML =
            '<label class="field-label" for="ftMergeSearch">Who is the other person?</label>' +
            '<input type="search" id="ftMergeSearch" placeholder="Search by name" autocomplete="off">' +
            '<ul class="ft-merge-list" id="ftMergeList"></ul>';

        var list = document.getElementById('ftMergeList');
        var search = document.getElementById('ftMergeSearch');

        function fill() {
            var people = peopleList(search.value);
            if (!people.length) {
                list.innerHTML = '<li class="ft-merge-empty">Nobody matches that name.</li>';
                return;
            }
            list.innerHTML = people.map(function (person) {
                return '<li><button type="button" class="ft-merge-person" data-id="' + person.id + '">' +
                    '<span class="ft-merge-name">' + FT.esc(person.name) + '</span>' +
                    '<span class="ft-merge-meta">' + FT.esc([person.dob, person.birth_country].filter(Boolean).join(' · ')) + '</span>' +
                    '</button></li>';
            }).join('');
        }

        search.addEventListener('input', fill);
        list.addEventListener('click', function (event) {
            var button = event.target.closest('.ft-merge-person');
            if (!button) return;
            state.other = FT.people().find(function (p) { return p.id === Number(button.dataset.id); });
            if (state.other) renderReview();
        });
        fill();
        search.focus();
    }

    function renderReview() {
        var body = FT.body(dialog);
        var counts = {
            relations: FT.relations().filter(function (rel) {
                return rel.person1_id === state.other.id || rel.person2_id === state.other.id;
            }).length
        };

        body.innerHTML =
            '<p class="ft-merge-summary">Merging <strong>' + FT.esc(state.other.name) + '</strong> into <strong>' +
            FT.esc(state.survivor.name) + '</strong>. ' + counts.relations + ' connection(s) move across, and ' +
            FT.esc(state.other.name) + ' is deleted. A snapshot is written first, so this can be restored.</p>' +
            '<table class="ft-merge-table"><thead><tr><th>Field</th><th>Keep</th></tr></thead><tbody>' +
            FIELDS.map(function (field) {
                var choice = state.choices[field.key] || defaultChoice(field.key);
                var mine = value(state.survivor, field.key);
                var theirs = value(state.other, field.key);
                var mineLabel = mine || 'empty';
                var theirLabel = theirs || 'empty';
                return '<tr>' +
                    '<th scope="row">' + FT.esc(field.label) + '</th>' +
                    '<td class="ft-merge-values">' +
                    '  <label class="ft-merge-choice"><input type="radio" name="ft-merge-field-' + field.key + '" value="survivor"' +
                    (choice === 'survivor' ? ' checked' : '') + '> ' + FT.esc(mineLabel) + '</label>' +
                    '  <label class="ft-merge-choice"><input type="radio" name="ft-merge-field-' + field.key + '" value="other"' +
                    (choice === 'other' ? ' checked' : '') + '> ' + FT.esc(theirLabel) + '</label>' +
                    '</td>' +
                    '</tr>';
            }).join('') +
            '</tbody></table>' +
            '<label class="field-label" for="ftMergeConfirm">Type <strong>' + FT.esc(state.other.name) +
            '</strong> to confirm</label>' +
            '<input type="text" id="ftMergeConfirm" autocomplete="off">';

        body.addEventListener('change', function (event) {
            var input = event.target.closest('input[type="radio"]');
            if (!input) return;
            var key = input.name.replace('ft-merge-field-', '');
            state.choices[key] = input.value;
        });
    }

    async function merge() {
        var confirmation = document.getElementById('ftMergeConfirm');
        if (!confirmation || confirmation.value.trim() !== state.other.name) {
            FT.toast('Type the name of the person being merged to confirm', true);
            return;
        }

        var fields = {};
        FIELDS.forEach(function (field) {
            var choice = state.choices[field.key] || defaultChoice(field.key);
            fields[field.key] = choice === 'other' ? value(state.other, field.key) : value(state.survivor, field.key);
        });

        try {
            var result = await FT.json('/api/persons/merge', 'POST', {
                survivor_id: state.survivor.id,
                other_id: state.other.id,
                fields: fields
            });
            FT.close(dialog);
            state = { survivor: null, other: null, choices: {} };
            await FT.reload();
            FT.toast('Merged. A snapshot was saved as ' + (result && result.snapshot ? result.snapshot : 'a snapshot'));
        } catch (err) {
            FT.toast('Could not merge: ' + err.message, true);
        }
    }

    function openDialog(survivorId, otherId) {
        dialog = FT.dialog({
            id: 'ftMergeDialog',
            className: 'ft-merge-dialog',
            title: 'Merge two people',
            copy: 'One person can have two records. Merging keeps one of them and moves everything else across.'
        });
        if (!dialog) return;

        FT.resetActions(dialog);
        FT.action(dialog, 'Cancel', 'btn-secondary', function () { FT.close(dialog); });
        FT.action(dialog, 'Merge the two people', 'btn-primary', merge);

        state.survivor = FT.people().find(function (p) { return p.id === survivorId; }) || null;
        state.other = otherId ? FT.people().find(function (p) { return p.id === otherId; }) : null;
        state.choices = {};
        if (!state.survivor) {
            FT.toast('Select a person first', true);
            return;
        }

        FT.open(dialog);
        if (state.other) renderReview();
        else renderChooser();
    }

    function mount() {
        FT.ensureStylesheet('/static/feat-person-merge.css');

        // The button lives in the Family tab, with the other family actions.
        var relationsPanel = document.querySelector('.tab-panel[data-panel="relations"]');
        if (relationsPanel) {
            var host = document.createElement('div');
            host.id = 'ftMergeHost';
            relationsPanel.appendChild(host);
            host.innerHTML = '<button type="button" class="btn-outline full" id="ftMergeBtn">' +
                '<svg class="icon" aria-hidden="true"><use href="#i-users"/></svg> Merge with another person…</button>';
            host.addEventListener('click', function () {
                if (FT.readOnly()) {
                    FT.toast('This tree is shared read-only', true);
                    return;
                }
                openDialog(FT.selectedId());
            });
        }

        window.openMergeDialog = openDialog;
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
})();
