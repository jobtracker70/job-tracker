-- Usual site hours per job: early sign-ins snap to the start, small late sign-outs snap to the finish
alter table jobs add column if not exists day_start time not null default '07:00';
alter table jobs add column if not exists day_end time not null default '15:30';

-- What was bought on each invoice: [{ "description": "...", "qty": 2, "unit_price": 89.5, "amount": 179 }]
alter table expenses add column if not exists line_items jsonb;
