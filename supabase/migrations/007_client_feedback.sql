-- ============================================================
-- Fixes from the first client trial
-- ============================================================

-- Quotes usually show labour in dollars, not hours
alter table jobs add column if not exists quoted_labour numeric;

-- A variation (extra work) can have its own quote PDF
alter table variations add column if not exists quote_pdf_path text;

-- A worker's phone only has to be unique inside one business (the same subbie can work for two clients).
-- Removed workers keep their history but free up their number.
alter table workers add column if not exists removed_at timestamptz;
alter table workers drop constraint if exists workers_phone_key;
drop index if exists workers_phone_key;
create unique index if not exists workers_business_phone_key on workers(business_id, phone) where removed_at is null;

-- Which business a shared-phone worker chose today on WhatsApp
create table if not exists phone_choice (
  phone text primary key,
  worker_id uuid not null references workers(id) on delete cascade,
  chosen_at timestamptz not null default now()
);
alter table phone_choice enable row level security;

-- Same-day pay changes: keep only the latest rate per worker per day, and pick the newest if two ever exist
delete from worker_rates r using worker_rates newer
where r.worker_id = newer.worker_id and r.effective_from = newer.effective_from and r.created_at < newer.created_at;
create unique index if not exists worker_rates_worker_day_key on worker_rates(worker_id, effective_from);

create or replace view time_entry_costs with (security_invoker = true) as
with e as (
  select te.id, te.business_id, te.job_id, te.worker_id, w.type as worker_type, w.name as worker_name, w.break_minutes,
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
    order by wr.effective_from desc, wr.created_at desc limit 1
  ) rate on true
)
select id, business_id, job_id, worker_id, worker_type, worker_name, start_time, end_time,
  needs_review, review_reason, source, work_day, is_weekend,
  raw_hours, paid as paid_hours, ot as overtime_hours,
  base_rate is not null as has_rate,
  case
    when worker_type in ('subbie', 'subbie_fixed') or base_rate is null then 0
    when is_weekend then paid * coalesce(weekend_rate, base_rate) * oncost_mult
    else (paid - ot) * base_rate * oncost_mult + ot * coalesce(overtime_rate, base_rate) * oncost_mult
  end as cost
from r;

