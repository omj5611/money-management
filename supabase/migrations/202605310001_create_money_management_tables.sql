create extension if not exists pgcrypto;

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  institution text,
  account_type text not null default 'bank' check (account_type in ('bank', 'savings', 'card', 'cash', 'etc')),
  last_four_digits text,
  is_default boolean not null default false,
  color text not null default '#007aff',
  memo text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('expense', 'saving')),
  available_tabs text[] not null default array['fixed', 'variable']::text[],
  color text not null default '#007aff',
  icon text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_available_tabs_check
    check (available_tabs <@ array['fixed', 'variable']::text[])
);

create table if not exists public.fixed_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  amount integer not null check (amount >= 0),
  category_id uuid references public.categories(id) on delete set null,
  type text not null check (type in ('expense', 'saving')),
  withdrawal_account_id uuid references public.accounts(id) on delete set null,
  to_account text,
  transfer_type text not null default 'unset' check (transfer_type in ('auto', 'manual', 'unset')),
  payment_day integer not null check (payment_day between 1 and 31),
  cycle text not null default 'monthly' check (cycle in ('monthly', 'weekly', 'yearly')),
  start_date date,
  maturity_date date,
  auto_complete boolean not null default false,
  is_ended boolean not null default false,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fixed_expense_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fixed_expense_id uuid not null references public.fixed_expenses(id) on delete cascade,
  period_key text not null,
  status text not null default 'completed' check (status in ('completed', 'pending', 'scheduled', 'skipped')),
  scheduled_date date not null,
  completed_date date,
  actual_amount integer check (actual_amount >= 0),
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fixed_expense_id, period_key)
);

create table if not exists public.fixed_stat_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stat_key text not null check (stat_key in ('saving', 'expense', 'subscription', 'emergency')),
  title text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, stat_key)
);

create table if not exists public.fixed_stat_card_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stat_card_id uuid not null references public.fixed_stat_cards(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, stat_card_id, category_id)
);

create index if not exists accounts_user_id_idx on public.accounts(user_id);
create index if not exists categories_user_id_idx on public.categories(user_id);
create index if not exists fixed_expenses_user_id_payment_day_idx on public.fixed_expenses(user_id, payment_day);
create index if not exists fixed_expenses_category_id_idx on public.fixed_expenses(category_id);
create index if not exists fixed_expenses_withdrawal_account_id_idx on public.fixed_expenses(withdrawal_account_id);
create index if not exists fixed_expense_logs_user_id_period_key_idx on public.fixed_expense_logs(user_id, period_key);
create index if not exists fixed_stat_cards_user_id_sort_order_idx on public.fixed_stat_cards(user_id, sort_order);
create index if not exists fixed_stat_card_categories_user_id_idx on public.fixed_stat_card_categories(user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists accounts_set_updated_at on public.accounts;
create trigger accounts_set_updated_at
before update on public.accounts
for each row execute function public.set_updated_at();

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

drop trigger if exists fixed_expenses_set_updated_at on public.fixed_expenses;
create trigger fixed_expenses_set_updated_at
before update on public.fixed_expenses
for each row execute function public.set_updated_at();

drop trigger if exists fixed_expense_logs_set_updated_at on public.fixed_expense_logs;
create trigger fixed_expense_logs_set_updated_at
before update on public.fixed_expense_logs
for each row execute function public.set_updated_at();

drop trigger if exists fixed_stat_cards_set_updated_at on public.fixed_stat_cards;
create trigger fixed_stat_cards_set_updated_at
before update on public.fixed_stat_cards
for each row execute function public.set_updated_at();

alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.fixed_expenses enable row level security;
alter table public.fixed_expense_logs enable row level security;
alter table public.fixed_stat_cards enable row level security;
alter table public.fixed_stat_card_categories enable row level security;

create policy "Users can view own accounts"
on public.accounts for select
using (auth.uid() = user_id);

create policy "Users can insert own accounts"
on public.accounts for insert
with check (auth.uid() = user_id);

create policy "Users can update own accounts"
on public.accounts for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own accounts"
on public.accounts for delete
using (auth.uid() = user_id);

create policy "Users can view own categories"
on public.categories for select
using (auth.uid() = user_id);

create policy "Users can insert own categories"
on public.categories for insert
with check (auth.uid() = user_id);

create policy "Users can update own categories"
on public.categories for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own categories"
on public.categories for delete
using (auth.uid() = user_id);

create policy "Users can view own fixed expenses"
on public.fixed_expenses for select
using (auth.uid() = user_id);

create policy "Users can insert own fixed expenses"
on public.fixed_expenses for insert
with check (auth.uid() = user_id);

create policy "Users can update own fixed expenses"
on public.fixed_expenses for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own fixed expenses"
on public.fixed_expenses for delete
using (auth.uid() = user_id);

create policy "Users can view own fixed expense logs"
on public.fixed_expense_logs for select
using (auth.uid() = user_id);

create policy "Users can insert own fixed expense logs"
on public.fixed_expense_logs for insert
with check (auth.uid() = user_id);

create policy "Users can update own fixed expense logs"
on public.fixed_expense_logs for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own fixed expense logs"
on public.fixed_expense_logs for delete
using (auth.uid() = user_id);

create policy "Users can view own fixed stat cards"
on public.fixed_stat_cards for select
using (auth.uid() = user_id);

create policy "Users can insert own fixed stat cards"
on public.fixed_stat_cards for insert
with check (auth.uid() = user_id);

create policy "Users can update own fixed stat cards"
on public.fixed_stat_cards for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own fixed stat cards"
on public.fixed_stat_cards for delete
using (auth.uid() = user_id);

create policy "Users can view own fixed stat card categories"
on public.fixed_stat_card_categories for select
using (auth.uid() = user_id);

create policy "Users can insert own fixed stat card categories"
on public.fixed_stat_card_categories for insert
with check (auth.uid() = user_id);

create policy "Users can update own fixed stat card categories"
on public.fixed_stat_card_categories for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own fixed stat card categories"
on public.fixed_stat_card_categories for delete
using (auth.uid() = user_id);
