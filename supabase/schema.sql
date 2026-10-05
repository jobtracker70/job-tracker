-- ============================================================
-- Job Profit Tracker - Database Schema
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Workers (crew members and subbies)
create table if not exists workers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null unique, -- WhatsApp number e.g. +61410085858
  type text not null check (type in ('employee', 'apprentice', 'subbie')),
  abn text,
  active boolean default true,
  created_at timestamptz default now()
);

-- Worker rates (effective-dated so you can change rates over time)
create table if not exists worker_rates (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid references workers(id) on delete cascade,
  base_rate numeric not null,
  oncost_mult numeric not null default 1.4,
  effective_from date not null,
  created_at timestamptz default now()
);

-- Jobs (one row per accepted quote)
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, -- e.g. J-1042
  client_name text,
  address text,
  quote_total numeric,
  quoted_hours numeric,
  quoted_materials numeric,
  po_ref text,
  status text not null default 'active' check (status in ('active', 'complete', 'invoiced', 'paid')),
  quote_pdf_path text,
  created_at timestamptz default now()
);

-- Sequence for auto-generating job codes (J-1001, J-1002, ...)
create sequence if not exists job_code_seq start 1001;

-- Function to auto-assign job code
create or replace function assign_job_code()
returns trigger as $$
begin
  if new.code is null or new.code = '' then
    new.code := 'J-' || nextval('job_code_seq')::text;
  end if;
  return new;
end;
$$ language plpgsql;

create or replace trigger set_job_code
  before insert on jobs
  for each row execute function assign_job_code();

-- Time entries (clock in/out via WhatsApp)
create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid references workers(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz,
  source text not null default 'whatsapp' check (source in ('whatsapp', 'manual')),
  edited_by text,
  created_at timestamptz default now()
);

-- Expenses (materials, receipts, invoices)
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  supplier text,
  supplier_abn text,
  total numeric not null,
  gst numeric,
  expense_date date,
  image_path text,
  extraction_json jsonb,
  confidence text check (confidence in ('high', 'medium', 'low')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  category text default 'materials' check (category in ('materials', 'subbie', 'other')),
  created_at timestamptz default now()
);

-- Subcontracts (subbies on a job)
create table if not exists subcontracts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  subbie_name text not null,
  basis text not null check (basis in ('fixed', 'm2')),
  agreed_amount numeric not null,
  created_at timestamptz default now()
);

-- Variations (extras added to a job)
create table if not exists variations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  description text,
  amount numeric not null,
  created_at timestamptz default now()
);

-- WhatsApp message log (prevents processing the same message twice)
create table if not exists message_log (
  id uuid primary key default gen_random_uuid(),
  wamid text unique not null,
  from_number text not null,
  body text,
  processed_at timestamptz default now()
);

-- NSW Workplace Surveillance Act consent (must record 14-day notice)
create table if not exists consent (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid references workers(id) on delete cascade,
  notice_date date not null,
  created_at timestamptz default now()
);

-- ============================================================
-- Handy view: job summary with live costs
-- ============================================================
create or replace view job_summary as
select
  j.id,
  j.code,
  j.client_name,
  j.address,
  j.status,
  j.quote_total,
  j.quoted_hours,
  j.quoted_materials,
  -- Labour cost: hours × rate × oncost
  coalesce((
    select sum(
      extract(epoch from (coalesce(te.end_time, now()) - te.start_time)) / 3600
      * wr.base_rate * wr.oncost_mult
    )
    from time_entries te
    join workers w on w.id = te.worker_id
    join worker_rates wr on wr.worker_id = w.id
      and wr.effective_from = (
        select max(effective_from) from worker_rates
        where worker_id = w.id and effective_from <= te.start_time::date
      )
    where te.job_id = j.id
  ), 0) as labour_cost,
  -- Materials cost
  coalesce((
    select sum(total) from expenses
    where job_id = j.id and status != 'rejected'
  ), 0) as materials_cost,
  -- Subbie cost
  coalesce((
    select sum(agreed_amount) from subcontracts
    where job_id = j.id
  ), 0) as subbie_cost,
  -- Variations
  coalesce((
    select sum(amount) from variations
    where job_id = j.id
  ), 0) as variations_total,
  j.created_at
from jobs j;
