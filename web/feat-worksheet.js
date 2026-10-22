// Feature module: a blank family tree worksheet.
//
// Some uses need no data at all: a school project, a family reunion, a
// page somebody fills in by hand. This prints an empty tree.

(function () {
    'use strict';

    var FT = window.FT;
    var dialog = null;

    var OPTIONS = {
        paper: 'A4',
        orientation: 'portrait',
        generations: 3,
        photos: false,
        title: 'My family tree',
        subtitle: 'Name: ______________________',
        labels: true
    };

    var GENERATION_LABELS = ['Great-grandparents', 'Grandparents', 'Parents', 'Me', 'Children', 'Grandchildren'];

    // The sheet is a pyramid: one box at the bottom, doubling upwards.
    function sheet() {
        var portrait = OPTIONS.orientation === 'portrait';
        var usable = portrait ? 640 : 980;
        var gap = 10;
        var rows = [];
        var count = Math.pow(2, OPTIONS.generations - 1);

        for (var row = 0; row < OPTIONS.generations; row++) {
            var cols = Math.pow(2, OPTIONS.generations - 1 - row);
            var boxWidth = Math.max(52, Math.min(150, Math.floor((usable - (cols - 1) * gap) / cols)));
            var boxHeight = Math.max(44, Math.min(92, Math.round(boxWidth * 0.78)));
            rows.push({ cols: cols, width: boxWidth, height: boxHeight });
        }
        void count;

        var html = '<div class="ws-sheet">';
        for (var r = 0; r < rows.length; r++) {
            var line = rows[r];
            var rowWidth = line.cols * line.width + (line.cols - 1) * gap;
            html += '<div class="ws-row" style="height:' + (line.height + gap) + 'px">';
            html += '<div class="ws-row-inner" style="width:' + rowWidth + 'px; gap:' + gap + 'px">';
            for (var c = 0; c < line.cols; c++) {
                html += '<div class="ws-box" style="width:' + line.width + 'px; height:' + line.height + 'px">' +
                    (OPTIONS.photos ? '<span class="ws-photo"></span>' : '') +
                    '<span class="ws-line"></span>' +
                    '</div>';
            }
            html += '</div></div>';
        }
        html += '</div>';
        return html;
    }

    function labelMarkup() {
        if (!OPTIONS.labels) return '';
        var html = '';
        for (var i = 0; i < OPTIONS.generations; i++) {
            var index = OPTIONS.generations - 1 - i;
            var name = GENERATION_LABELS[2] && GENERATION_LABELS[Math.min(GENERATION_LABELS.length - 1, index + 1)];
            html += '<span class="ws-label">' + FT.esc(name || '') + '</span>';
        }
        return html;
    }

    function page() {
        var pageSize = OPTIONS.paper === 'Letter' ? 'letter' : 'A4';
        return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
            '<title>' + FT.esc(OPTIONS.title) + '</title>' +
            '<link rel="stylesheet" href="/static/fonts.css">' +
            '<style>' +
            '  @page { size: ' + pageSize + ' ' + OPTIONS.orientation + '; margin: 12mm; }' +
            '  body { margin: 0; padding: 18px 20px; background: #fff; color: #1a1a1a;' +
            '         font-family: Georgia, "Times New Roman", serif; }' +
            '  h1 { font-size: 20pt; margin: 0 0 4px; text-align: center; }' +
            '  .ws-sub { text-align: center; font-size: 11pt; margin: 0 0 14px; }' +
            '  .ws-sheet { display: flex; flex-direction: column; align-items: center; }' +
            '  .ws-row { display: flex; align-items: flex-start; justify-content: center; }' +
            '  .ws-row-inner { display: flex; justify-content: center; }' +
            '  .ws-box { border: 1.4px solid #1a1a1a; border-radius: 4px; position: relative; }' +
            '  .ws-photo { position: absolute; top: 3px; left: 3px; width: 26%; height: 46%;' +
            '              border: 1px solid #555; }' +
            '  .ws-line { position: absolute; left: 7%; right: 7%; bottom: 20%; height: 1px; background: #999; }' +
            '  .ws-labels { position: absolute; left: 0; top: 40px; display: flex; flex-direction: column; gap: 0; }' +
            '  .ws-label { font-size: 8pt; color: #666; }' +
            '  .ws-wrap { position: relative; }' +
            '</style></head><body>' +
            '<h1>' + FT.esc(OPTIONS.title) + '</h1>' +
            '<p class="ws-sub">' + FT.esc(OPTIONS.subtitle) + '</p>' +
            '<div class="ws-wrap">' + labelMarkup() + sheet() + '</div>' +
            '</body></html>';
    }

    function openPreview() {
        var win = window.open('', '_blank');
        if (!win) {
            FT.toast('The browser blocked the preview window', true);
            return;
        }
        win.document.open();
        win.document.write(page());
        win.document.close();
    }

    function printSheet() {
        var win = window.open('', '_blank');
        if (!win) {
            FT.toast('The browser blocked the print window', true);
            return;
        }
        win.document.open();
        win.document.write(page());
        win.document.close();
        win.addEventListener('load', function () {
            setTimeout(function () { win.focus(); win.print(); }, 250);
        });
    }

    function render() {
        var body = FT.body(dialog);
        body.innerHTML =
            '<label class="field-label" for="ftSheetTitle">Title</label>' +
            '<input type="text" id="ftSheetTitle" value="' + FT.esc(OPTIONS.title) + '">' +
            '<label class="field-label" for="ftSheetSubtitle">Under the title</label>' +
            '<input type="text" id="ftSheetSubtitle" value="' + FT.esc(OPTIONS.subtitle) + '">' +
            '<div class="field-row">' +
            '  <div class="field-col">' +
            '    <label class="field-label" for="ftSheetPaper">Paper</label>' +
            '    <select id="ftSheetPaper"><option value="A4">A4</option><option value="Letter">Letter</option></select>' +
            '  </div>' +
            '  <div class="field-col">' +
            '    <label class="field-label" for="ftSheetOrientation">Direction</label>' +
            '    <select id="ftSheetOrientation">' +
            '      <option value="portrait">Portrait</option><option value="landscape">Landscape</option>' +
            '    </select>' +
            '  </div>' +
            '</div>' +
            '<label class="field-label" for="ftSheetGenerations">Generations</label>' +
            '<select id="ftSheetGenerations">' +
            '  <option value="3">3</option><option value="4">4</option><option value="5">5</option>' +
            '</select>' +
            '<label class="ft-wipe-check"><input type="checkbox" id="ftSheetPhotos"> A box for a photo on every card</label>' +
            '<label class="ft-wipe-check"><input type="checkbox" id="ftSheetLabels" checked> Name each generation</label>' +
            '<p class="ft-panel-empty">The sheet is empty on purpose: it is for filling in by hand.</p>';

        document.getElementById('ftSheetPaper').value = OPTIONS.paper;
        document.getElementById('ftSheetOrientation').value = OPTIONS.orientation;
        document.getElementById('ftSheetGenerations').value = String(OPTIONS.generations);
        document.getElementById('ftSheetPhotos').checked = OPTIONS.photos;
        document.getElementById('ftSheetLabels').checked = OPTIONS.labels;

        function sync() {
            OPTIONS.title = document.getElementById('ftSheetTitle').value;
            OPTIONS.subtitle = document.getElementById('ftSheetSubtitle').value;
            OPTIONS.paper = document.getElementById('ftSheetPaper').value;
            OPTIONS.orientation = document.getElementById('ftSheetOrientation').value;
            OPTIONS.generations = Number(document.getElementById('ftSheetGenerations').value);
            OPTIONS.photos = document.getElementById('ftSheetPhotos').checked;
            OPTIONS.labels = document.getElementById('ftSheetLabels').checked;
        }
        ['ftSheetTitle', 'ftSheetSubtitle', 'ftSheetPaper', 'ftSheetOrientation', 'ftSheetGenerations', 'ftSheetPhotos', 'ftSheetLabels']
            .forEach(function (id) {
                document.getElementById(id).addEventListener('change', sync);
                document.getElementById(id).addEventListener('input', sync);
            });
    }

    function openDialog() {
        dialog = FT.dialog({
            id: 'ftSheetDialog',
            className: 'ft-sheet-dialog',
            title: 'Blank family tree',
            copy: 'An empty tree to fill in by hand, for a school project or a family reunion.'
        });
        if (!dialog) return;
        FT.resetActions(dialog);
        FT.action(dialog, 'Close', 'btn-secondary', function () { FT.close(dialog); });
        FT.action(dialog, 'Print', 'btn-primary', printSheet);
        FT.action(dialog, 'Preview', 'btn-secondary', openPreview);
        FT.open(dialog);
        render();
    }

    function mount() {
        FT.ensureStylesheet('/static/feat-worksheet.css');
        dialog = FT.dialog({
            id: 'ftSheetDialog',
            className: 'ft-sheet-dialog',
            title: 'Blank family tree',
            copy: 'An empty tree to fill in by hand, for a school project or a family reunion.'
        });
        if (!dialog) return;

        FT.registerTool({
            id: 'worksheet',
            title: 'Blank worksheet',
            description: 'Print an empty family tree to fill in by hand.',
            icon: 'i-poster',
            open: openDialog
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
})();
