-- Run this in Supabase SQL Editor

create table if not exists early_access_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz default now()
);

create table if not exists invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  email text,
  used boolean default false,
  used_at timestamptz,
  created_at timestamptz default now()
);

alter table early_access_waitlist enable row level security;
create policy "anyone can join waitlist" on early_access_waitlist for insert with check (true);

alter table invite_codes enable row level security;
create policy "anyone can read codes" on invite_codes for select using (true);
create policy "anyone can redeem codes" on invite_codes for update using (true);

-- Generate 50 codes (run whenever needed):
-- insert into invite_codes (code)
-- select upper(substring(md5(random()::text), 1, 8)) from generate_series(1, 50);
