create or replace function public.build_likes_profile_card(
  p_viewer_id uuid,
  p_candidate_id uuid,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_viewer_profile jsonb;
  v_candidate_profile jsonb;
  v_compatibility jsonb;
  v_show_age boolean;
  v_show_city boolean;
  v_show_verification boolean;
  v_show_compatibility boolean;
  v_profile jsonb;
begin
  select profile into v_viewer_profile
  from public.dating_profiles
  where user_id = p_viewer_id;

  select candidate.profile into v_candidate_profile
  from public.dating_profiles as candidate
  where candidate.user_id = p_candidate_id;

  if v_viewer_profile is null or v_candidate_profile is null then
    return null;
  end if;

  select
    coalesce(privacy.show_age, true),
    coalesce(privacy.show_city, true),
    coalesce(privacy.show_verification_badge, true),
    coalesce(privacy.show_compatibility_score, true)
  into
    v_show_age,
    v_show_city,
    v_show_verification,
    v_show_compatibility
  from (select 1) as defaults
  left join public.user_privacy_settings as privacy
    on privacy.user_id = p_candidate_id;

  v_compatibility := public.daily_five_compatibility(
    v_viewer_profile,
    v_candidate_profile
  );

  select jsonb_build_object(
    'candidate_id', p_candidate_id,
    'account_created_at', (
      select account.created_at
      from auth.users as account
      where account.id = p_candidate_id
    ),
    'nickname', v_candidate_profile->'profile'->>'nickname',
    'age', case when v_show_age then
      extract(year from age(
        (now() at time zone p_timezone)::date,
        (v_candidate_profile->'profile'->>'birthday')::date
      ))::integer
      else null end,
    'city', case when v_show_city
      then v_candidate_profile->'profile'->>'city'
      else null end,
    'bio', coalesce(v_candidate_profile->'profile'->>'bio', ''),
    'occupation', coalesce(v_candidate_profile->'profile'->>'occupation', ''),
    'interests', coalesce(
      v_candidate_profile->'profile'->'interests',
      '[]'::jsonb
    ),
    'intentions', coalesce(v_candidate_profile->'intentions', '[]'::jsonb),
    'photo_paths', coalesce((
      select jsonb_agg(photo.path order by photo.ordinality)
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(v_candidate_profile->'profile'->'photos') = 'array'
            then v_candidate_profile->'profile'->'photos'
          else '[]'::jsonb
        end
      ) with ordinality as photo(path, ordinality)
      where photo.path like p_candidate_id::text || '/%'
    ), '[]'::jsonb),
    'identity_verified', v_show_verification and exists (
      select 1
      from public.user_verifications as verification
      where verification.user_id = p_candidate_id::text
        and verification.identity_verification_status = 'verified'
    ),
    'compatibility_score', case when v_show_compatibility
      then v_compatibility->'score'
      else null end,
    'compatibility_confidence', case when v_show_compatibility
      then v_compatibility->'confidence'
      else null end,
    'compatibility_breakdown', case when v_show_compatibility then
      jsonb_build_object(
        'version', 1,
        'relationship_intentions', v_compatibility->'relationship_intentions',
        'core_values', v_compatibility->'core_values',
        'lifestyle', v_compatibility->'lifestyle',
        'dating_dna', v_compatibility->'dating_dna',
        'shared_interests', v_compatibility->'shared_interests',
        'communication', v_compatibility->'communication'
      )
      else null end
  ) into v_profile;

  return v_profile;
end;
$$;

revoke all on function public.build_likes_profile_card(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.build_likes_profile_card(uuid, uuid, text)
  to service_role;
