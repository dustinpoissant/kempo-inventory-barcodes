import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanCode, lookupKey, checkDigit, isGtin, isUpcE, kindOf, looksMistyped, symbologyFor, cleanPrefix, formatInternal } from '../server/utils/codes.js';

test('the check digit of a real UPC-A, EAN-13 and EAN-8', () => {
  assert.equal(checkDigit('03600029145'), 2);
  assert.equal(checkDigit('400638133393'), 1);
  assert.equal(checkDigit('9638507'), 4);
});

test('isGtin accepts real product codes and nothing else', () => {
  assert.equal(isGtin('036000291452'), true);
  assert.equal(isGtin('4006381333931'), true);
  assert.equal(isGtin('96385074'), true);
  assert.equal(isGtin('036000291453'), false);
  assert.equal(isGtin('12345'), false);
  assert.equal(isGtin('INV-000123'), false);
  assert.equal(isGtin(''), false);
});

test('a UPC-E is checked by the UPC-A it expands to, and drawn as a UPC-E', () => {
  assert.equal(isUpcE('04252614'), true);
  assert.equal(isGtin('04252614'), true);
  assert.equal(symbologyFor('04252614'), 'upce');
  assert.equal(isGtin('04252615'), false);
  assert.equal(looksMistyped('04252615'), true);
  assert.equal(isUpcE('96385074'), false);
});

test('a code that is the right length but has a wrong last digit looks mistyped', () => {
  assert.equal(looksMistyped('036000291453'), true);
  assert.equal(looksMistyped('036000291452'), false);
  assert.equal(looksMistyped('12345'), false);
  assert.equal(looksMistyped('CODE-128-text'), false);
});

test('kind is upc only for a valid product code', () => {
  assert.equal(kindOf('036000291452'), 'upc');
  assert.equal(kindOf('INV-000123'), 'other');
  assert.equal(kindOf('12345'), 'other');
});

test('a UPC-A and the EAN-13 that is the same code with a leading zero compare equal', () => {
  assert.equal(lookupKey('036000291452'), lookupKey('0036000291452'));
  assert.equal(lookupKey('036000291452'), '36000291452');
  assert.equal(lookupKey('000'), '0');
});

test('text codes compare ignoring case and spacing', () => {
  assert.equal(lookupKey('  inv-000123 '), lookupKey('INV-000123'));
  assert.equal(cleanCode('  a   b '), 'a b');
  assert.notEqual(lookupKey('INV-000123'), lookupKey('INV-000124'));
});

test('real product codes are drawn as themselves and everything else as Code 128', () => {
  assert.equal(symbologyFor('036000291452'), 'upca');
  assert.equal(symbologyFor('4006381333931'), 'ean13');
  assert.equal(symbologyFor('96385074'), 'ean8');
  assert.equal(symbologyFor('036000291453'), 'code128');
  assert.equal(symbologyFor('INV-000123'), 'code128');
});

test('internal codes are the prefix and a six-digit number', () => {
  assert.equal(formatInternal('INV', 123), 'INV-000123');
  assert.equal(formatInternal('fil', 1), 'FIL-000001');
  assert.equal(cleanPrefix(' a b-c! '), 'ABC');
  assert.equal(cleanPrefix(''), 'INV');
});
