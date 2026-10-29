import { assert, assertEquals } from 'jsr:@std/assert@1';
import { rollbackInvitedUser } from './rollback.ts';

function fakeAdmin() {
  const deleted: string[] = [];
  return { deleted, deleteUser: (id: string) => (deleted.push(id), Promise.resolve({ error: null })) };
}

const start = Date.parse('2026-10-28T12:00:00Z');

Deno.test('rollback deletes a user created by this request', async () => {
  const admin = fakeAdmin();
  assert(await rollbackInvitedUser(admin, { id: 'u1', created_at: '2026-10-28T12:00:01Z' }, start));
  assertEquals(admin.deleted, ['u1']);
});

Deno.test('rollback keeps a user that already existed', async () => {
  const admin = fakeAdmin();
  assertEquals(await rollbackInvitedUser(admin, { id: 'u2', created_at: '2026-10-01T09:00:00Z' }, start), false);
  assertEquals(await rollbackInvitedUser(admin, { id: 'u3' }, start), false);
  assertEquals(admin.deleted, []);
});
