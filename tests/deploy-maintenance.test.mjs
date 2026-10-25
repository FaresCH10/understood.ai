import test from 'node:test';
import assert from 'node:assert/strict';
import {operatorMaintenanceConfig} from '../scripts/postgres-operator.mjs';

const environment = {
  UNDERSTOOD_TIER: 'staging',
  UNDERSTOOD_AI_MODE: 'synthetic',
  UNDERSTOOD_ACCESS_MODE: 'credential',
  UNDERSTOOD_DATA_CLASS: 'synthetic',
  UNDERSTOOD_PUBLIC_ORIGIN: 'https://operations.example.test',
  UNDERSTOOD_CUSTOMER_ORIGIN: 'https://understood.example.test',
  UNDERSTOOD_POSTGRES_SCHEMA: 'understood_stage_maintenance',
  UNDERSTOOD_POSTGRES_URL: 'postgresql://maintenance:placeholder@db.example.test/understood',
  UNDERSTOOD_POSTGRES_TLS: 'true',
  UNDERSTOOD_TRUSTED_PROXY_NETWORKS: '["127.0.0.1/32"]',
  UNDERSTOOD_OPERATOR_ACCESS: 'true',
};

test('operator provisioning validates the separate operator service contract', () => {
  const config = operatorMaintenanceConfig(environment, '--provision-operator');
  assert.equal(config.runtimeRoleProfile, 'operator');
  assert.equal(config.operatorAccess, true);
  assert.equal(config.storageConfig, undefined);
  assert.equal(config.mail.available, false);
  assert.equal(config.productionReady, undefined);
});

test('operator provisioning still requires explicit operator access', () => {
  assert.throws(() => operatorMaintenanceConfig({...environment, UNDERSTOOD_OPERATOR_ACCESS: 'false'}, '--provision-operator'),
    /explicitly enabled, separate operator origin/);
});

test('workspace bootstrap cannot use the operator desktop contract', () => {
  assert.throws(() => operatorMaintenanceConfig(environment, '--bootstrap-workspace'),
    /separate operator service/);
});
