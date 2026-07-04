// editor.js — browser-based authoring UI for story.json + .ink files
//
// Loads story.json from /api/story, lets you edit scenes/items/recipes,
// upload assets, edit Ink source. Saves via PUT /api/story + PUT /api/ink.

(async () => {
    'use strict';

    const statusEl = document.getElementById('status');
    let story = null;
    let selectedSceneId = null;
    let selectedItemId = null;

    function setStatus(msg, isError) {
        statusEl.textContent = msg;
        statusEl.style.color = isError ? '#e85a5a' : '#d4a045';
    }

    // ---- Load ----
    async function loadStory() {
        try {
            const res = await fetch('/api/story', { cache: 'no-cache' });
            story = await res.json();
            renderSidebar();
            setStatus('Loaded story.json');
        } catch (err) {
            setStatus(`Failed to load story.json: ${err.message}`, true);
        }
    }

    // ---- Sidebar ----
    function renderSidebar() {
        const sceneList = document.getElementById('scene-list');
        sceneList.innerHTML = '';
        for (const id of Object.keys(story.scenes)) {
            const li = document.createElement('li');
            li.textContent = id;
            li.className = id === selectedSceneId ? 'selected' : '';
            li.onclick = () => { selectedSceneId = id; renderSidebar(); showSceneEditor(id); };
            sceneList.appendChild(li);
        }

        const itemList = document.getElementById('item-list');
        itemList.innerHTML = '';
        for (const id of Object.keys(story.items || {})) {
            const li = document.createElement('li');
            li.textContent = id;
            li.className = id === selectedItemId ? 'selected' : '';
            li.onclick = () => { selectedItemId = id; renderSidebar(); showItemEditor(id); };
            itemList.appendChild(li);
        }

        const recipeList = document.getElementById('recipe-list');
        recipeList.innerHTML = '';
        for (let i = 0; i < (story.recipes || []).length; i++) {
            const r = story.recipes[i];
            const li = document.createElement('li');
            li.textContent = `${r.input.join(' + ')} → ${r.output}`;
            recipeList.appendChild(li);
        }
    }

    function hideAll() {
        document.getElementById('welcome').hidden = false;
        document.getElementById('scene-editor').hidden = true;
        document.getElementById('item-editor').hidden = true;
        document.getElementById('ink-editor').hidden = true;
    }

    // ---- Scene editor ----
    function showSceneEditor(id) {
        hideAll();
        document.getElementById('welcome').hidden = true;
        const editor = document.getElementById('scene-editor');
        editor.hidden = false;
        document.getElementById('scene-editor-id').textContent = id;

        const sc = story.scenes[id];
        document.getElementById('scene-id').value = id;
        document.getElementById('scene-kind').value = sc.kind || 'ink';
        document.getElementById('scene-bg').value = sc.bg || '';
        document.getElementById('scene-music').value = sc.music || '';
        document.getElementById('scene-ink').value = sc.ink || '';
        document.getElementById('scene-start-node').value = sc.start_node || 'Start';
        document.getElementById('scene-hitboxes').value = JSON.stringify(sc.hitboxes || [], null, 2);

        // Add Ink-edit button (loads .ink file into a separate panel).
        let inkBtn = document.getElementById('edit-ink-btn');
        if (!inkBtn) {
            inkBtn = document.createElement('button');
            inkBtn.id = 'edit-ink-btn';
            inkBtn.textContent = 'Edit .ink source';
            inkBtn.style.cssText = 'margin-top:1em;background:#3a4a7a;color:white;border:none;padding:0.5em 1em;cursor:pointer;';
            inkBtn.onclick = () => editInkFile(sc.ink);
            editor.appendChild(inkBtn);
        }
    }

    function editInkFile(path) {
        if (!path) {
            setStatus('No ink file specified for this scene', true);
            return;
        }
        hideAll();
        document.getElementById('welcome').hidden = true;
        const editor = document.getElementById('ink-editor');
        editor.hidden = false;
        document.getElementById('ink-editor-path').textContent = path;

        fetch(`/api/ink/${encodeURIComponent(path)}`).then(r => r.text()).then(text => {
            document.getElementById('ink-text').value = text;
        }).catch(err => {
            document.getElementById('ink-text').value = `// Failed to load ${path}: ${err.message}`;
        });
    }

    function saveInkFile() {
        const path = document.getElementById('ink-editor-path').textContent;
        const text = document.getElementById('ink-text').value;
        fetch(`/api/ink/${encodeURIComponent(path)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'text/plain' },
            body: text
        }).then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            setStatus(`Saved ${path}`);
        }).catch(err => setStatus(`Save failed: ${err.message}`, true));
    }

    // ---- Item editor ----
    function showItemEditor(id) {
        hideAll();
        document.getElementById('welcome').hidden = true;
        document.getElementById('item-editor').hidden = false;
        document.getElementById('item-editor-id').textContent = id;

        const item = story.items[id];
        document.getElementById('item-id').value = id;
        document.getElementById('item-name').value = item.name || '';
        document.getElementById('item-icon').value = item.icon || '';
        document.getElementById('item-key').checked = !!item.key;
    }

    // ---- Save ----
    async function saveStory() {
        // Pull form values back into the story object.
        if (selectedSceneId) {
            const sc = story.scenes[selectedSceneId];
            const newId = document.getElementById('scene-id').value;
            if (newId !== selectedSceneId) {
                if (story.scenes[newId]) {
                    setStatus(`Scene "${newId}" already exists`, true);
                    return;
                }
                story.scenes[newId] = sc;
                delete story.scenes[selectedSceneId];
                selectedSceneId = newId;
                renderSidebar();
            }
            sc.kind = document.getElementById('scene-kind').value;
            sc.bg = document.getElementById('scene-bg').value;
            sc.music = document.getElementById('scene-music').value;
            sc.ink = document.getElementById('scene-ink').value;
            sc.start_node = document.getElementById('scene-start-node').value;
            try {
                sc.hitboxes = JSON.parse(document.getElementById('scene-hitboxes').value);
            } catch (e) {
                setStatus(`Invalid hitboxes JSON: ${e.message}`, true);
                return;
            }
        }
        if (selectedItemId) {
            const item = story.items[selectedItemId];
            const newId = document.getElementById('item-id').value;
            if (newId !== selectedItemId) {
                if (story.items[newId]) {
                    setStatus(`Item "${newId}" already exists`, true);
                    return;
                }
                story.items[newId] = item;
                delete story.items[selectedItemId];
                selectedItemId = newId;
                renderSidebar();
            }
            item.name = document.getElementById('item-name').value;
            item.icon = document.getElementById('item-icon').value;
            item.key = document.getElementById('item-key').checked;
        }

        try {
            const res = await fetch('/api/story', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(story, null, 2)
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || `HTTP ${res.status}`);
            }
            setStatus('Saved.');
        } catch (err) {
            setStatus(`Save failed: ${err.message}`, true);
        }
    }

    // ---- New scene/item/recipe ----
    function newScene() {
        const id = prompt('New scene id (e.g. "terminal"):');
        if (!id) return;
        if (story.scenes[id]) {
            setStatus(`Scene "${id}" already exists`, true);
            return;
        }
        story.scenes[id] = {
            id, kind: 'ink', bg: '', music: '', ink: '', start_node: 'Start',
            characters: [], hitboxes: []
        };
        selectedSceneId = id;
        renderSidebar();
        showSceneEditor(id);
    }

    function newItem() {
        const id = prompt('New item id (e.g. "rusty_key"):');
        if (!id) return;
        if (story.items[id]) {
            setStatus(`Item "${id}" already exists`, true);
            return;
        }
        story.items[id] = { id, name: id, icon: '', key: false };
        selectedItemId = id;
        renderSidebar();
        showItemEditor(id);
    }

    // ---- Upload ----
    function uploadAsset() {
        const file = document.getElementById('upload-file').files[0];
        const name = document.getElementById('upload-name').value;
        if (!file) {
            document.getElementById('upload-result').textContent = 'Choose a file first.';
            return;
        }
        const form = new FormData();
        form.append('file', file);
        if (name) form.append('name', name);
        fetch('/api/assets', { method: 'POST', body: form })
            .then(r => r.json())
            .then(data => {
                document.getElementById('upload-result').textContent = JSON.stringify(data, null, 2);
            })
            .catch(err => {
                document.getElementById('upload-result').textContent = `Upload failed: ${err.message}`;
            });
    }

    // ---- Wire up buttons ----
    document.getElementById('save-btn').onclick = saveStory;
    document.getElementById('reload-btn').onclick = loadStory;
    document.getElementById('new-scene-btn').onclick = newScene;
    document.getElementById('new-item-btn').onclick = newItem;
    document.getElementById('upload-btn').onclick = uploadAsset;
    document.getElementById('save-ink-btn').onclick = saveInkFile;

    await loadStory();
})();