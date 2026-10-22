// Feature module: this month in the family.
//
// The dates are already in the tree; this shows the birthdays, the
// anniversaries and what happened on this day.

(function () {
    'use strict';

    var FT = window.FT;
    var dialog = null;
    var month = null; // "2026-10"

    function shiftMonth(value, delta) {
        var parts = value.split('-');
        var year = Number(parts[0]);
        var m = Number(parts[1]) + delta;
        while (m > 12) { m -= 12; year += 1; }
        while (m < 1) { m += 12; year -= 1; }
        return year + '-' + (m < 10 ? '0' + m : m);
    }

    function monthLabel(value) {
        var parts = value.split('-');
        var names = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
            'August', 'September', 'October', 'November', 'December'];
        return names[Number(parts[1]) - 1] + ' ' + parts[0];
    }

    // The dates are shown the way the rest of the app shows them.
    function displayDate(value) {
        if (!value) return '';
        if (typeof formatDate === 'function') return formatDate(value);
        return value;
    }

    function eventLabel(kind) {
        var text = String(kind || 'event');
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    // Every row is the same three things: who it is about, what happened,
    // and when.
    function row(id, name, event, date, extra) {
        return '<li class="ft-cal-row">' +
            '<span class="ft-cal-name">' +
            '  <button type="button" class="ft-find-person" data-person="' + id + '">' + FT.esc(name) + '</button>' +
            '</span>' +
            '<span class="ft-cal-event">' + FT.esc(event) + '</span>' +
            '<span class="ft-cal-date">' + FT.esc(date) +
            (extra ? ' <span class="ft-cal-extra">' + FT.esc(extra) + '</span>' : '') +
            '</span>' +
            '</li>';
    }

    function render(data) {
        var body = FT.body(dialog);
        var html = '<div class="ft-cal-nav">' +
            '<button type="button" class="ft-cal-nav-btn" data-action="prev" aria-label="Previous month">&larr;</button>' +
            '<span class="ft-cal-month">' + FT.esc(monthLabel(data.month)) + '</span>' +
            '<button type="button" class="ft-cal-nav-btn" data-action="next" aria-label="Next month">&rarr;</button>' +
            '<button type="button" class="ft-link-btn" data-action="today">This month</button>' +
            '</div>';

        if (data.birthdays && data.birthdays.length) {
            html += '<h4 class="ft-cal-heading">Birthdays</h4><ul class="ft-cal-list">' +
                data.birthdays.map(function (b) {
                    return row(b.person_id, b.name, 'Birthday', displayDate(b.date),
                        b.living ? 'turns ' + b.age : 'would have turned ' + b.age);
                }).join('') + '</ul>';
        }

        if (data.anniversaries && data.anniversaries.length) {
            html += '<h4 class="ft-cal-heading">Anniversaries</h4><ul class="ft-cal-list">' +
                data.anniversaries.map(function (a) {
                    var names = (a.names || []).join(' & ');
                    return row((a.person_ids || [])[0], names, 'Marriage', displayDate(a.date),
                        (a.years ? a.years + ' years' : '') + (a.place ? ' · ' + a.place : ''));
                }).join('') + '</ul>';
        }

        if (data.on_this_day && data.on_this_day.length) {
            html += '<h4 class="ft-cal-heading">On this day</h4><ul class="ft-cal-list">' +
                data.on_this_day.map(function (e) {
                    return row(e.person_id, e.name, eventLabel(e.kind), displayDate(e.date),
                        e.years_ago ? e.years_ago + ' years ago' : '');
                }).join('') + '</ul>';
        }

        if (data.incomplete && data.incomplete.length) {
            html += '<h4 class="ft-cal-heading">Day unknown</h4><ul class="ft-cal-list">' +
                data.incomplete.map(function (i) {
                    return row(i.person_id, i.name, 'Birthday', i.date, 'day unknown');
                }).join('') + '</ul>';
        }

        if (!data.birthdays.length && !data.anniversaries.length && !data.on_this_day.length && !data.incomplete.length) {
            html += '<p class="ft-panel-empty">Nothing in this month yet. Add a birth date to somebody, or a marriage ' +
                'event, and it shows up here.</p>';
        }

        body.innerHTML = html;
    }

    async function load(value) {
        month = value;
        var body = FT.body(dialog);
        body.innerHTML = '<p class="ft-panel-empty">Looking through the dates…</p>';
        try {
            var data = await FT.api('/api/calendar?month=' + encodeURIComponent(month));
            render(data);
        } catch (err) {
            body.innerHTML = '<p class="ft-panel-error" role="alert">Could not read the calendar: ' + FT.esc(err.message) + '</p>';
        }
    }

    function openDialog() {
        dialog = FT.dialog({
            id: 'ftCalendarDialog',
            className: 'ft-cal-dialog',
            title: 'This month in the family',
            copy: 'Birthdays, anniversaries and the days worth remembering.'
        });
        if (!dialog) return;
        FT.resetActions(dialog);
        FT.action(dialog, 'Close', 'btn-secondary', function () { FT.close(dialog); });
        FT.open(dialog);
        var now = new Date();
        load(now.getFullYear() + '-' + (now.getMonth() + 1 < 10 ? '0' : '') + (now.getMonth() + 1));
    }

    function mount() {
        FT.ensureStylesheet('/static/feat-calendar.css');
        dialog = FT.dialog({
            id: 'ftCalendarDialog',
            className: 'ft-cal-dialog',
            title: 'This month in the family',
            copy: 'Birthdays, anniversaries and the days worth remembering.'
        });
        if (!dialog) return;

        var body = FT.body(dialog);
        body.addEventListener('click', function (event) {
            var person = event.target.closest('[data-person]');
            if (person) {
                FT.close(dialog);
                if (typeof jumpToPerson === 'function') jumpToPerson(Number(person.dataset.person));
                return;
            }
            var button = event.target.closest('[data-action]');
            if (!button) return;
            if (button.dataset.action === 'prev') load(shiftMonth(month, -1));
            if (button.dataset.action === 'next') load(shiftMonth(month, 1));
            if (button.dataset.action === 'today') {
                var now = new Date();
                load(now.getFullYear() + '-' + (now.getMonth() + 1 < 10 ? '0' : '') + (now.getMonth() + 1));
            }
        });

        FT.registerTool({
            id: 'calendar',
            title: 'This month',
            description: 'Birthdays, anniversaries and the days worth remembering.',
            icon: 'i-calendar',
            open: openDialog
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
})();
