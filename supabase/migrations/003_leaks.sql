-- ============================================================
-- Plugging leaks: breaks, weekend/overtime rates, fixed-price
-- subbies, hour reviews, ex-GST costs, credits, duplicates
-- ============================================================

-- Workers: fixed-price subbies and unpaid lunch breaks
alter table workers drop constraint if exists workers_type_check;
alter table workers add constraint workers_type_check
  check (type in ('employee', 'apprentice', 'subbie', 'subbie_fixed'));
alter table workers add column if not exists break_minutes int not null default 0;

-- Rates: optional weekend and overtime rates (blank = same as normal rate)
alter table worker_rates add column if not exists weekend_rate numeric;
alter table worker_rates add column if not exists overtime_rate numeric;
alter table worker_rates add column if not exists overtime_after numeric not null default 8;

-- Hours that need the owner to check (forgotten sign-outs etc.)
alter table time_entries add column if not exists needs_review boolean not null default false;
alter table time_entries add column if not exists review_reason text;

-- Expenses: ex-GST amount (the business is GST-registered), credits, who sent it
alter table expenses add column if not exists amount_ex_gst numeric
  generated always as (total - coalesce(gst, 0)) stored;
alter table expenses add column if not exists is_credit boolean not null default false;
alter table expenses add column if not exists submitted_by uuid references workers(id) on delete set null;

-- Paid hours for one shift: unpaid break comes off shifts longer than 5 hours
create or replace function paid_hours(start_at timestamptz, end_at timestamptz, break_mins int)
returns numeric language sql stable as $$
  select greatest(0,
    extract(epoch from (coalesce(end_at, now()) - start_at)) / 3600
    - case when extract(epoch from (coalesce(end_at, now()) - start_at)) / 3600 > 5
           then coalesce(break_mins, 0) / 60.0 else 0 end)
$$;

drop view if exists job_summary;
drop view if exists time_entry_costs;

-- One row per shift with paid hours and cost.
-- Weekend (Sat/Sun, Sydney time) uses the weekend rate; on weekdays, hours past
-- "overtime_after" in a day (across all jobs) use the overtime rate.
-- Subbies cost nothing here: they are costed from their invoices.
create view time_entry_costs with (security_invoker = true) as
with e as (
  select te.id, te.job_id, te.worker_id, w.type as worker_type, w.name as worker_name,
    te.start_time, te.end_time, te.needs_review, te.review_reason, te.source,
    extract(epoch from (coalesce(te.end_time, now()) - te.start_time)) / 3600 as raw_hours,
    paid_hours(te.start_time, te.end_time, w.break_minutes) as paid,
    (te.start_time at time zone 'Australia/Sydney')::date as work_day
  from time_entries te
  join workers w on w.id = te.worker_id
), d as (
  select e.*,
    extract(isodow from e.work_day) >= 6 as is_weekend,
    coalesce(sum(e.paid) over (
      partition by e.worker_id, e.work_day order by e.start_time
      rows between unbounded preceding and 1 preceding), 0) as earlier_today
  from e
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

-- Job summary: all money ex GST
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
