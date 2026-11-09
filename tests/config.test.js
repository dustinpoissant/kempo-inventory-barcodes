import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../server/db/schema.js';

const root = join(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(join(root, 'kempo-config.json'), 'utf8'));
const read = file => readFileSync(join(root, file), 'utf8');

test('every hook the config declares has a handler file', () => {
  for(const file of Object.values(config.hooks)) assert.ok(existsSync(join(root, file)), file);
});

test('the scope is a claim of its own that cannot collide with kempo-inventory\'s', () => {
  assert.equal(config['public-scope'], 'inventory-barcodes');
  assert.ok(!config['public-scope'].startsWith('inventory/'));
});

test('permissions, groups and settings carry the extension\'s name, and groups only hold declared permissions', () => {
  const declared = new Set(['system:admin:access', ...config.permissions.map(permission => permission.name)]);
  for(const permission of config.permissions) assert.match(permission.name, /^kempo-inventory-barcodes:/);
  for(const group of config.groups){
    assert.match(group.name, /^kempo-inventory-barcodes:/);
    for(const name of group.permissions) assert.ok(declared.has(name), `${group.name} holds undeclared ${name}`);
  }
  for(const setting of config.settings){
    assert.match(setting.name, /^[a-z][a-z0-9_]*$/);
    assert.ok(setting.description, `${setting.name} has no description`);
    assert.ok(['string', 'number', 'boolean'].includes(setting.type));
    assert.equal(typeof setting.value, setting.type, `${setting.name} default is not a ${setting.type}`);
  }
});

test('every index the schema declares is also created by install.js, under the same name', () => {
  const install = read('install.js');
  const names = Object.values(schema).flatMap(table => getTableConfig(table).indexes.map(index => index.config.name));
  assert.ok(names.length >= 7);
  for(const name of names) assert.ok(install.includes(`"${name}"`), `install.js does not create ${name}`);
});

test('every table is named with the extension\'s prefix', () => {
  for(const table of Object.values(schema)) assert.match(getTableConfig(table).name, /^kempoInventoryBarcode/);
});

test('the icons the extension points at are shipped', () => {
  const shipped = new Set(readdirSync(join(root, 'public/icons')));
  const used = [...(read('admin/nav.global.html') + read('public/print-sheets.menu-item.html')).matchAll(/\/inventory-barcodes\/icons\/([\w-]+\.svg)/g)].map(match => match[1]);
  for(const component of readdirSync(join(root, 'public/components'))) used.push(...[...read(`public/components/${component}`).matchAll(/\/inventory-barcodes\/icons\/([\w-]+\.svg)/g)].map(match => match[1]));
  assert.ok(used.length >= 3);
  for(const icon of used) assert.ok(shipped.has(icon), icon);
});

test('the package ships everything it needs and nothing it should not', () => {
  const pkg = JSON.parse(read('package.json'));
  for(const folder of ['admin', 'public', 'server', 'hooks']) assert.ok(pkg.files.includes(folder), folder);
  for(const file of ['install.js', 'update.js', 'sdk.js', 'kempo-config.json']) assert.ok(pkg.files.includes(file), file);
  assert.ok(!JSON.stringify(pkg).includes('file:'));
  assert.deepEqual(Object.keys(pkg.peerDependencies).sort(), ['kempo', 'kempo-inventory', 'kempo-ui']);
});
