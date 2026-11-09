-- 001_init: users, sessions, trips, tasks.
-- Already applied to the Neon project "mytraveltasks" (eu-west-2). Safe to re-run.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,           -- SHA-256 of the cookie token; the raw token is never stored
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  trip_type text NOT NULL CHECK (trip_type IN ('work','holiday','minibreak','family','other')),
  scope text NOT NULL CHECK (scope IN ('uk','abroad')),
  destination text,
  country text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  transport text[] NOT NULL DEFAULT '{}',
  travellers jsonb NOT NULL DEFAULT '[]',
  options jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS trips_user_idx ON trips (user_id, start_date);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text,                              -- generated tasks have a key (e.g. passport@rob); your own tasks do not
  title text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  owner text NOT NULL DEFAULT 'Everyone',
  due_date date,
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','done')),
  done_at timestamptz,
  depends_on text[] NOT NULL DEFAULT '{}',
  is_key boolean NOT NULL DEFAULT false,
  notes text,
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_trip_idx ON tasks (trip_id, sort);
CREATE INDEX IF NOT EXISTS tasks_user_idx ON tasks (user_id);
