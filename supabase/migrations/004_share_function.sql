-- =====================================================================
-- Health Tracker: database change for build step 9 (read-only share links)
--
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
--
-- 1. public.get_shared_progress(token): the ONLY thing a logged-out viewer
--    can call. It checks the link (exists, not revoked, not expired) and
--    returns an allow-list of fields for CONFIRMED days of that link's
--    owner. Hidden fields are never selected, so they cannot leak.
--    Any bad, revoked or expired link returns null (same answer for all).
-- 2. Share links can be revoked but never un-revoked, and their secret
--    token and owner can never be changed.
-- =====================================================================

create or replace function public.get_shared_progress(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  link_owner uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select l.user_id into link_owner
  from public.share_links l
  where l.token = p_token
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now());

  if link_owner is null then
    return null;
  end if;

  return jsonb_build_object(
    'days',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date', d.log_date,
          'weight_kg', d.weight_kg,
          'bedtime', to_char(d.bedtime, 'HH24:MI'),
          'wake_time', to_char(d.wake_time, 'HH24:MI'),
          'sleep_minutes', d.sleep_minutes,
          'steps', d.steps,
          'junk_meals', d.junk_meals,
          'food', jsonb_build_object(
            'kcal', f.kcal,
            'protein_g', f.protein_g, 'protein_unknown', f.protein_unknown,
            'carbs_g', f.carbs_g, 'carbs_unknown', f.carbs_unknown,
            'fat_g', f.fat_g, 'fat_unknown', f.fat_unknown,
            'fibre_g', f.fibre_g, 'fibre_unknown', f.fibre_unknown
          ),
          'fluids', jsonb_build_object(
            'total_ml', fl.total_ml,
            'sugary_ml', fl.sugary_ml,
            'kcal', fl.kcal,
            'kcal_unknown', fl.kcal_unknown
          ),
          'cardio', c.sessions
        )
        order by d.log_date desc
      )
      from public.days d
      cross join lateral (
        select
          coalesce(sum(i.kcal), 0) as kcal,
          coalesce(sum(i.protein_g), 0) as protein_g, count(*) filter (where i.protein_g is null) as protein_unknown,
          coalesce(sum(i.carbs_g), 0) as carbs_g, count(*) filter (where i.carbs_g is null) as carbs_unknown,
          coalesce(sum(i.fat_g), 0) as fat_g, count(*) filter (where i.fat_g is null) as fat_unknown,
          coalesce(sum(i.fibre_total_g), 0) as fibre_g, count(*) filter (where i.fibre_total_g is null) as fibre_unknown
        from public.food_items i
        where i.day_id = d.id
      ) f
      cross join lateral (
        select
          coalesce(sum(x.ml), 0) as total_ml,
          coalesce(sum(x.ml) filter (where x.drink_type = 'sugary_drink'), 0) as sugary_ml,
          coalesce(sum(x.kcal), 0) as kcal,
          count(*) filter (where x.kcal is null and x.drink_type in ('maad_water', 'sugary_drink', 'other')) as kcal_unknown
        from public.fluids x
        where x.day_id = d.id
      ) fl
      cross join lateral (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'type', s.cardio_type,
              'minutes', s.minutes,
              'start_time', to_char(s.start_time, 'HH24:MI'),
              'description', s.description
            )
            order by s.start_time
          ),
          '[]'::jsonb
        ) as sessions
        from public.cardio_sessions s
        where s.day_id = d.id
      ) c
      where d.user_id = link_owner
        and d.confirmed_at is not null
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_shared_progress(text) from public;
grant execute on function public.get_shared_progress(text) to anon, authenticated;

-- Share links: revoking is permanent; the token and owner never change.
create or replace function private.guard_share_links()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.revoked_at is not null then
    raise exception 'This share link is revoked: it cannot be changed or re-activated.';
  end if;
  if new.token <> old.token or new.user_id <> old.user_id then
    raise exception 'A share link''s secret token and owner cannot be changed.';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_share_links() from public, anon, authenticated;

create trigger guard_share_links
  before update on public.share_links
  for each row execute function private.guard_share_links();
