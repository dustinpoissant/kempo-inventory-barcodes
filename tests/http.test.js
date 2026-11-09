import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql, like } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { user, permission, group, groupPermission, userGroup } from 'kempo/server/db/schema.js';
import { createSession, setSetting } from 'kempo/server/sdk.js';
import { createItem } from 'kempo-inventory/sdk';
import { addCode } from '../server/utils/barcodes.js';
import install from '../install.js';

import configGET from '../public/api/config/GET.js';
import lookupGET from '../public/api/lookup/GET.js';
import itemCodesGET from '../public/api/items/[id]/barcodes/GET.js';
import itemCodesPOST from '../public/api/items/[id]/barcodes/POST.js';
import barcodePATCH from '../public/api/barcodes/[id]/PATCH.js';
import barcodeDELETE from '../public/api/barcodes/[id]/DELETE.js';
import mergePOST from '../public/api/merge/POST.js';
import importSkusPOST from '../public/api/import-skus/POST.js';
import sheetsGET from '../public/api/sheets/GET.js';
import sheetsPOST from '../public/api/sheets/POST.js';
import sheetGET from '../public/api/sheets/[id]/GET.js';
import sheetPATCH from '../public/api/sheets/[id]/PATCH.js';
import sheetDELETE from '../public/api/sheets/[id]/DELETE.js';
import entriesPOST from '../public/api/sheets/[id]/entries/POST.js';
import entryPATCH from '../public/api/sheets/[id]/entries/[entryId]/PATCH.js';
import entryDELETE from '../public/api/sheets/[id]/entries/[entryId]/DELETE.js';
import printGET from '../public/print/[id]/GET.js';

/*
  The HTTP layer: who may call each route. People, groups and sessions are real rows, made from the
  permissions and groups kempo-inventory and this extension declare, and the route handlers are called the
  way kempo-server calls them. Like data-layer.test.js it needs a throwaway database.
*/
const url = process.env.DATABASE_URL ?? '';
const unitTier = process.env.KEMPO_DB === 'pglite';
const reachable = (unitTier || /_test$/.test(url.split('?')[0])) && await db.execute(sql`select 1`).then(() => true).catch(() => false);

if(!reachable && process.env.KEMPO_TEST_TIER === 'integration'){
  throw new Error('The integration tier needs DATABASE_URL pointing at a throwaway Postgres named *_test with the schema applied.');
}

const root = join(import.meta.dirname, '..');
const declared = file => JSON.parse(readFileSync(file, 'utf8'));

const ok = ([error, value]) => {
  assert.equal(error, null, error?.msg);
  return value;
};

/* Calls a route handler the way kempo-server does and returns what it answered. */
const call = async (handler, { method = 'GET', params = {}, query = {}, body = null, cookies = {} } = {}) => {
  const out = { status: 200, json: undefined, text: undefined, headers: {} };
  const response = {
    status(code){ out.status = code; return response; },
    json(data){ out.json = data; return response; },
    setHeader(name, value){ out.headers[name] = value; return response; },
    end(text){ out.text = text; return response; },
  };
  await handler({ method, params, query, body, cookies }, response);
  return out;
};

const PREFIX = 'barcode-test-user-';

/* A signed-in person in the named groups. */
const person = async (...groups) => {
  const id = `${PREFIX}${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date();
  await db.insert(user).values({ id, email: `${id}@example.test`, name: id, passwordHash: 'x', emailVerified: true, createdAt: now, updatedAt: now });
  for(const groupName of groups) await db.insert(userGroup).values({ id: crypto.randomUUID(), userId: id, groupName, createdAt: now });
  const [error, created] = await createSession(id);
  assert.equal(error, null);
  return { id, cookies: { session_token: created.sessionToken } };
};

const declareGroups = async () => {
  const now = new Date();
  /* Every signed-in person is in this group; kempo cannot work out anyone's permissions without it. */
  await db.insert(group).values({ name: 'system:Users', description: 'Everyone signed in', owner: 'system', createdAt: now }).onConflictDoNothing();
  for(const config of [declared(join(root, 'node_modules/kempo-inventory/kempo-config.json')), declared(join(root, 'kempo-config.json'))]){
    for(const { name, description } of config.permissions ?? []) await db.insert(permission).values({ name, description, owner: 'test', createdAt: now }).onConflictDoNothing();
    for(const { name, description, permissions = [] } of config.groups ?? []){
      await db.insert(permission).values({ name: 'system:admin:access', description: 'admin', owner: 'test', createdAt: now }).onConflictDoNothing();
      await db.insert(group).values({ name, description, owner: 'test', createdAt: now }).onConflictDoNothing();
      for(const permissionName of permissions) await db.insert(groupPermission).values({ id: crypto.randomUUID(), groupName: name, permissionName, createdAt: now }).onConflictDoNothing();
    }
  }
};

const purge = async () => {
  for(const name of ['kempoInventoryBarcodeSheetEntry', 'kempoInventoryBarcodeSheet', 'kempoInventoryBarcodeCounter', 'kempoInventoryBarcode', 'kempoInventoryMovement', 'kempoInventoryItem']){
    await db.execute(sql.raw(`delete from "${name}"`));
  }
  await db.execute(sql.raw(`delete from "session" where "userId" like '${PREFIX}%'`));
  await db.execute(sql.raw(`delete from "userGroup" where "userId" like '${PREFIX}%'`));
  await db.delete(user).where(like(user.id, `${PREFIX}%`));
};

after(() => unitTier ? db.$client.close() : db.$client.end());

describe('http', { skip: reachable ? false : 'no throwaway database (set DATABASE_URL to one ending in _test)' }, () => {
  let viewer;
  let manager;
  let admin;
  let nobody;
  let gray;

  before(async () => {
    await install();
    await purge();
    await declareGroups();
    viewer = await person('kempo-inventory:viewer');
    manager = await person('kempo-inventory:manager');
    admin = await person('kempo-inventory:viewer', 'kempo-inventory-barcodes:admin');
    nobody = await person();
    gray = ok(await createItem({ sku: 'FIL-1', name: 'Gray', quantity: 4 }));
  });

  after(purge);

  test('a signed-out caller gets 401 from every route, and the print page says to sign in', async () => {
    const attempts = [
      [configGET, {}], [lookupGET, { query: { code: 'x' } }], [itemCodesGET, { params: { id: gray.id } }], [itemCodesPOST, { method: 'POST', params: { id: gray.id }, body: { generate: true } }],
      [barcodePATCH, { method: 'PATCH', params: { id: 'x' }, body: { primary: true } }], [barcodeDELETE, { method: 'DELETE', params: { id: 'x' } }],
      [mergePOST, { method: 'POST', body: {} }], [importSkusPOST, { method: 'POST' }], [sheetsGET, {}], [sheetsPOST, { method: 'POST', body: {} }],
      [sheetGET, { params: { id: 'x' } }], [sheetPATCH, { method: 'PATCH', params: { id: 'x' }, body: { name: 'n' } }], [sheetDELETE, { method: 'DELETE', params: { id: 'x' } }],
      [entriesPOST, { method: 'POST', params: { id: 'x' }, body: {} }], [entryPATCH, { method: 'PATCH', params: { id: 'x', entryId: 'y' }, body: {} }], [entryDELETE, { method: 'DELETE', params: { id: 'x', entryId: 'y' } }],
    ];
    for(const [handler, options] of attempts){
      const answer = await call(handler, options);
      assert.equal(answer.status, 401, `${handler.name || 'a route'} answered ${answer.status}`);
    }
    const page = await call(printGET, { params: { id: 'x' } });
    assert.equal(page.status, 401);
    assert.match(page.text, /Sign in/);
  });

  test('someone with no inventory permission is refused, since they may not read the inventory', async () => {
    assert.equal((await call(sheetsGET, { cookies: nobody.cookies })).status, 403);
    assert.equal((await call(lookupGET, { cookies: nobody.cookies, query: { code: 'x' } })).status, 403);
    assert.equal((await call(printGET, { cookies: nobody.cookies, params: { id: 'x' } })).status, 403);
  });

  describe('a viewer', () => {
    test('can read codes and look a scan up, but sees no stock count', async () => {
      const added = ok(await addCode({ itemId: gray.id, code: '036000291452' }));
      const found = await call(lookupGET, { cookies: viewer.cookies, query: { code: '0036000291452' } });
      assert.equal(found.status, 200);
      assert.equal(found.json.item.id, gray.id);
      assert.equal(found.json.item.quantity, undefined);
      assert.equal(found.json.barcode.id, added.barcode.id);
      assert.equal(found.json.barcode.lookup, undefined);
      assert.equal((await call(lookupGET, { cookies: viewer.cookies, query: { code: '999' } })).status, 404);
      const codes = await call(itemCodesGET, { cookies: viewer.cookies, params: { id: gray.id } });
      assert.equal(codes.json.codes.length, 1);
      assert.equal((await call(configGET, { cookies: viewer.cookies })).json.grid.perPage, 30);
    });

    test('cannot change codes, merge items or adopt SKUs', async () => {
      assert.equal((await call(itemCodesPOST, { method: 'POST', cookies: viewer.cookies, params: { id: gray.id }, body: { generate: true } })).status, 403);
      assert.equal((await call(itemCodesPOST, { method: 'POST', cookies: viewer.cookies, params: { id: gray.id }, body: { code: 'abc' } })).status, 403);
      assert.equal((await call(barcodePATCH, { method: 'PATCH', cookies: viewer.cookies, params: { id: 'x' }, body: { primary: true } })).status, 403);
      assert.equal((await call(barcodeDELETE, { method: 'DELETE', cookies: viewer.cookies, params: { id: 'x' } })).status, 403);
      assert.equal((await call(mergePOST, { method: 'POST', cookies: viewer.cookies, body: { fromId: gray.id, intoId: gray.id } })).status, 403);
      assert.equal((await call(importSkusPOST, { method: 'POST', cookies: viewer.cookies })).status, 403);
    });

    test('can make and use their own sheet, and print it', async () => {
      const made = await call(sheetsPOST, { method: 'POST', cookies: viewer.cookies, body: { name: 'Mine' } });
      assert.equal(made.status, 201);
      const id = made.json.sheet.id;

      const added = await call(entriesPOST, { method: 'POST', cookies: viewer.cookies, params: { id }, body: { itemId: gray.id, quantity: 3 } });
      assert.equal(added.status, 201);
      assert.equal(added.json.entries[0].code, '036000291452');
      assert.equal(added.json.summary.labels, 3);

      const entryId = added.json.entries[0].id;
      const changed = await call(entryPATCH, { method: 'PATCH', cookies: viewer.cookies, params: { id, entryId }, body: { quantity: 6, showText: false } });
      assert.deepEqual([changed.json.entries[0].quantity, changed.json.entries[0].showText], [6, false]);
      assert.equal((await call(sheetPATCH, { method: 'PATCH', cookies: viewer.cookies, params: { id }, body: { name: 'Renamed' } })).status, 200);

      const printed = await call(printGET, { cookies: viewer.cookies, params: { id } });
      assert.equal(printed.status, 200);
      assert.match(printed.headers['Content-Type'], /text\/html/);
      assert.equal(printed.text.match(/class="label"/g).length, 6);
      assert.ok(printed.text.includes('Renamed'));

      assert.equal((await call(entryDELETE, { method: 'DELETE', cookies: viewer.cookies, params: { id, entryId } })).json.entries.length, 0);
      assert.equal((await call(sheetsGET, { cookies: viewer.cookies })).json.sheets.length, 1);
    });

    test('cannot list everyone\'s sheets, and nobody else can see theirs', async () => {
      assert.equal((await call(sheetsGET, { cookies: viewer.cookies, query: { all: 'true' } })).status, 403);
      const mine = (await call(sheetsGET, { cookies: viewer.cookies })).json.sheets[0].id;
      const other = await call(sheetGET, { cookies: manager.cookies, params: { id: mine } });
      assert.equal(other.status, 404);
      assert.equal((await call(sheetDELETE, { method: 'DELETE', cookies: manager.cookies, params: { id: mine } })).status, 404);
      assert.equal((await call(entriesPOST, { method: 'POST', cookies: manager.cookies, params: { id: mine }, body: { itemId: gray.id } })).status, 404);
      const page = await call(printGET, { cookies: manager.cookies, params: { id: mine } });
      assert.equal(page.status, 404);
      assert.match(page.text, /Sheet not found/);
    });
  });

  describe('a manager', () => {
    test('can make up a code, add a real one, change the primary and remove a code', async () => {
      const made = await call(itemCodesPOST, { method: 'POST', cookies: manager.cookies, params: { id: gray.id }, body: { generate: true } });
      assert.equal(made.status, 201);
      assert.equal(made.json.barcode.kind, 'internal');

      const real = await call(itemCodesPOST, { method: 'POST', cookies: manager.cookies, params: { id: gray.id }, body: { code: '4006381333931' } });
      assert.equal(real.status, 201);
      assert.equal((await call(barcodePATCH, { method: 'PATCH', cookies: manager.cookies, params: { id: real.json.barcode.id }, body: { primary: true } })).status, 200);
      assert.equal((await call(barcodePATCH, { method: 'PATCH', cookies: manager.cookies, params: { id: real.json.barcode.id }, body: {} })).status, 400);
      assert.equal((await call(barcodeDELETE, { method: 'DELETE', cookies: manager.cookies, params: { id: made.json.barcode.id } })).status, 200);
    });

    test('is told about a mistyped code and a code that belongs to another item', async () => {
      const other = ok(await createItem({ sku: 'FIL-2', name: 'Other' }));
      const mistyped = await call(itemCodesPOST, { method: 'POST', cookies: manager.cookies, params: { id: other.id }, body: { code: '036000291453' } });
      assert.equal(mistyped.status, 400);
      assert.equal(mistyped.json.mistyped, true);
      const conflict = await call(itemCodesPOST, { method: 'POST', cookies: manager.cookies, params: { id: other.id }, body: { code: '036000291452' } });
      assert.equal(conflict.status, 409);
      assert.equal(conflict.json.conflictItemId, gray.id);
    });

    test('can merge two items, but not adopt SKUs', async () => {
      const dup = ok(await createItem({ sku: 'DUP', name: 'Duplicate', quantity: 1 }));
      const merged = await call(mergePOST, { method: 'POST', cookies: manager.cookies, body: { fromId: dup.id, intoId: gray.id } });
      assert.equal(merged.status, 200);
      assert.equal(merged.json.removed, true);
      assert.equal((await call(importSkusPOST, { method: 'POST', cookies: manager.cookies })).status, 403);
    });
  });

  describe('a barcodes administrator', () => {
    test('can adopt SKUs, list everyone\'s sheets, and open and delete any of them', async () => {
      /* Its SKU is a code that another item (gray) already holds, so it is reported as a likely duplicate. */
      const duplicate = ok(await createItem({ sku: '4006381333931', name: 'Has a UPC as its SKU' }));
      const adopted = await call(importSkusPOST, { method: 'POST', cookies: admin.cookies });
      assert.equal(adopted.status, 200);
      assert.deepEqual(adopted.json.conflicts.map(item => item.id), [duplicate.id]);

      const all = await call(sheetsGET, { cookies: admin.cookies, query: { all: 'true' } });
      assert.equal(all.status, 200);
      assert.equal(all.json.sheets.length, 1);
      assert.ok(all.json.sheets[0].owner);

      const id = all.json.sheets[0].id;
      assert.equal((await call(sheetGET, { cookies: admin.cookies, params: { id } })).status, 200);
      assert.equal((await call(printGET, { cookies: admin.cookies, params: { id } })).status, 200);
      assert.equal((await call(sheetDELETE, { method: 'DELETE', cookies: admin.cookies, params: { id } })).status, 200);
      assert.equal((await call(sheetsGET, { cookies: admin.cookies, query: { all: 'true' } })).json.sheets.length, 0);
    });

    test('holds the manage permission and nothing of the inventory\'s beyond reading, so cannot change codes', async () => {
      assert.equal((await call(itemCodesPOST, { method: 'POST', cookies: admin.cookies, params: { id: gray.id }, body: { generate: true } })).status, 403);
    });
  });

  describe('with the inventory open to the public', () => {
    before(() => setSetting('kempo-inventory', 'public_read', true, 'boolean', false, null));
    after(() => setSetting('kempo-inventory', 'public_read', false, 'boolean', false, null));

    test('a signed-out visitor can look a scan up and read codes, never sees a count, and still cannot use sheets', async () => {
      const found = await call(lookupGET, { query: { code: '036000291452' } });
      assert.equal(found.status, 200);
      assert.equal(found.json.item.id, gray.id);
      assert.equal(found.json.item.quantity, undefined);
      assert.equal((await call(itemCodesGET, { params: { id: gray.id } })).status, 200);
      assert.equal((await call(sheetsGET, {})).status, 401);
      assert.equal((await call(itemCodesPOST, { method: 'POST', params: { id: gray.id }, body: { generate: true } })).status, 403);
    });

    test('someone signed in with no inventory permission may use sheets', async () => {
      assert.equal((await call(sheetsPOST, { method: 'POST', cookies: nobody.cookies, body: {} })).status, 201);
    });
  });
});
