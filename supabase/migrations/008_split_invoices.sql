-- One invoice can cover several jobs: items moved to another job become their own row, linked to the original.
alter table expenses add column if not exists split_from uuid references expenses(id) on delete set null;
-- The invoice's full amount before any split, so sending the same invoice again is still caught as a duplicate
alter table expenses add column if not exists original_total numeric;
create index if not exists expenses_split_from_idx on expenses(split_from);
