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

    function personButton(id, name, extra) {
        return '<button type="button" class="ft-find-person" data-person="' + id + '">' +
            FT.esc(name) + '</button>' + (extra ? ' <span class="ft-cal-extra">' + FT.esc(extra) + '</span>' : '');
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
                    return '<li>' + personButton(b.person_id, b.name, b.living ? 'turns ' + b.age : 'would have turned ' + b.age) + '</li>';
                }).join('') + '</ul>';
        }

        if (data.anniversaries && data.anniversaries.length) {
            html += '<h4 class="ft-cal-heading">Anniversaries</h4><ul class="ft-cal-list">' +
                data.anniversaries.map(function (a) {
                    var names = (a.names || []).join(' & ');
                    return '<li>' + personButton((a.person_ids || [])[0], names, a.years + ' years') +
                        (a.place ? ' <span class="ft-cal-extra">' + FT.esc(a.place) + '</span>' : '') + '</li>';
                }).join('') + '</ul>';
        }

        if (data.on_this_day && data.on_this_day.length) {
            html += '<h4 class="ft-cal-heading">On this day</h4><ul class="ft-cal-list">' +
                data.on_this_day.map(function (e) {
                    return '<li>' + personButton(e.person_id, e.name, e.kind + ' · ' + e.date) + '</li>';
                }).join('') + '</ul>';
        }

        if (data.incomplete && data.incomplete.length) {
            html += '<h4 class="ft-cal-heading">Day unknown</h4><ul class="ft-cal-list">' +
                data.incomplete.map(function (i) {
                    return '<li>' + personButton(i.person_id, i.name, i.date) + '</li>';
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
