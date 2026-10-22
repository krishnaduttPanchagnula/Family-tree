// Feature module: sources and citations.
//
// A family history is only as good as the evidence behind it, so every person
// gets a list of sources: a census, a certificate, a photograph, a story
// somebody remembered. The evidence stays on this machine.

(function () {
    'use strict';

    var FT = window.FT;

    var KINDS = [
        { value: 'census', label: 'Census' },
        { value: 'birth', label: 'Birth certificate' },
        { value: 'death', label: 'Death certificate' },
        { value: 'marriage', label: 'Marriage record' },
        { value: 'cemetery', label: 'Grave or memorial' },
        { value: 'photo', label: 'Photograph' },
        { value: 'interview', label: 'Interview' },
        { value: 'memory', label: 'Memory of a relative' },
        { value: 'story', label: 'Story' },
        { value: 'other', label: 'Other' }
    ];

    var editing = null;   // the source being edited, or null for a new one
    var panel = null;

    function kindLabel(value) {
        for (var i = 0; i < KINDS.length; i++) {
            if (KINDS[i].value === value) return KINDS[i].label;
        }
        return 'Source';
    }

    function kindOptions(selected) {
        return KINDS.map(function (kind) {
            return '<option value="' + kind.value + '"' + (kind.value === selected ? ' selected' : '') + '>' +
                FT.esc(kind.label) + '</option>';
        }).join('');
    }

    function sourceRow(source) {
        var actions = FT.readOnly() ? '' :
            '<span class="ft-source-actions">' +
            '  <button type="button" class="ft-link-btn" data-action="edit" data-id="' + source.id + '">Edit</button>' +
            '  <button type="button" class="ft-link-btn ft-danger-link" data-action="delete" data-id="' + source.id + '">Delete</button>' +
            '</span>';

        var link = source.url ? '<a class="ft-source-link" href="' + FT.esc(source.url) + '" target="_blank" rel="noopener noreferrer">Open source</a>' : '';

        return '<li class="ft-source">' +
            '<div class="ft-source-head">' +
            '  <span class="ft-source-kind">' + FT.esc(kindLabel(source.kind)) + '</span>' +
            '  <span class="ft-source-title">' + FT.esc(source.title || 'Untitled source') + '</span>' +
            '</div>' +
            (source.citation ? '<p class="ft-source-citation">' + FT.esc(source.citation) + '</p>' : '') +
            '<p class="ft-source-meta">' +
            (source.date ? FT.esc(source.date) : '') +
            (source.date && link ? ' · ' : '') + link +
            (source.note ? '<br>' + FT.esc(source.note) : '') +
            '</p>' +
            actions +
            '</li>';
    }

    function formMarkup(source) {
        source = source || { kind: 'census', title: '', citation: '', url: '', date: '', note: '' };
        return '<div class="ft-source-form">' +
            '  <label class="field-label" for="ftSourceKind">Kind</label>' +
            '  <select id="ftSourceKind">' + kindOptions(source.kind) + '</select>' +
            '  <label class="field-label" for="ftSourceTitle">Title</label>' +
            '  <input type="text" id="ftSourceTitle" placeholder="e.g. 1901 census, Leeds" value="' + FT.esc(source.title) + '">' +
            '  <label class="field-label" for="ftSourceCitation">Citation</label>' +
            '  <textarea id="ftSourceCitation" rows="3" placeholder="Where the evidence is held">' + FT.esc(source.citation) + '</textarea>' +
            '  <div class="field-row">' +
            '    <div class="field-col">' +
            '      <label class="field-label" for="ftSourceDate">Date</label>' +
            '      <input type="text" id="ftSourceDate" placeholder="e.g. 1901" value="' + FT.esc(source.date) + '">' +
            '    </div>' +
            '    <div class="field-col">' +
            '      <label class="field-label" for="ftSourceUrl">Link</label>' +
            '      <input type="url" id="ftSourceUrl" placeholder="https://" value="' + FT.esc(source.url) + '">' +
            '    </div>' +
            '  </div>' +
            '  <label class="field-label" for="ftSourceNote">Note</label>' +
            '  <textarea id="ftSourceNote" rows="2" placeholder="Anything worth remembering about it">' + FT.esc(source.note) + '</textarea>' +
            '  <div class="ft-source-form-actions">' +
            '    <button type="button" class="btn-primary" id="ftSourceSave">Save source</button>' +
            '    <button type="button" class="btn-secondary" id="ftSourceCancel">Cancel</button>' +
            '  </div>' +
            '</div>';
    }

    function renderList(person, sources) {
        var html = '';
        if (sources.length) {
            html = '<ul class="ft-source-list">' + sources.map(sourceRow).join('') + '</ul>';
        } else {
            html = '<p class="ft-panel-empty">No sources yet. A source is the evidence behind a fact: ' +
                'a census, a certificate, a photograph, or a story somebody remembered.</p>';
        }
        if (!FT.readOnly()) {
            html += '<button type="button" class="btn-outline full" id="ftSourceAdd">' +
                '<svg class="icon" aria-hidden="true"><use href="#i-plus"/></svg> Add a source</button>';
        }
        panel.innerHTML = '<div id="ftSourcesHost">' + html + '</div>';
    }

    function showForm(person, source) {
        var host = document.getElementById('ftSourcesHost');
        if (!host) return;
        editing = source || null;
        host.innerHTML = formMarkup(source) +
            '<button type="button" class="btn-outline full" id="ftSourceBack">Back to the list</button>';

        document.getElementById('ftSourceSave').addEventListener('click', function () { save(person); });
        document.getElementById('ftSourceCancel').addEventListener('click', function () { load(person); });
        document.getElementById('ftSourceBack').addEventListener('click', function () { load(person); });
    }

    async function load(person) {
        try {
            var sources = await FT.api('/api/sources?person_id=' + person.id) || [];
            renderList(person, sources);
        } catch (err) {
            panel.innerHTML = '<p class="ft-panel-error" role="alert">Could not load the sources: ' + FT.esc(err.message) + '</p>';
        }
    }

    async function save(person) {
        var payload = {
            kind: document.getElementById('ftSourceKind').value,
            title: document.getElementById('ftSourceTitle').value,
            citation: document.getElementById('ftSourceCitation').value,
            url: document.getElementById('ftSourceUrl').value,
            date: document.getElementById('ftSourceDate').value,
            note: document.getElementById('ftSourceNote').value
        };
        try {
            if (editing) {
                await FT.json('/api/sources/' + editing.id, 'PATCH', payload);
                FT.toast('Source saved');
            } else {
                payload.person_id = person.id;
                await FT.json('/api/sources', 'POST', payload);
                FT.toast('Source added');
            }
            editing = null;
            await load(person);
        } catch (err) {
            FT.toast('Could not save the source: ' + err.message, true);
        }
    }

    async function remove(person, id) {
        var ok = await FT.confirm({
            title: 'Delete this source?',
            message: 'The citation will be gone. The person and the rest of the tree stay as they are.',
            confirmLabel: 'Delete source'
        });
        if (!ok) return;
        try {
            await FT.json('/api/sources/' + id, 'DELETE');
            FT.toast('Source deleted');
            await load(person);
        } catch (err) {
            FT.toast('Could not delete the source: ' + err.message, true);
        }
    }

    function mount() {
        FT.ensureStylesheet('/static/feat-sources.css');
        panel = FT.addTab('sources', 'Sources');
        if (!panel) return;
        panel.id = 'ftSourcesPanel';

        panel.addEventListener('click', function (event) {
            var button = event.target.closest('button');
            if (!button) return;
            var person = FT.people().find(function (p) { return p.id === FT.selectedId(); });
            if (!person) return;

            if (button.id === 'ftSourceAdd') {
                showForm(person, null);
                return;
            }
            if (button.dataset.action === 'edit') {
                var id = Number(button.dataset.id);
                FT.api('/api/sources?person_id=' + person.id).then(function (sources) {
                    var source = (sources || []).find(function (s) { return s.id === id; });
                    if (source) showForm(person, source);
                });
                return;
            }
            if (button.dataset.action === 'delete') {
                remove(person, Number(button.dataset.id));
            }
        });

        FT.onPanel(function (person) {
            editing = null;
            load(person);
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
})();
