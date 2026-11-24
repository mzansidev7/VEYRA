alter table public.daily_recommendations
  add column if not exists compatibility_score integer
    check (compatibility_score between 0 and 100),
  add column if not exists compatibility_confidence integer
    check (compatibility_confidence between 1 and 100),
  add column if not exists compatibility_version smallint not null default 1
    check (compatibility_version > 0),
  add column if not exists relationship_intentions_score integer
    check (relationship_intentions_score between 0 and 100),
  add column if not exists core_values_score integer
    check (core_values_score between 0 and 100),
  add column if not exists lifestyle_score integer
    check (lifestyle_score between 0 and 100),
  add column if not exists dating_dna_score integer
    check (dating_dna_score between 0 and 100),
  add column if not exists shared_interests_score integer
    check (shared_interests_score between 0 and 100),
  add column if not exists communication_score integer
    check (communication_score between 0 and 100);
