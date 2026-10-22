// Feature module: media on life events.
//
// A wedding photograph belongs to the wedding, not to a person in general, so
// files attach to the events in the timeline.

(function () {
    'use strict';

    var FT = window.FT;

    var panel = null;

    function eventLabel(event) {
        var kind = event.kind ? event.kind[0].toUpperCase() + event.kind.slice(1) : 'Event';
        if (event.title) return kind + ' — ' + event.title;
        if (event.date) return kind + ' — ' + event.date;
        return kind;
    }

    function mediaRow(media) {
        var thumb = media.kind === 'photo' ?
            '<a class="ft-media-thumb" href="' + FT.esc(media.file_url) + '" target="_blank" rel="noopener noreferrer">' +
            '  <img src="' + FT.esc(media.file_url) + '" alt="" loading="lazy">' +
            '</a>' :
            '<a class="ft-media-file" href="' + FT.esc(media.file_url) + '" target="_blank" rel="noopener noreferrer">Document</a>';

        var remove = FT.readOnly() ? '' :
            ' <button type="button" class="ft-link-btn ft-danger-link" data-action="delete-media" data-id="' + media.id + '">Remove</button>';

        return '<li class="ft-media">' + thumb +
            '<span class="ft-media-caption">' + FT.esc(media.caption || '') + '</span>' + remove +
            '</li>';
    }

    async function load(person) {
        var events = [];
        var media = [];
        try {
            events = (await FT.api('/api/events')) || [];
            media = (await FT.api('/api/event-media?person_id=' + person.id)) || [];
        } catch (err) {
            panel.innerHTML = '<p class="ft-panel-error" role="alert">Could not load the files: ' + FT.esc(err.message) + '</p>';
            return;
        }

        var own = events.filter(function (event) { return event.person_id === person.id; });
        var byEvent = {};
        media.forEach(function (item) {
            if (!byEvent[item.event_id]) byEvent[item.event_id] = [];
            byEvent[item.event_id].push(item);
        });

        var html = own.map(function (event) {
            var items = byEvent[event.id] || [];
            var list = items.length ?
                '<ul class="ft-media-list">' + items.map(mediaRow).join('') + '</ul>' : '';
            var attach = FT.readOnly() ? '' :
                '<label class="ft-media-add">' +
                '  <span class="ft-link-btn">Attach a photo or document</span>' +
                '  <input type="file" data-event="' + event.id + '" accept="image/*,application/pdf">' +
                '</label>';
            return '<section class="ft-media-event">' +
                '<h4 class="ft-media-event-title">' + FT.esc(eventLabel(event)) + '</h4>' +
                list + attach +
                '</section>';
        }).join('');

        if (!own.length) {
            html = '<p class="ft-panel-empty">No events yet. Add a life event in the Events tab, then attach a ' +
                'photograph or a document to it.</p>';
        }

        panel.innerHTML = html;
    }

    async function upload(person, eventId, file) {
        var form = new FormData();
        form.append('event_id', String(eventId));
        form.append('file', file);
        try {
            await FT.api('/api/event-media', { method: 'POST', body: form });
            FT.toast('File attached');
            await load(person);
        } catch (err) {
            FT.toast('Could not attach the file: ' + err.message, true);
        }
    }

    async function remove(person, id) {
        var ok = await FT.confirm({
            title: 'Remove this file?',
            message: 'The link to it goes away. The file itself stays on this machine until the photo manager removes it.',
            confirmLabel: 'Remove'
        });
        if (!ok) return;
        try {
            await FT.json('/api/event-media/' + id, 'DELETE');
            await load(person);
        } catch (err) {
            FT.toast('Could not remove the file: ' + err.message, true);
        }
    }

    function mount() {
        FT.ensureStylesheet('/static/feat-event-media.css');
        panel = FT.addTab('files', 'Files');
        if (!panel) return;
        panel.id = 'ftFilesPanel';

        panel.addEventListener('change', function (event) {
            var input = event.target.closest('input[type="file"]');
            if (!input || !input.files || !input.files[0]) return;
            var person = FT.people().find(function (p) { return p.id === FT.selectedId(); });
            if (person) upload(person, Number(input.dataset.event), input.files[0]);
        });

        panel.addEventListener('click', function (event) {
            var button = event.target.closest('button[data-action="delete-media"]');
            if (!button) return;
            var person = FT.people().find(function (p) { return p.id === FT.selectedId(); });
            if (person) remove(person, Number(button.dataset.id));
        });

        FT.onPanel(function (person) { load(person); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
})();
