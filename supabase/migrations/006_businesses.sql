-- ============================================================
-- Many businesses: each client's data is labelled with its business,
-- and each person logs in with their own email and password.
-- ============================================================

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
alter table businesses enable row level security;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  email text not null unique,
  name text,
  password_hash text not null,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  is_admin boolean not null default false, -- the BrushBooks founder: can create businesses
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
alter table app_users enable row level security;

-- Everything that exists today belongs to the first business
insert into businesses (id, name) values ('00000000-0000-0000-0000-000000000001', 'My painting business')
  on conflict (id) do nothing;

alter table workers add column if not exists business_id uuid references businesses(id) on delete cascade;
alter table jobs add column if not exists business_id uuid references businesses(id) on delete cascade;
alter table time_entries add column if not exists business_id uuid references businesses(id) on delete cascade;
alter table expenses add column if not exists business_id uuid references businesses(id) on delete cascade;
alter table variations add column if not exists business_id uuid references businesses(id) on delete cascade;

update workers set business_id = '00000000-0000-0000-0000-000000000001' where business_id is null;
update jobs set business_id = '00000000-0000-0000-0000-000000000001' where business_id is null;
update time_entries set business_id = '00000000-0000-0000-0000-000000000001' where business_id is null;
update expenses set business_id = '00000000-0000-0000-0000-000000000001' where business_id is null;
update variations set business_id = '00000000-0000-0000-0000-000000000001' where business_id is null;

alter table workers alter column business_id set not null;
alter table jobs alter column business_id set not null;
alter table time_entries alter column business_id set not null;
alter table expenses alter column business_id set not null;
alter table variations alter column business_id set not null;

-- Until every part of the app sets the business itself, new rows default to the first business
alter table workers alter column business_id set default '00000000-0000-0000-0000-000000000001';
alter table jobs alter column business_id set default '00000000-0000-0000-0000-000000000001';
alter table time_entries alter column business_id set default '00000000-0000-0000-0000-000000000001';
alter table expenses alter column business_id set default '00000000-0000-0000-0000-000000000001';
alter table variations alter column business_id set default '00000000-0000-0000-0000-000000000001';

create index if not exists workers_business_idx on workers(business_id);
create index if not exists jobs_business_idx on jobs(business_id);
create index if not exists time_entries_business_idx on time_entries(business_id);
create index if not exists expenses_business_idx on expenses(business_id);
create index if not exists variations_business_idx on variations(business_id);

-- Job codes only need to be unique within a business (two clients can both have J-1001)
alter table jobs drop constraint if exists jobs_code_key;
create unique index if not exists jobs_business_code_key on jobs(business_id, code);

-- Views carry the business too
drop view if exists job_summary;
drop view if exists time_entry_costs;

create view time_entry_costs with (security_invoker = true) as
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
    order by wr.effective_from desc limit 1
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

create view job_summary with (security_invoker = true) as
select
  j.id, j.business_id, j.code, j.client_name, j.address, j.status,
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

-- The founder's login: same password as before, now with an email, and admin rights
insert into app_users (business_id, email, name, password_hash, is_admin)
select '00000000-0000-0000-0000-000000000001', 'aayushkhadkag@gmail.com', 'Aayush', value, true
from app_settings where key = 'password_hash'
on conflict (email) do nothing;
