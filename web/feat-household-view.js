// Feature module: the household layout.
//
// The other layouts place people by generation. This one groups a person with
// their partner and their children, the way a family actually lives.

(function () {
    'use strict';

    var FT = window.FT;
    var dialog = null;

    var PARTNER_GAP = 180;
    var ROW_GAP = 190;
    var BLOCK_GAP = 120;
    var PAD = 80;
    var PER_ROW = 4;

    // --- reading the tree ---

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

    // A household: the partners, and the children of any of them.
    function households() {
        var people = FT.people();
        var byId = {};
        people.forEach(function (person) { byId[person.id] = person; });

        // Partners are grouped, so two people with a child but no recorded
        // spouse still end up in one household.
        var group = {};
        people.forEach(function (person) { group[person.id] = person.id; });
        function find(id) {
            while (group[id] !== id) { group[id] = group[group[id]]; id = group[id]; }
            return id;
        }
        function union(a, b) {
            var ra = find(a), rb = find(b);
            if (ra !== rb) group[ra] = rb;
        }

        var parents = {};
        var children = {};
        FT.relations().forEach(function (rel) {
            var relation = String(rel.relation || '').toLowerCase();
            if (relation === 'spouse' || relation === 'spouse-divorced') {
                if (byId[rel.person1_id] && byId[rel.person2_id]) union(rel.person1_id, rel.person2_id);
                return;
            }
            var edge = parentChild(rel);
            if (!edge || !byId[edge.parent] || !byId[edge.child]) return;
            (children[edge.parent] = children[edge.parent] || []).push(edge.child);
            (parents[edge.child] = parents[edge.child] || []).push(edge.parent);
        });

        // One household per partner group, plus the children.
        var houses = {};
        people.forEach(function (person) {
            var key = find(person.id);
            if (!houses[key]) houses[key] = { partners: [], children: [] };
            houses[key].partners.push(person.id);
        });
        Object.keys(children).forEach(function (parentId) {
            var key = find(Number(parentId));
            if (!houses[key]) houses[key] = { partners: [], children: [] };
            children[parentId].forEach(function (childId) {
                if (houses[key].children.indexOf(childId) < 0) houses[key].children.push(childId);
            });
        });
        Object.keys(parents).forEach(function (childId) {
            var parentsOf = parents[childId];
            var key = find(Number(parentsOf[0]));
            // A child whose parents are in another household belongs to that
            // household, not to one of their own.
            if (houses[key] && houses[key].children.indexOf(Number(childId)) < 0) {
                houses[key].children.push(Number(childId));
            }
        });

        var list = Object.keys(houses).map(function (key) { return houses[key]; });

        // The generation of a household is how far it sits from the top.
        var houseOf = {};
        list.forEach(function (house, index) {
            house.index = index;
            house.partners.forEach(function (id) { houseOf[id] = index; });
            house.children.forEach(function (id) { houseOf[id] = index; });
        });
        list.forEach(function (house) {
            var depth = 0;
            house.children.forEach(function (childId) {
                (parents[childId] || []).forEach(function (parentId) {
                    if (houseOf[parentId] !== undefined && houseOf[parentId] !== house.index) {
                        depth = Math.max(depth, list[houseOf[parentId]].depth + 1);
                    }
                });
            });
            house.depth = depth;
        });
        // The depth of a household depends on the depth of its parents, so
        // one more pass settles the order.
        for (var pass = 0; pass < 4; pass++) {
            list.forEach(function (house) {
                var depth = 0;
                house.children.forEach(function (childId) {
                    (parents[childId] || []).forEach(function (parentId) {
                        if (houseOf[parentId] !== undefined && houseOf[parentId] !== house.index) {
                            depth = Math.max(depth, list[houseOf[parentId]].depth + 1);
                        }
                    });
                });
                house.depth = depth;
            });
        }
        return list;
    }

    // --- the layout ---

    function positions() {
        var list = households();
        var byDepth = {};
        list.forEach(function (house) {
            (byDepth[house.depth] = byDepth[house.depth] || []).push(house);
        });

        var placed = {};
        var x = PAD;
        Object.keys(byDepth).map(Number).sort(function (a, b) { return a - b; }).forEach(function (depth) {
            var row = byDepth[depth];
            row.forEach(function (house) {
                var partnerCount = house.partners.length;
                var childRows = Math.ceil(house.children.length / PER_ROW);
                var blockWidth = Math.max(partnerCount * PARTNER_GAP, PER_ROW * PARTNER_GAP);

                house.partners.forEach(function (id, index) {
                    placed[id] = { x: x + index * PARTNER_GAP, y: PAD };
                });
                house.children.forEach(function (id, index) {
                    var rowIndex = Math.floor(index / PER_ROW);
                    var inRow = index % PER_ROW;
                    var inThisRow = Math.min(PER_ROW, house.children.length - rowIndex * PER_ROW);
                    var rowWidth = inThisRow * PARTNER_GAP;
                    var offset = (blockWidth - rowWidth) / 2;
                    placed[id] = {
                        x: x + offset + inRow * PARTNER_GAP,
                        y: PAD + (rowIndex + 1) * ROW_GAP
                    };
                });
                x += blockWidth + BLOCK_GAP;
            });
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
                label: 'the household layout',
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
        FT.toast('Re-arranged the tree into households');
    }

    function render() {
        var body = FT.body(dialog);
        var list = households();
        var people = FT.people().length;
        body.innerHTML =
            '<p class="ft-panel-empty">This arrangement puts each partner and their children together, so the ' +
            'tree reads like a set of families rather than a list of generations.</p>' +
            '<p class="ft-panel-empty">' + list.length + ' household(s), ' + people + ' people. ' +
            'Applying it can be undone with Ctrl+Z.</p>' +
            (people ? '' : '<p class="ft-panel-empty">Add a few people first.</p>');
    }

    function openDialog() {
        dialog = FT.dialog({
            id: 'ftHouseholdDialog',
            className: 'ft-household-dialog',
            title: 'Household layout',
            copy: 'Partners and their children, grouped as households.'
        });
        if (!dialog) return;
        if (!document.getElementById('ftHouseholdActions')) {
            FT.action(dialog, 'Close', 'btn-secondary', function () { FT.close(dialog); });
            FT.action(dialog, 'Apply the layout', 'btn-primary', function () {
                if (FT.readOnly()) {
                    FT.toast('This tree is shared read-only', true);
                    return;
                }
                apply().catch(function (err) { FT.toast('Could not arrange the tree: ' + err.message, true); });
            });
        }
        FT.open(dialog);
        render();
    }

    function mount() {
        FT.ensureStylesheet('/static/feat-household-view.css');
        dialog = FT.dialog({
            id: 'ftHouseholdDialog',
            className: 'ft-household-dialog',
            title: 'Household layout',
            copy: 'Partners and their children, grouped as households.'
        });
        if (!dialog) return;

        FT.registerTool({
            id: 'household-view',
            title: 'Household layout',
            description: 'Group partners and their children as households.',
            icon: 'i-users',
            open: openDialog
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
})();
