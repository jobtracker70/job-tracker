-- ============================================================
-- Version 1: quote decisions, budgets in hours, variations,
-- email invoices, subbie hours matching
-- Run this once in the Supabase SQL Editor
-- ============================================================

-- Jobs: quoted -> active (accepted) / rejected (missed) -> complete
alter table jobs drop constraint if exists jobs_status_check;
alter table jobs add constraint jobs_status_check
  check (status in ('quoted', 'active', 'complete', 'rejected', 'invoiced', 'paid'));
alter table jobs alter column status set default 'quoted';
alter table jobs add column if not exists start_date date;
alter table jobs add column if not exists planned_finish date;
alter table jobs add column if not exists rejection_reason text;
alter table jobs add column if not exists decided_at timestamptz;
alter table jobs add column if not exists completed_at timestamptz;

-- Variations can add hours and materials to the budget
alter table variations add column if not exists hours numeric not null default 0;
alter table variations add column if not exists materials numeric not null default 0;

-- Expenses: subbie hours, who sent it, where it came from
alter table expenses add column if not exists hours numeric;
alter table expenses add column if not exists worker_id uuid references workers(id) on delete set null;
alter table expenses add column if not exists invoice_number text;
alter table expenses add column if not exists job_code_raw text;
alter table expenses add column if not exists source text not null default 'upload';
alter table expenses add column if not exists email_message_id text;
alter table expenses add column if not exists file_name text;
alter table expenses add column if not exists note text;

-- Emails already read (so each email is only processed once)
create table if not exists processed_emails (
  message_id text primary key,
  subject text,
  from_address text,
  invoices_found int not null default 0,
  processed_at timestamptz default now()
);

-- Storage buckets for quote and invoice files
insert into storage.buckets (id, name, public) values ('quotes', 'quotes', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('invoices', 'invoices', false)
  on conflict (id) do nothing;

-- Lock every table: the app only uses the server-side key, so nothing
-- should be readable with the public key.
alter table workers enable row level security;
alter table worker_rates enable row level security;
alter table jobs enable row level security;
alter table time_entries enable row level security;
alter table expenses enable row level security;
alter table subcontracts enable row level security;
alter table variations enable row level security;
alter table message_log enable row level security;
alter table consent enable row level security;
alter table processed_emails enable row level security;

-- ============================================================
-- Job summary. Employee labour is costed from WhatsApp hours x rate;
-- subbie labour is costed from their invoices (never both).
-- ============================================================
drop view if exists job_summary;
create view job_summary with (security_invoker = true) as
select
  j.id,
  j.code,
  j.client_name,
  j.address,
  j.status,
  j.quote_total,
  j.quoted_hours,
  j.quoted_materials,
  j.start_date,
  j.planned_finish,
  j.rejection_reason,
  j.created_at,
  coalesce((
    select sum(extract(epoch from (coalesce(te.end_time, now()) - te.start_time)) / 3600)
    from time_entries te
    join workers w on w.id = te.worker_id and w.type <> 'subbie'
    where te.job_id = j.id
  ), 0) as employee_hours,
  coalesce((
    select sum(extract(epoch from (coalesce(te.end_time, now()) - te.start_time)) / 3600)
    from time_entries te
    join workers w on w.id = te.worker_id and w.type = 'subbie'
    where te.job_id = j.id
  ), 0) as subbie_hours_logged,
  coalesce((
    select sum(hours) from expenses
    where job_id = j.id and status <> 'rejected' and category = 'subbie'
  ), 0) as subbie_hours_invoiced,
  coalesce((
    select sum(
      extract(epoch from (coalesce(te.end_time, now()) - te.start_time)) / 3600
      * coalesce(r.base_rate, 0) * coalesce(r.oncost_mult, 1)
    )
    from time_entries te
    join workers w on w.id = te.worker_id and w.type <> 'subbie'
    left join lateral (
      select base_rate, oncost_mult from worker_rates wr
      where wr.worker_id = w.id and wr.effective_from <= te.start_time::date
      order by wr.effective_from desc limit 1
    ) r on true
    where te.job_id = j.id
  ), 0) as labour_cost,
  coalesce((
    select sum(total) from expenses
    where job_id = j.id and status <> 'rejected' and category in ('materials', 'other')
  ), 0) as materials_cost,
  coalesce((
    select sum(total) from expenses
    where job_id = j.id and status <> 'rejected' and category = 'subbie'
  ), 0) + coalesce((
    select sum(agreed_amount) from subcontracts where job_id = j.id
  ), 0) as subbie_cost,
  coalesce((select sum(amount) from variations where job_id = j.id), 0) as variations_total,
  coalesce((select sum(hours) from variations where job_id = j.id), 0) as variation_hours,
  coalesce((select sum(materials) from variations where job_id = j.id), 0) as variation_materials
from jobs j;
