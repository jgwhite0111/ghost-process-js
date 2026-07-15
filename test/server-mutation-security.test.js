const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createApp,
    createMutationGuard,
    getServerConfig,
} = require('../server.js');

const TOKEN = 'correct-editor-token-123';

function invokeGuard(config, headers) {
    const guard = createMutationGuard(config);
    const normalizedHeaders = Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
    );
    const req = {
        get(name) { return normalizedHeaders[name.toLowerCase()]; },
    };
    const result = { nextCalls: 0, statusCode: null, body: null };
    const res = {
        status(code) { result.statusCode = code; return this; },
        json(body) { result.body = body; return this; },
    };
    guard(req, res, () => { result.nextCalls += 1; });
    return result;
}

test('startup configuration defaults to loopback and refuses unprotected non-loopback binds', () => {
    assert.deepEqual(getServerConfig({}), {
        host: '127.0.0.1',
        port: 8765,
        editorToken: '',
        requireEditorToken: false,
    });
    assert.equal(getServerConfig({ HOST: 'localhost' }).requireEditorToken, false);
    assert.equal(getServerConfig({ HOST: '::1' }).requireEditorToken, false);

    assert.throws(
        () => getServerConfig({ HOST: '0.0.0.0' }),
        /Refusing non-loopback HOST "0\.0\.0\.0".*at least 16 characters/,
    );
    assert.throws(
        () => getServerConfig({ HOST: '100.64.0.10', EDITOR_TOKEN: 'too-short' }),
        /EDITOR_TOKEN.*at least 16 characters/,
    );
    assert.throws(
        () => getServerConfig({ HOST: '0.0.0.0', EDITOR_TOKEN: '                ' }),
        /non-whitespace secret/,
    );

    assert.deepEqual(
        getServerConfig({ HOST: '0.0.0.0', PORT: '9876', EDITOR_TOKEN: TOKEN }),
        {
            host: '0.0.0.0',
            port: 9876,
            editorToken: TOKEN,
            requireEditorToken: true,
        },
    );
});

test('all production mutation routes share the same guard middleware', () => {
    const app = createApp(getServerConfig({}));
    const routes = new Map(
        app._router.stack
            .filter((layer) => layer.route)
            .map((layer) => [layer.route.path, layer.route]),
    );
    const storyGuard = routes.get('/api/story').stack[0].handle;
    const inkGuard = routes.get('/api/ink/:path(*)').stack[0].handle;
    const assetsGuard = routes.get('/api/assets').stack[0].handle;

    assert.equal(storyGuard.name, 'guardMutation');
    assert.strictEqual(inkGuard, storyGuard);
    assert.strictEqual(assetsGuard, storyGuard);
    assert.equal(routes.get('/api/story').methods.put, true);
    assert.equal(routes.get('/api/ink/:path(*)').methods.put, true);
    assert.equal(routes.get('/api/assets').methods.post, true);
});

test('mutation guard allows same-origin loopback requests without a token', () => {
    const result = invokeGuard(getServerConfig({}), {
        Host: '127.0.0.1:8765',
        Origin: 'http://127.0.0.1:8765',
    });
    assert.equal(result.nextCalls, 1);
    assert.equal(result.statusCode, null);
});

test('mutation guard rejects cross-origin browser requests on every bind mode', () => {
    for (const config of [
        getServerConfig({}),
        getServerConfig({ HOST: '0.0.0.0', EDITOR_TOKEN: TOKEN }),
    ]) {
        const result = invokeGuard(config, {
            Host: '100.64.0.10:8765',
            Origin: 'https://attacker.example',
            'X-Editor-Token': TOKEN,
        });
        assert.equal(result.nextCalls, 0);
        assert.equal(result.statusCode, 403);
        assert.deepEqual(result.body, { error: 'Request Origin does not match the request Host' });
        assert.equal(JSON.stringify(result.body).includes(TOKEN), false);
    }
});

test('non-loopback mutation guard rejects missing/wrong tokens and allows the exact token', () => {
    const config = getServerConfig({ HOST: '0.0.0.0', EDITOR_TOKEN: TOKEN });
    const baseHeaders = {
        Host: '100.64.0.10:8765',
        Origin: 'http://100.64.0.10:8765',
    };

    for (const supplied of [undefined, 'incorrect-editor-token-1']) {
        const headers = { ...baseHeaders };
        if (supplied !== undefined) headers['X-Editor-Token'] = supplied;
        const result = invokeGuard(config, headers);
        assert.equal(result.nextCalls, 0);
        assert.equal(result.statusCode, 401);
        assert.deepEqual(result.body, { error: 'Missing or invalid editor token' });
        assert.equal(JSON.stringify(result.body).includes(TOKEN), false);
    }

    const accepted = invokeGuard(config, {
        ...baseHeaders,
        'X-Editor-Token': TOKEN,
    });
    assert.equal(accepted.nextCalls, 1);
    assert.equal(accepted.statusCode, null);
});
