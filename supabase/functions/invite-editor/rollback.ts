// Undo for a failed invite. inviteUserByEmail returns the existing auth user when the
// email belongs to an unconfirmed account, so only delete a user this request created.
export interface UserDeleter {
  deleteUser(id: string): Promise<{ error: unknown }>;
}

export async function rollbackInvitedUser(
  admin: UserDeleter,
  user: { id: string; created_at?: string },
  requestStart: number,
): Promise<boolean> {
  const createdAt = user.created_at ? Date.parse(user.created_at) : NaN;
  // Unknown or earlier creation time: assume the account is not ours to delete.
  if (!(createdAt >= requestStart)) return false;
  const undo = await admin.deleteUser(user.id);
  if (undo.error) console.error('could not roll back invited user', user.id, undo.error);
  return true;
}
