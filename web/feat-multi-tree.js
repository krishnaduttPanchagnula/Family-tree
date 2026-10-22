// Feature module: family lines on one canvas.
//
// A family is often several lines that are not connected: a maternal side, a
// paternal side, a partner's family. This keeps them apart in named columns
// instead of letting them scatter across the canvas.

(function () {
    'use strict';

    var FT = window.FT;
    var dialog = null;

    var COLUMNS = 3;
    var GAP_X = 180;
    var GAP_Y = 190;
    var COLUMN_GAP = 260;
    var PAD = 80;

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

    // The connected pieces of the tree.
    function lines() {
        var people = FT.people();
        var parent = {};
        people.forEach(function (person) { parent[person.id] = person.id; });
        function find(id) {
            while (parent[id] !== id) { parent[id] = parent[parent[id]]; id = parent[id]; }
            return id;
        }
        function union(a, b) {
            var ra = find(a), rb = find(b);
            if (ra !== rb) parent[ra] = rb;
        }

        var parentsOf = {};
        var childOf = {};
        FT.relations().forEach(function (rel) {
            if (!find(rel.person1_id) || !find(rel.person2_id)) return;
            union(rel.person1_id, rel.person2_id);
            var edge = parentChild(rel);
            if (!edge) return;
            (parentsOf[edge.child] = parentsOf[edge.child] || []).push(edge.parent);
            (childOf[edge.parent] = childOf[edge.parent] || []).push(edge.child);
        });

        var groups = {};
        people.forEach(function (person) {
            var key = find(person.id);
            (groups[key] = groups[key] || []).push(person);
        });

        var byId = {};
        people.forEach(function (person) { byId[person.id] = person; });

        return Object.keys(groups).map(function (key) {
            var members = groups[key];
            var depth = {};
            members.forEach(function (person) { depth[person.id] = 0; });
            // The depth of a person is how many steps of parents they are
            // from the top of their line.
            for (var pass = 0; pass < 8; pass++) {
                members.forEach(function (person) {
                    (parentsOf[person.id] || []).forEach(function (parentId) {
                        if (depth[parentId] === undefined) return;
                        depth[person.id] = Math.max(depth[person.id], depth[parentId] + 1);
                    });
                });
            }
            var surnames = {};
            var earliest = null;
            members.forEach(function (person) {
                var parts = String(person.name || '').trim().split(/\s+/);
                var surname = parts.length > 1 ? parts[parts.length - 1] : (parts[0] || 'Unknown');
                surnames[surname] = (surnames[surname] || 0) + 1;
                var year = Number(String(person.dob || '').slice(0, 4));
                if (year && (!earliest || year < earliest)) earliest = year;
            });
            var best = '';
            var bestCount = 0;
            Object.keys(surnames).forEach(function (surname) {
                if (surnames[surname] > bestCount) { best = surname; bestCount = surnames[surname]; }
            });
            return {
                members: members,
                depth: depth,
                surname: best,
                earliest: earliest,
                name: best
            };
        }).sort(function (a, b) {
            if (b.members.length !== a.members.length) return b.members.length - a.members.length;
            return a.name.localeCompare(b.name);
        });
    }

    function nameOf(line, index) {
        var name = line.surname || 'Family line ' + (index + 1);
        if (line.earliest) name += ' (b. ' + line.earliest + ')';
        return name;
    }

    function positions() {
        var list = lines();
        var placed = {};
        var x = PAD;

        list.forEach(function (line, index) {
            var ordered = line.members.slice().sort(function (a, b) {
                var depthA = line.depth[a.id] || 0;
                var depthB = line.depth[b.id] || 0;
                if (depthA !== depthB) return depthA - depthB;
                return String(a.name).localeCompare(String(b.name));
            });
            ordered.forEach(function (person, position) {
                var column = position % COLUMNS;
                var row = Math.floor(position / COLUMNS);
                placed[person.id] = { x: x + column * GAP_X, y: PAD + row * GAP_Y };
            });
            var rows = Math.ceil(ordered.length / COLUMNS);
            var height = rows * GAP_Y;
            void height;
            x += COLUMNS * GAP_X + COLUMN_GAP;
        });
        return placed;
    }

    async function apply() {
        var placed = positions();
        var snapshot = FT.people().map(function (person) {
            return { id: person.id, pos_x: person.pos_x || 0, pos_y: person.pos_y || 0 };
        });

        var changed = [];
        FT.people().forEach(function (person) {
            var spot = placed[person.id];
            if (!spot) return;
            if (person.pos_x === spot.x && person.pos_y === spot.y) return;
            person.pos_x = spot.x;
            person.pos_y = spot.y;
            changed.push({ id: person.id, pos_x: spot.x, pos_y: spot.y });
        });

        if (typeof pushUndo === 'function') {
            pushUndo({
                label: 'the family lines',
                run: async function () {
                    await Promise.all(snapshot.map(function (point) { return savePersonPosition(point); }));
                    await loadTree();
                    centerTree();
                }
            });
        }

        if (changed.length) {
            var responses = await Promise.all(changed.map(function (point) { return savePersonPosition(point); }));
            var failed = responses.find(function (res) { return !res.ok; });
            if (failed) throw new Error((await failed.text()) || 'could not save a position');
        }
        await loadTree();
        centerTree();
    }

    function render() {
        var body = FT.body(dialog);
        var list = lines();
        if (!list.length) {
            body.innerHTML = '<p class="ft-panel-empty">Add some people first.</p>';
            return;
        }
        if (list.length < 2) {
            body.innerHTML = '<p class="ft-panel-empty">Everyone is already connected, so there is only one line. ' +
                'Add somebody from another side of the family to see two.</p>';
            return;
        }
        body.innerHTML =
            '<p class="ft-panel-empty">Each line gets its own column, biggest first.</p>' +
            '<ul class="ft-line-list">' + list.map(function (line, index) {
                return '<li class="ft-line">' +
                    '<span class="ft-line-name">' + FT.esc(nameOf(line, index)) + '</span>' +
                    '<span class="ft-line-count">' + line.members.length + ' people</span>' +
                    '</li>';
            }).join('') + '</ul>';
    }

    function openDialog() {
        dialog = FT.dialog({
            id: 'ftLinesDialog',
            className: 'ft-lines-dialog',
            title: 'Family lines',
            copy: 'The separate branches of the tree, side by side.'
        });
        if (!dialog) return;
        if (!document.getElementById('ftLinesActions')) {
            FT.action(dialog, 'Close', 'btn-secondary', function () { FT.close(dialog); });
            FT.action(dialog, 'Arrange the lines', 'btn-primary', function () {
                if (FT.readOnly()) {
                    FT.toast('This tree is shared read-only', true);
                    return;
                }
                apply().then(function () {
                    FT.toast('Arranged the family lines');
                    render();
                }).catch(function (err) { FT.toast('Could not arrange the lines: ' + err.message, true); });
            });
        }
        FT.open(dialog);
        render();
    }

    function mount() {
        FT.ensureStylesheet('/static/feat-multi-tree.css');
        dialog = FT.dialog({
            id: 'ftLinesDialog',
            className: 'ft-lines-dialog',
            title: 'Family lines',
            copy: 'The separate branches of the tree, side by side.'
        });
        if (!dialog) return;

        FT.registerTool({
            id: 'multi-tree',
            title: 'Family lines',
            description: 'Keep the separate branches of the tree in their own columns.',
            icon: 'i-tree',
            open: openDialog
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
})();
