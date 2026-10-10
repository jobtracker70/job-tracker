-- ============================================================
-- Sign-out reminders 8h after sign-in, worker fixes by WhatsApp,
-- unpaid break taken once per day
-- ============================================================

alter table time_entries add column if not exists reminded_at timestamptz;

-- What the bot is waiting for from a worker (e.g. their real finish time)
create table if not exists bot_state (
  worker_id uuid primary key references workers(id) on delete cascade,
  kind text not null check (kind in ('finish_time', 'missed_hours')),
  entry_id uuid references time_entries(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table bot_state enable row level security;

-- Break: taken once per day (days over 5 hours), shared across that day's shifts
drop view if exists job_summary;
drop view if exists time_entry_costs;
drop function if exists paid_hours(timestamptz, timestamptz, int);

create view time_entry_costs with (security_invoker = true) as
with e as (
  select te.id, te.job_id, te.worker_id, w.type as worker_type, w.name as worker_name, w.break_minutes,
    te.start_time, te.end_time, te.needs_review, te.review_reason, te.source,
    extract(epoch from (coalesce(te.end_time, now()) - te.start_time)) / 3600 as raw_hours,
    (te.start_time at time zone 'Australia/Sydney')::date as work_day
  from time_entries te
  join workers w on w.id = te.worker_id
), b as (
  select e.*, sum(e.raw_hours) over (partition by e.worker_id, e.work_day) as day_raw
  from e
), p as (
  select b.*,
    case when b.day_raw > 5 and b.break_minutes > 0
         then greatest(0, b.raw_hours - (b.break_minutes / 60.0) * b.raw_hours / b.day_raw)
         else b.raw_hours end as paid
  from b
), d as (
  select p.*,
    extract(isodow from p.work_day) >= 6 as is_weekend,
    coalesce(sum(p.paid) over (
      partition by p.worker_id, p.work_day order by p.start_time
      rows between unbounded preceding and 1 preceding), 0) as earlier_today
  from p
), r as (
  select d.*, rate.base_rate, rate.oncost_mult, rate.weekend_rate, rate.overtime_rate,
    case when d.is_weekend then 0
         else greatest(0, d.paid - greatest(0, coalesce(rate.overtime_after, 8) - d.earlier_today)) end as ot
  from d
  left join lateral (
    select base_rate, oncost_mult, weekend_rate, overtime_rate, overtime_after
    from worker_rates wr
    where wr.worker_id = d.worker_id and wr.effective_from <= d.work_day
    order by wr.effective_from desc limit 1
  ) rate on true
)
select id, job_id, worker_id, worker_type, worker_name, start_time, end_time,
  needs_review, review_reason, source, work_day, is_weekend,
  raw_hours, paid as paid_hours, ot as overtime_hours,
  base_rate is not null as has_rate,
  case
    when worker_type in ('subbie', 'subbie_fixed') or base_rate is null then 0
    when is_weekend then paid * coalesce(weekend_rate, base_rate) * oncost_mult
    else (paid - ot) * base_rate * oncost_mult + ot * coalesce(overtime_rate, base_rate) * oncost_mult
  end as cost
from r;

create view job_summary with (security_invoker = true) as
select
  j.id, j.code, j.client_name, j.address, j.status,
  j.quote_total, j.quoted_hours, j.quoted_materials,
  j.start_date, j.planned_finish, j.rejection_reason, j.created_at,
  coalesce((select sum(paid_hours) from time_entry_costs c
    where c.job_id = j.id and c.worker_type not in ('subbie', 'subbie_fixed')), 0) as employee_hours,
  coalesce((select sum(paid_hours) from time_entry_costs c
    where c.job_id = j.id and c.worker_type in ('subbie', 'subbie_fixed')), 0) as subbie_hours_logged,
  coalesce((select sum(hours) from expenses
    where job_id = j.id and status <> 'rejected' and category = 'subbie'), 0) as subbie_hours_invoiced,
  coalesce((select sum(cost) from time_entry_costs c where c.job_id = j.id), 0) as labour_cost,
  coalesce((select sum(amount_ex_gst) from expenses
    where job_id = j.id and status <> 'rejected' and category in ('materials', 'other')), 0) as materials_cost,
  coalesce((select sum(amount_ex_gst) from expenses
    where job_id = j.id and status <> 'rejected' and category = 'subbie'), 0)
    + coalesce((select sum(agreed_amount) from subcontracts where job_id = j.id), 0) as subbie_cost,
  coalesce((select sum(amount) from variations where job_id = j.id), 0) as variations_total,
  coalesce((select sum(hours) from variations where job_id = j.id), 0) as variation_hours,
  coalesce((select sum(materials) from variations where job_id = j.id), 0) as variation_materials,
  (select count(*) from time_entries t where t.job_id = j.id and t.needs_review)::int as entries_to_review
from jobs j;

-- Every 15 minutes, ask the app to send due sign-out reminders and close forgotten shifts.
-- (Vercel's free plan only allows once-a-day schedules, so the database does the timing.)
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Random secret made inside the database; the app checks it on every scheduled call
insert into app_settings (key, value) values ('cron_secret', encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (key) do nothing;

select cron.unschedule('job-tracker-reminders') where exists (select 1 from cron.job where jobname = 'job-tracker-reminders');
select cron.schedule(
  'job-tracker-reminders',
  '*/15 * * * *',
  $cron$
    select net.http_get(
      url := 'https://job-tracker-sage-five.vercel.app/api/cron/reminders',
      headers := jsonb_build_object('x-cron-secret', (select value from public.app_settings where key = 'cron_secret')),
      timeout_milliseconds := 30000
    )
  $cron$
);
