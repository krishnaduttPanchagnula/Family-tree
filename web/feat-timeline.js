/* ============================================================
   Family Tree Builder - life-event timeline
   Renders the sidebar "Events" panel (a person's own timeline)
   and the family-wide timeline dialog.
   ============================================================ */
(function () {
    'use strict';

    var KINDS = [
        { value: 'birth', label: 'Birth' },
        { value: 'death', label: 'Death' },
        { value: 'marriage', label: 'Marriage' },
        { value: 'divorce', label: 'Divorce' },
        { value: 'residence', label: 'Residence' },
        { value: 'education', label: 'Education' },
        { value: 'occupation', label: 'Occupation' },
        { value: 'immigration', label: 'Immigration' },
        { value: 'other', label: 'Other' }
    ];

    var formOpen = false;      // the "add event" form is showing
    var editingId = null;      // the event currently being edited
    var lastPersonId = null;   // the person the panel was last drawn for
    var personSeen = false;    // has the panel ever been drawn?
    var kindFilter = {};       // kind -> false when switched off
    var textFilter = '';

    // --- small helpers -------------------------------------------------
    function icon(name) {
        return '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
    }

    function escText(value) {
        if (typeof window.escapeHtml === 'function') return window.escapeHtml(value == null ? '' : value);
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function escAttr(value) {
        if (typeof window.escapeAttr === 'function') return window.escapeAttr(value == null ? '' : value);
        return escText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function errorText(err) {
        if (!err) return 'Unknown error';
        return String(err.message || err).trim() || 'Unknown error';
    }

    function notify(message, isError) {
        if (typeof window.showToast === 'function') window.showToast(message, !!isError);
    }

    function confirmWith(options) {
        if (typeof window.showConfirm !== 'function') return Promise.resolve(false);
        return Promise.resolve(window.showConfirm(options)).catch(function () { return false; });
    }

    // currentPersons / currentEvents / selectedNodeId are top-level `let`s in
    // app.js, so they live in the global lexical scope rather than on window.
    function personList() {
        try { return currentPersons || []; } catch (err) { return []; }
    }

    function eventList() {
        try { return Array.isArray(currentEvents) ? currentEvents : []; } catch (err) { return []; }
    }

    function selectedId() {
        try { return selectedNodeId; } catch (err) { return null; }
    }

    function findPersonSafe(id) {
        var wanted = Number(id);
        var list = personList();
        for (var i = 0; i < list.length; i++) {
            if (Number(list[i].id) === wanted) return list[i];
        }
        return null;
    }

    function selectedPerson() {
        var id = selectedId();
        if (id === null || id === undefined) return null;
        return findPersonSafe(id);
    }

    function normKind(value) {
        var raw = String(value == null ? '' : value).trim().toLowerCase();
        for (var i = 0; i < KINDS.length; i++) {
            if (KINDS[i].value === raw) return raw;
        }
        return 'other';
    }

    function kindLabel(value) {
        var raw = normKind(value);
        for (var i = 0; i < KINDS.length; i++) {
            if (KINDS[i].value === raw) return KINDS[i].label;
        }
        return 'Other';
    }

    // --- dates ---------------------------------------------------------
    // Dates are free-form ("1946-03-11", "Spring 1946", ""). We pull out
    // whatever year we can so the timeline can be grouped and sorted.
    function parseEventDate(value) {
        var text = String(value == null ? '' : value).trim();
        if (!text) return null;

        var iso = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(text);
        if (iso) {
            var year = Number(iso[1]);
            var month = iso[2] ? Number(iso[2]) : 0;
            var day = iso[3] ? Number(iso[3]) : 0;
            return { year: year, sort: year * 10000 + month * 100 + day };
        }

        var loose = /(\d{4})/.exec(text);
        if (loose) {
            var found = Number(loose[1]);
            return { year: found, sort: found * 10000 };
        }
        return null;
    }

    function displayDate(value) {
        var text = String(value == null ? '' : value).trim();
        if (!text) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(text) && typeof window.formatDate === 'function') {
            try { return window.formatDate(text) || text; } catch (err) { return text; }
        }
        return text;
    }

    function compareEvents(a, b) {
        var ka = parseEventDate(a.date);
        var kb = parseEventDate(b.date);
        var sa = ka ? ka.sort : Infinity;
        var sb = kb ? kb.sort : Infinity;
        if (sa !== sb) return sa - sb;
        return Number(a.id || 0) - Number(b.id || 0);
    }

    function generationLabel(personId) {
        if (typeof window.computeGenerations !== 'function') return '';
        var map;
        try { map = window.computeGenerations(); } catch (err) { return ''; }
        if (!map || typeof map.get !== 'function') return '';
        var depth = map.get(Number(personId));
        if (depth === null || depth === undefined) return '';
        return 'Generation ' + (Number(depth) + 1);
    }

    // --- data ----------------------------------------------------------
    async function refreshEvents() {
        try {
            if (typeof window.loadEvents === 'function') {
                await window.loadEvents();
                return;
            }
            var res = await fetch('/api/events');
            if (!res.ok) throw new Error(await res.text());
            var data = await res.json();
            try { currentEvents = data || []; } catch (err) { /* app.js not loaded */ }
        } catch (err) {
            notify('Could not load events: ' + errorText(err), true);
        }
    }

    function personEvents(personId) {
        return eventList()
            .filter(function (ev) { return Number(ev.person_id) === Number(personId); })
            .sort(compareEvents);
    }

    // The person's own birth/death live on the person record. Show them as
    // read-only entries unless a matching event already covers them.
    function derivedEntries(person, stored) {
        var out = [];
        if (!person) return out;
        var hasBirth = stored.some(function (ev) { return normKind(ev.kind) === 'birth'; });
        var hasDeath = stored.some(function (ev) { return normKind(ev.kind) === 'death'; });

        if (person.dob && !hasBirth) {
            out.push({
                kind: 'birth', date: person.dob, place: person.birth_country || '',
                title: '', note: '', readOnly: true
            });
        }
        if (person.dod && !hasDeath) {
            out.push({ kind: 'death', date: person.dod, place: '', title: '', note: '', readOnly: true });
        }
        return out;
    }

    // --- panel markup --------------------------------------------------
    function panelHost() {
        var host = document.getElementById('eventsPanel');
        if (host) return host;

        var tab = document.querySelector('.tab-panel[data-panel="events"]');
        if (tab) return tab;

        var sidebar = document.querySelector('.sidebar-content');
        if (!sidebar) return null;
        var created = document.createElement('div');
        created.id = 'eventsPanel';
        sidebar.appendChild(created);
        return created;
    }

    function entryMarkup(entry) {
        var kind = normKind(entry.kind);
        var dateText = displayDate(entry.date);
        var actions = entry.readOnly
            ? '<span class="ft-tl-readonly">From the personal record</span>'
            : '<span class="ft-tl-actions">' +
                '<button type="button" class="ft-tl-mini" data-ft-action="edit-event" data-id="' + escAttr(entry.id) + '">Edit</button>' +
                '<button type="button" class="ft-tl-mini ft-tl-mini-danger" data-ft-action="delete-event" data-id="' + escAttr(entry.id) + '">' +
                    icon('trash') + 'Delete</button>' +
              '</span>';

        return '' +
            '<li class="ft-tl-entry" data-kind="' + escAttr(kind) + '">' +
                '<span class="ft-tl-marker" aria-hidden="true"></span>' +
                '<div class="ft-tl-entry-head">' +
                    '<span class="ft-tl-kind">' + escText(kindLabel(kind)) + '</span>' +
                    (dateText ? '<span class="ft-tl-date">' + escText(dateText) + '</span>' : '') +
                    actions +
                '</div>' +
                (entry.title ? '<p class="ft-tl-title">' + escText(entry.title) + '</p>' : '') +
                (entry.place ? '<p class="ft-tl-place">' + escText(entry.place) + '</p>' : '') +
                (entry.note ? '<p class="ft-tl-note">' + escText(entry.note) + '</p>' : '') +
            '</li>';
    }

    function formMarkup(values) {
        var v = values || {};
        var options = KINDS.map(function (k) {
            var selected = k.value === normKind(v.kind) ? ' selected' : '';
            return '<option value="' + escAttr(k.value) + '"' + selected + '>' + escText(k.label) + '</option>';
        }).join('');

        return '' +
            '<form class="ft-tl-form" data-ft-form="event">' +
                (v.id ? '<input type="hidden" name="id" value="' + escAttr(v.id) + '">' : '') +
                '<label class="field-label" for="ftEvKind">Kind</label>' +
                '<select id="ftEvKind" name="kind">' + options + '</select>' +
                '<label class="field-label" for="ftEvDate">Date</label>' +
                '<input type="text" id="ftEvDate" name="date" value="' + escAttr(v.date || '') + '" placeholder="1946-03-11 or Spring 1946" autocomplete="off">' +
                '<label class="field-label" for="ftEvPlace">Place</label>' +
                '<input type="text" id="ftEvPlace" name="place" value="' + escAttr(v.place || '') + '" placeholder="Dublin, Ireland" autocomplete="off">' +
                '<label class="field-label" for="ftEvTitle">Title</label>' +
                '<input type="text" id="ftEvTitle" name="title" value="' + escAttr(v.title || '') + '" placeholder="Married to Mary" autocomplete="off">' +
                '<label class="field-label" for="ftEvNote">Note</label>' +
                '<textarea id="ftEvNote" name="note" rows="3" placeholder="Anything worth remembering">' + escText(v.note || '') + '</textarea>' +
                '<div class="dialog-actions">' +
                    '<button type="submit" class="btn-primary">' + escText(v.id ? 'Save changes' : 'Add event') + '</button>' +
                    '<button type="button" class="btn-secondary" data-ft-action="cancel-form">Cancel</button>' +
                '</div>' +
            '</form>';
    }

    // The panel always belongs to one person. When that person changes the
    // form resets, and someone with no events yet gets the add form open.
    function syncFormState(person, stored) {
        var id = person ? person.id : null;
        if (personSeen && id === lastPersonId) return;
        personSeen = true;
        lastPersonId = id;
        editingId = null;
        formOpen = !!person && stored.length === 0;
    }

    function renderEventsPanel() {
        var host = panelHost();
        if (!host) return;

        var person = selectedPerson();
        var stored = person ? personEvents(person.id) : [];
        var derived = derivedEntries(person, stored);
        var entries = stored.concat(derived).sort(compareEvents);

        syncFormState(person, stored);

        var html = '' +
            '<div class="ft-tl-panel">' +
                '<div class="ft-tl-panel-head">' +
                    '<h3 class="ft-tl-heading">Life events</h3>' +
                    '<div class="ft-tl-panel-actions">' +
                        '<button type="button" class="ft-tl-btn ft-tl-btn-ghost" data-ft-action="open-family-timeline">' +
                            icon('history') + ' Family timeline</button>' +
                        (person
                            ? '<button type="button" class="ft-tl-btn ft-tl-btn-primary" data-ft-action="toggle-add-form">' +
                                icon(formOpen ? 'close' : 'plus') + (formOpen ? ' Close form' : ' Add event') + '</button>'
                            : '') +
                    '</div>' +
                '</div>';

        if (!person) {
            html += '<p class="ft-tl-empty">Select a person to see their timeline.</p>';
            host.innerHTML = html;
            return;
        }

        if (!stored.length) {
            html += '<p class="ft-tl-empty">No events yet — add the first one.</p>';
        }

        if (formOpen) {
            html += '<div class="ft-tl-form-wrap">' + formMarkup({ kind: 'other' }) + '</div>';
        }

        html += '<ul class="ft-tl-list">';
        entries.forEach(function (entry) {
            if (editingId !== null && Number(entry.id) === editingId) {
                html += '<li class="ft-tl-entry ft-tl-entry-editing" data-kind="' + escAttr(normKind(entry.kind)) + '">' +
                    '<span class="ft-tl-marker" aria-hidden="true"></span>' +
                    formMarkup({
                        id: entry.id, kind: entry.kind, date: entry.date,
                        place: entry.place, title: entry.title, note: entry.note
                    }) +
                    '</li>';
                return;
            }
            html += entryMarkup(entry);
        });
        html += '</ul>';

        host.innerHTML = html;
    }

    // --- family timeline dialog ---------------------------------------
    function injectDialog() {
        if (document.getElementById('ftTimelineDialog')) return;
        var host = document.createElement('div');
        host.id = 'ftTimelineHost';
        host.innerHTML = '' +
            '<dialog id="ftTimelineDialog" class="ft-timeline-dialog">' +
                '<div class="dialog-form ft-tl-dialog">' +
                    '<h3>Family timeline</h3>' +
                    '<p class="dialog-copy" id="ftTlSummary"></p>' +
                    '<label class="sr-only" for="ftTlSearch">Filter events</label>' +
                    '<input type="search" id="ftTlSearch" class="ft-tl-search" placeholder="Filter by name, place, title or note" autocomplete="off" spellcheck="false">' +
                    '<div class="ft-tl-kinds" id="ftTlKinds" role="group" aria-label="Filter by event kind"></div>' +
                    '<div class="ft-tl-fam" id="ftTlList"></div>' +
                    '<div class="dialog-actions">' +
                        '<button type="button" class="btn-secondary" data-ft-action="close-family-timeline">Close</button>' +
                    '</div>' +
                '</div>' +
            '</dialog>';
        document.body.appendChild(host);
    }

    function familyEvents() {
        return eventList().filter(function (ev) { return !!findPersonSafe(ev.person_id); });
    }

    function matchesText(ev, needle) {
        var person = findPersonSafe(ev.person_id);
        var haystack = [
            person ? person.name : '',
            ev.title || '', ev.place || '', ev.note || '',
            ev.date || '', kindLabel(ev.kind)
        ].join(' ').toLowerCase();
        return haystack.indexOf(needle) !== -1;
    }

    function familyRowMarkup(ev) {
        var person = findPersonSafe(ev.person_id);
        if (!person) return '';
        var dateText = displayDate(ev.date);
        var gen = generationLabel(person.id);
        var details = [];
        if (ev.title) details.push('<span class="ft-tl-fam-title">' + escText(ev.title) + '</span>');
        if (ev.place) details.push('<span class="ft-tl-fam-place">' + escText(ev.place) + '</span>');

        return '' +
            '<li class="ft-tl-fam-row" data-kind="' + escAttr(normKind(ev.kind)) + '">' +
                '<span class="ft-tl-fam-date">' + escText(dateText || 'Unknown') + '</span>' +
                '<span class="ft-tl-fam-kind">' + escText(kindLabel(ev.kind)) + '</span>' +
                '<button type="button" class="ft-tl-fam-person" data-ft-action="select-person" data-id="' + escAttr(person.id) + '" title="Select ' + escAttr(person.name) + '">' +
                    escText(person.name) +
                    (gen ? '<span class="ft-tl-gen">' + escText(gen) + '</span>' : '') +
                '</button>' +
                '<span class="ft-tl-fam-details">' + (details.length ? details.join(' · ') : '') + '</span>' +
            '</li>';
    }

    function renderFamilyGroups(events) {
        if (!events.length) {
            return '<p class="ft-tl-empty">No events match these filters.</p>';
        }

        var groups = new Map();
        events.forEach(function (ev) {
            var parsed = parseEventDate(ev.date);
            var key = parsed ? parsed.year : null;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(ev);
        });

        var keys = Array.from(groups.keys()).sort(function (a, b) {
            if (a === null) return 1;
            if (b === null) return -1;
            return a - b;
        });

        return keys.map(function (key) {
            var items = groups.get(key).sort(compareEvents);
            return '<section class="ft-tl-group">' +
                '<h4 class="ft-tl-year">' + escText(key === null ? 'Undated' : String(key)) + '</h4>' +
                '<ul class="ft-tl-fam-list">' + items.map(familyRowMarkup).join('') + '</ul>' +
            '</section>';
        }).join('');
    }

    function renderFamilyTimeline() {
        var summary = document.getElementById('ftTlSummary');
        var kindsBox = document.getElementById('ftTlKinds');
        var list = document.getElementById('ftTlList');
        if (!summary || !kindsBox || !list) return;

        var all = familyEvents();
        var needle = textFilter.trim().toLowerCase();
        var textMatched = needle ? all.filter(function (ev) { return matchesText(ev, needle); }) : all;

        var counts = {};
        KINDS.forEach(function (k) { counts[k.value] = 0; });
        textMatched.forEach(function (ev) { counts[normKind(ev.kind)] += 1; });

        kindsBox.innerHTML = KINDS.map(function (k) {
            var active = kindFilter[k.value] !== false;
            return '<button type="button" class="ft-tl-kind-btn' + (active ? ' active' : '') + '" ' +
                'data-ft-action="toggle-kind" data-kind="' + escAttr(k.value) + '" ' +
                'aria-pressed="' + (active ? 'true' : 'false') + '">' +
                escText(k.label) + ' <span class="ft-tl-kind-count">' + counts[k.value] + '</span></button>';
        }).join('') +
            '<button type="button" class="ft-tl-kind-btn ft-tl-kind-reset" data-ft-action="reset-family-filters">Show all</button>';

        var filtered = textMatched.filter(function (ev) { return kindFilter[normKind(ev.kind)] !== false; });

        var people = {};
        filtered.forEach(function (ev) { people[ev.person_id] = true; });
        var personCount = Object.keys(people).length;

        summary.textContent = filtered.length
            ? filtered.length + (filtered.length === 1 ? ' event' : ' events') + ' across ' +
              personCount + (personCount === 1 ? ' person' : ' people') + '.'
            : 'No events to show yet. Add life events from a person’s Events tab.';

        list.innerHTML = renderFamilyGroups(filtered);
    }

    function openFamilyTimeline() {
        injectDialog();
        renderFamilyTimeline();
        var dialog = document.getElementById('ftTimelineDialog');
        if (!dialog) return;
        if (!dialog.open) dialog.showModal();
    }

    // --- actions -------------------------------------------------------
    async function saveEvent(form) {
        var data = new FormData(form);
        var id = data.get('id');
        var payload = {
            kind: String(data.get('kind') || 'other'),
            date: String(data.get('date') || '').trim(),
            place: String(data.get('place') || '').trim(),
            title: String(data.get('title') || '').trim(),
            note: String(data.get('note') || '').trim()
        };

        try {
            if (id) {
                var patch = await fetch('/api/events/' + encodeURIComponent(id), {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!patch.ok) throw new Error(await patch.text());
                notify('Event saved');
            } else {
                var person = selectedPerson();
                if (!person) {
                    notify('Select a person first', true);
                    return;
                }
                payload.person_id = person.id;
                var created = await fetch('/api/events', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!created.ok) throw new Error(await created.text());
                notify('Event added');
            }

            formOpen = false;
            editingId = null;
            await refreshEvents();
            renderEventsPanel();
        } catch (err) {
            notify('Could not save the event: ' + errorText(err), true);
        }
    }

    async function deleteEvent(id) {
        var found = null;
        eventList().forEach(function (ev) { if (Number(ev.id) === Number(id)) found = ev; });

        var label = kindLabel(found ? found.kind : 'other');
        if (found && found.date) label += ' · ' + displayDate(found.date);

        var ok = await confirmWith({
            title: 'Delete this event?',
            message: 'This removes the ' + label + ' event from the timeline. It cannot be undone.',
            confirmLabel: 'Delete',
            danger: true
        });
        if (!ok) return;

        try {
            var res = await fetch('/api/events/' + encodeURIComponent(id), { method: 'DELETE' });
            if (!res.ok && res.status !== 204) throw new Error(await res.text());
            if (editingId !== null && Number(editingId) === Number(id)) editingId = null;
            notify('Event deleted');
            await refreshEvents();
            var person = selectedPerson();
            if (person && personEvents(person.id).length === 0) formOpen = true;
            renderEventsPanel();
        } catch (err) {
            notify('Could not delete the event: ' + errorText(err), true);
        }
    }

    function selectPersonFromTimeline(id) {
        if (typeof window.selectPerson === 'function') {
            try { window.selectPerson(Number(id)); } catch (err) { /* keep the dialog open */ }
        }
        var dialog = document.getElementById('ftTimelineDialog');
        if (dialog && dialog.open) dialog.close();
        renderEventsPanel();
    }

    // --- wiring --------------------------------------------------------
    function onClick(event) {
        var target = event.target;
        if (!target || !target.closest) return;

        // The panel always shows the person who is selected right now.
        if (target.closest('.tab-btn[data-tab="events"]')) {
            renderEventsPanel();
            refreshEvents().then(renderEventsPanel);
        }
        if (target.closest('.tree-node') || target.closest('.search-result')) {
            renderEventsPanel();
        }

        var trigger = target.closest('[data-ft-action]');
        if (!trigger) return;

        var action = trigger.getAttribute('data-ft-action');
        try {
            if (action === 'open-family-timeline') { openFamilyTimeline(); return; }
            if (action === 'toggle-add-form') { formOpen = !formOpen; editingId = null; renderEventsPanel(); return; }
            if (action === 'cancel-form') { formOpen = false; editingId = null; renderEventsPanel(); return; }
            if (action === 'edit-event') { editingId = Number(trigger.getAttribute('data-id')); formOpen = false; renderEventsPanel(); return; }
            if (action === 'delete-event') { deleteEvent(trigger.getAttribute('data-id')); return; }
            if (action === 'toggle-kind') {
                var kind = normKind(trigger.getAttribute('data-kind'));
                kindFilter[kind] = kindFilter[kind] === false;
                renderFamilyTimeline();
                return;
            }
            if (action === 'reset-family-filters') {
                kindFilter = {};
                textFilter = '';
                var search = document.getElementById('ftTlSearch');
                if (search) search.value = '';
                renderFamilyTimeline();
                return;
            }
            if (action === 'close-family-timeline') {
                var dialog = document.getElementById('ftTimelineDialog');
                if (dialog && dialog.open) dialog.close();
                return;
            }
            if (action === 'select-person') { selectPersonFromTimeline(trigger.getAttribute('data-id')); return; }
        } catch (err) {
            notify('Something went wrong: ' + errorText(err), true);
        }
    }

    function onSubmit(event) {
        var form = event.target;
        if (!form || form.getAttribute('data-ft-form') !== 'event') return;
        event.preventDefault();
        saveEvent(form);
    }

    function onInput(event) {
        var target = event.target;
        if (!target || target.id !== 'ftTlSearch') return;
        textFilter = String(target.value || '');
        renderFamilyTimeline();
    }

    function injectStylesheet() {
        if (document.querySelector('link[data-ft-tl-style]')) return;
        if (document.querySelector('link[href="/static/feat-timeline.css"]')) return;
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/static/feat-timeline.css';
        link.setAttribute('data-ft-tl-style', '1');
        document.head.appendChild(link);
    }

    function start() {
        injectStylesheet();
        injectDialog();
        document.addEventListener('click', onClick);
        document.addEventListener('submit', onSubmit);
        document.addEventListener('input', onInput);
        renderEventsPanel();
        refreshEvents().then(renderEventsPanel);
    }

    window.renderEventsPanel = renderEventsPanel;
    window.openFamilyTimeline = openFamilyTimeline;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
}());
