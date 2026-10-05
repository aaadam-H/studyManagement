drop policy if exists posts_update_admin on public.posts;
create policy posts_update_admin on public.posts
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke update on public.posts from anon, authenticated;
grant update (title, body, due_date) on public.posts to authenticated;
