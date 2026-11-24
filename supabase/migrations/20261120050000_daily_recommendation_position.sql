alter table public.daily_recommendations
  add column if not exists position smallint;

with ranked_recommendations as (
  select
    id,
    row_number() over (
      partition by set_id
      order by created_at, id
    )::smallint as position
  from public.daily_recommendations
  where position is null
)
update public.daily_recommendations as recommendation
set position = ranked_recommendations.position
from ranked_recommendations
where recommendation.id = ranked_recommendations.id;

alter table public.daily_recommendations
  alter column position set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.daily_recommendations'::regclass
      and conname = 'daily_recommendations_position_check'
  ) then
    alter table public.daily_recommendations
      add constraint daily_recommendations_position_check
      check (position between 1 and 5);
  end if;
end;
$$;

create unique index if not exists daily_recommendations_set_position_idx
  on public.daily_recommendations (set_id, position);
