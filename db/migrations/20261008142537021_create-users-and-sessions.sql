-- Up Migration

create table users (
  id uuid not null default uuidv7(),
  email text not null,
  username text not null,
  password_hash text not null,
  created_at timestamptz not null default now(),
  constraint users_pkey primary key (id),
  constraint users_email_key unique (email),
  constraint users_username_key unique (username),
  constraint users_email_lower_check check (email = lower(email)),
  constraint users_email_has_at_check check (position('@' in email) > 0),
  constraint users_email_length_check check (char_length(email) between 1 and 254),
  constraint users_email_charset_check check (email ~ '^[!-~]+$'),
  constraint users_username_lower_check check (username = lower(username)),
  constraint users_username_no_at_check check (position('@' in username) = 0),
  constraint users_username_length_check check (char_length(username) between 1 and 32),
  constraint users_username_charset_check check (username ~ '^[a-z0-9._-]+$'),
  constraint users_password_hash_not_empty_check check (password_hash <> ''),
  constraint users_password_hash_prefix_check check (password_hash like '$argon2id$%')
);

create table sessions (
  id uuid not null default uuidv7(),
  user_id uuid not null,
  token_hash bytea not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint sessions_pkey primary key (id),
  constraint sessions_user_id_fkey foreign key (user_id) references users (id) on delete cascade,
  constraint sessions_token_hash_key unique (token_hash),
  constraint sessions_token_hash_length_check check (octet_length(token_hash) = 32),
  constraint sessions_expires_at_check check (expires_at > created_at)
);

create index sessions_user_id_idx on sessions (user_id);
create index sessions_expires_at_idx on sessions (expires_at);

-- Down Migration

drop table sessions;
drop table users;