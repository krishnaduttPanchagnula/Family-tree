// Feature module: printable reports.
//
// A chart is a picture; a report is a document. Ancestors, descendants, the
// missing information and the sources, laid out to print on A4 or Letter.

(function () {
    'use strict';

    var FT = window.FT;
    var dialog = null;

    var KINDS = [
        { value: 'ancestor', label: 'Ancestors of a person', needsRoot: true },
        { value: 'descendant', label: 'Descendants of a person', needsRoot: true },
        { value: 'missing', label: 'Missing information', needsRoot: false },
        { value: 'sources', label: 'Sources', needsRoot: false }
    ];

    function kindLabel(value) {
        for (var i = 0; i < KINDS.length; i++) {
            if (KINDS[i].value === value) return KINDS[i].label;
        }
        return 'Report';
    }

    function render() {
        var body = FT.body(dialog);
        var people = FT.people().slice().sort(function (a, b) {
            return String(a.name).localeCompare(String(b.name));
        });
        var selected = FT.selectedId();
        var options = people.map(function (person) {
            return '<option value="' + person.id + '"' + (person.id === selected ? ' selected' : '') + '>' +
                FT.esc(person.name) + '</option>';
        }).join('');

        body.innerHTML =
            '<label class="field-label" for="ftReportKind">Report</label>' +
            '<select id="ftReportKind">' + KINDS.map(function (kind) {
                return '<option value="' + kind.value + '">' + FT.esc(kind.label) + '</option>';
            }).join('') + '</select>' +
            '<div id="ftReportRootFields">' +
            '  <label class="field-label" for="ftReportRoot">Person</label>' +
            '  <select id="ftReportRoot">' + options + '</select>' +
            '  <label class="field-label" for="ftReportGens">Generations</label>' +
            '  <select id="ftReportGens">' +
            '    <option value="2">2</option><option value="3">3</option><option value="4" selected>4</option>' +
            '    <option value="5">5</option><option value="6">6</option>' +
            '  </select>' +
            '</div>' +
            '<div class="field-row">' +
            '  <div class="field-col">' +
            '    <label class="field-label" for="ftReportPaper">Paper</label>' +
            '    <select id="ftReportPaper"><option value="A4">A4</option><option value="Letter">Letter</option></select>' +
            '  </div>' +
            '  <div class="field-col">' +
            '    <label class="field-label" for="ftReportOrientation">Direction</label>' +
            '    <select id="ftReportOrientation">' +
            '      <option value="portrait">Portrait</option><option value="landscape">Landscape</option>' +
            '    </select>' +
            '  </div>' +
            '</div>' +
            '<p class="ft-panel-empty" id="ftReportHint">The preview opens in a new window, where you can print it ' +
            'or save it as a PDF.</p>';

        var kind = document.getElementById('ftReportKind');
        function sync() {
            var current = KINDS.find(function (k) { return k.value === kind.value; });
            document.getElementById('ftReportRootFields').style.display = current.needsRoot ? '' : 'none';
        }
        kind.addEventListener('change', sync);
        sync();
    }

    function eventsMarkup(events) {
        if (!events || !events.length) return '';
        return '<ul class="ft-report-events">' + events.map(function (event) {
            var text = [event.kind, event.date, event.place, event.title].filter(Boolean).join(' · ');
            return '<li>' + FT.esc(text) + (event.note ? ' — ' + FT.esc(event.note) : '') + '</li>';
        }).join('') + '</ul>';
    }

    function sourcesMarkup(sources) {
        if (!sources || !sources.length) return '';
        return '<ul class="ft-report-sources">' + sources.map(function (source) {
            var text = [source.title, source.citation, source.date].filter(Boolean).join(' · ');
            return '<li>' + FT.esc(text) + '</li>';
        }).join('') + '</ul>';
    }

    function peopleMarkup(people) {
        return people.map(function (person) {
            return '<article class="ft-report-person">' +
                '<h3>' + FT.esc(person.name) + '</h3>' +
                (person.dates ? '<p class="ft-report-dates">' + FT.esc(person.dates) + '</p>' : '') +
                (person.birth_place ? '<p class="ft-report-place">' + FT.esc(person.birth_place) + '</p>' : '') +
                (person.profession ? '<p class="ft-report-place">' + FT.esc(person.profession) + '</p>' : '') +
                (person.facts ? '<p class="ft-report-facts">' + FT.esc(person.facts) + '</p>' : '') +
                eventsMarkup(person.events) +
                sourcesMarkup(person.sources) +
                '</article>';
        }).join('');
    }

    function previewMarkup(report, paper, orientation) {
        var sections = report.sections.map(function (section) {
            return '<section class="ft-report-section">' +
                '<h2>' + FT.esc(section.heading) + '</h2>' +
                (section.subtitle ? '<p class="ft-report-subtitle">' + FT.esc(section.subtitle) + '</p>' : '') +
                peopleMarkup(section.people) +
                '</section>';
        }).join('');

        var pageSize = paper === 'Letter' ? 'letter' : 'A4';

        return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
            '<title>' + FT.esc(report.title) + '</title>' +
            '<link rel="stylesheet" href="/static/fonts.css">' +
            '<style>' +
            '  @page { size: ' + pageSize + ' ' + orientation + '; margin: 18mm; }' +
            '  body { font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; background: #fff;' +
            '         margin: 0; padding: 22px 26px; font-size: 11.5pt; line-height: 1.5; }' +
            '  h1 { font-size: 19pt; margin: 0 0 2px; }' +
            '  h2 { font-size: 13pt; margin: 0 0 2px; border-bottom: 1px solid #333; padding-bottom: 3px; }' +
            '  h3 { font-size: 12pt; margin: 0 0 2px; }' +
            '  .ft-report-head { border-bottom: 2px solid #1a1a1a; padding-bottom: 8px; margin-bottom: 18px; }' +
            '  .ft-report-meta { font-size: 9.5pt; color: #555; margin: 4px 0 0; }' +
            '  .ft-report-section { margin-bottom: 18px; break-inside: auto; }' +
            '  .ft-report-subtitle { font-size: 9.5pt; color: #555; margin: 0 0 8px; }' +
            '  .ft-report-person { break-inside: avoid; margin-bottom: 12px; }' +
            '  .ft-report-dates { margin: 0; font-size: 10.5pt; }' +
            '  .ft-report-place { margin: 0; font-size: 10pt; color: #444; }' +
            '  .ft-report-facts { margin: 4px 0 0; }' +
            '  .ft-report-events, .ft-report-sources { margin: 4px 0 0; padding-left: 18px; font-size: 10pt; color: #333; }' +
            '  .ft-report-empty { color: #555; font-style: italic; }' +
            '</style></head><body>' +
            '<div class="ft-report-head"><h1>' + FT.esc(report.title) + '</h1>' +
            '<p class="ft-report-meta">Family Tree Builder · ' + FT.esc(report.generated) + '</p></div>' +
            (sections || '<p class="ft-report-empty">Nothing to show yet.</p>') +
            '</body></html>';
    }

    async function build() {
        var kind = document.getElementById('ftReportKind').value;
        var root = document.getElementById('ftReportRoot');
        var gens = document.getElementById('ftReportGens').value;
        var paper = document.getElementById('ftReportPaper').value;
        var orientation = document.getElementById('ftReportOrientation').value;

        var path = '/api/reports/' + kind;
        var needsRoot = KINDS.find(function (k) { return k.value === kind; }).needsRoot;
        if (needsRoot) {
            if (!root || !root.value) {
                FT.toast('Choose a person first', true);
                return;
            }
            path += '?root=' + encodeURIComponent(root.value) + '&gens=' + encodeURIComponent(gens);
        }

        var report;
        try {
            report = await FT.api(path);
        } catch (err) {
            FT.toast('Could not build the report: ' + err.message, true);
            return;
        }

        var win = window.open('', '_blank');
        if (!win) {
            FT.toast('The browser blocked the preview window', true);
            return;
        }
        win.document.open();
        win.document.write(previewMarkup(report, paper, orientation));
        win.document.close();
    }

    function openDialog() {
        dialog = FT.dialog({
            id: 'ftReportDialog',
            className: 'ft-report-dialog',
            title: 'Reports',
            copy: 'A document you can print or save as a PDF.'
        });
        if (!dialog) return;
        FT.resetActions(dialog);
        FT.action(dialog, 'Close', 'btn-secondary', function () { FT.close(dialog); });
        FT.action(dialog, 'Preview', 'btn-primary', build);
        FT.open(dialog);
        render();
    }

    function mount() {
        FT.ensureStylesheet('/static/feat-reports.css');
        dialog = FT.dialog({
            id: 'ftReportDialog',
            className: 'ft-report-dialog',
            title: 'Reports',
            copy: 'A document you can print or save as a PDF.'
        });
        if (!dialog) return;

        FT.registerTool({
            id: 'reports',
            title: 'Reports',
            description: 'Ancestors, descendants, missing information and sources.',
            icon: 'i-print',
            open: openDialog
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
})();
