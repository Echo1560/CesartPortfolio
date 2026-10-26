# Rollbacks

The Supabase CLI applies migrations forward only. Each migration in
`../migrations/` has a matching `<version>_<name>.down.sql` here that undoes it.

To roll back the newest N migrations on a database, run the down files in
reverse order, newest first, then delete the matching rows from
`supabase_migrations.schema_migrations`:

```sh
psql "$DB_URL" -f supabase/rollbacks/20261025000600_storage.down.sql
psql "$DB_URL" -c "delete from supabase_migrations.schema_migrations where version = '20261025000600'"
```

Locally it is simpler to check out the older commit and run `supabase db reset`.
Never edit a merged migration: add a new one (and its down file).
